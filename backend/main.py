from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
import gc
from dotenv import load_dotenv

from db.mongo import connect_to_mongo, close_mongo_connection
from routers.convert import router as convert_router

load_dotenv()

# Allowed origins - production and local development
ALLOWED_ORIGINS = [
    "https://fileconverter.curriumx.online",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:3000",
    "http://localhost:3000"
]

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    print("🚀 Starting HEIC Converter API...")
    print(f"🔒 Allowed origins: {ALLOWED_ORIGINS}")
    try:
        await connect_to_mongo()
        print("📦 MongoDB connected")
    except Exception as e:
        print(f"⚠️ MongoDB unavailable (stats disabled): {e}")
    yield
    await close_mongo_connection()
    print("👋 Shutdown complete")

app = FastAPI(
    title="HEIC to PNG Converter API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS - Strict configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=[
        "Content-Disposition",
        "Content-Length",
        "X-Conversion-Time-Ms",
        "X-Files-Converted",
        "X-Files-Failed"
    ],
    max_age=3600
)

# Cleanup middleware - FIXED
@app.middleware("http")
async def cleanup_middleware(request, call_next):
    """Clean up after each request."""
    # call_next is a function - call it with request
    response = await call_next(request)
    
    # Force garbage collection after file uploads
    if request.url.path == "/convert":
        gc.collect()
    
    return response

app.include_router(convert_router)

@app.get("/")
async def root():
    return {
        "service": "HEIC to PNG Converter API",
        "version": "1.0.0",
        "status": "online",
        "endpoints": {
            "convert": "POST /convert",
            "stats": "GET /stats",
            "health": "GET /health"
        },
        "limits": {
            "max_file_size": "50MB",
            "batch_supported": True
        },
        "allowed_origins": ALLOWED_ORIGINS
    }

@app.get("/health")
async def health():
    return {"status": "healthy"}