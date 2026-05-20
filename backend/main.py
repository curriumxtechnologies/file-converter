from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
import gc
from dotenv import load_dotenv

from db.mongo import connect_to_mongo, close_mongo_connection
from routers.convert import router as convert_router

load_dotenv()

# Get allowed origins from env
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "https://heic-converter.vercel.app,http://localhost:3000,http://127.0.0.1:5500"
).split(",")

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Starting HEIC Converter API...")
    try:
        await connect_to_mongo()
        print("📦 MongoDB connected")
    except Exception as e:
        print(f"⚠️ MongoDB unavailable: {e}")
    yield
    await close_mongo_connection()

app = FastAPI(
    title="HEIC to PNG Converter API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Files-Converted", "X-Conversion-Time-Ms"]
)

# Cleanup middleware
@app.middleware("http")
async def cleanup_middleware(request, call_next):
    response = await call_next
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
            "convert": "/convert",
            "stats": "/stats",
            "health": "/health"
        }
    }

@app.get("/health")
async def health():
    return {"status": "healthy"}