from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
from dotenv import load_dotenv
import multiprocessing

from db.mongo import connect_to_mongo, close_mongo_connection, check_connection
from routers.convert import router as convert_router

load_dotenv()

# Optimize server settings
WORKERS = int(os.getenv("WORKERS", multiprocessing.cpu_count() * 2 + 1))

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Starting HEIC to PNG Converter (Optimized)...")
    print(f"💻 CPU Cores: {multiprocessing.cpu_count()}")
    print(f"👷 Workers: {WORKERS}")
    try:
        await connect_to_mongo()
        print("📦 MongoDB connected")
    except Exception as e:
        print(f"⚠️ MongoDB unavailable: {e}")
    yield
    await close_mongo_connection()

app = FastAPI(
    title="HEIC to PNG Converter",
    version="2.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(convert_router)

@app.get("/")
async def root():
    return {
        "name": "HEIC to PNG Converter",
        "version": "2.0.0",
        "optimizations": [
            "Parallel conversion",
            "Thread pool processing",
            "Fast PNG compression (level 1)",
            "ZIP_STORED for archives",
            f"{multiprocessing.cpu_count()} CPU cores available"
        ]
    }