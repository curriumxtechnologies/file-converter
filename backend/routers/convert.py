from fastapi import APIRouter, UploadFile, File, Request, HTTPException
from fastapi.responses import Response, JSONResponse
from typing import List
import asyncio
import time

from services.converter import (
    process_batch_conversion_fast,
    create_zip_archive_fast,
    sanitize_filename
)
from services.stats import record_conversion, get_stats

router = APIRouter()

@router.post("/convert")
async def convert_files(
    request: Request,
    files: List[UploadFile] = File(...)
):
    """
    Ultra-fast parallel conversion of HEIC to PNG.
    All files converted simultaneously for maximum speed.
    """
    if not files:
        raise HTTPException(status_code=400, detail={"error": "No files provided"})
    
    t_start = time.time()
    print(f"\n📥 Received {len(files)} file(s)")
    
    # Read all files concurrently
    async def read_file(file: UploadFile):
        try:
            content = await file.read()
            return (content, sanitize_filename(file.filename or "unnamed.heic"))
        except Exception as e:
            return None
    
    read_tasks = [read_file(file) for file in files]
    file_data = await asyncio.gather(*read_tasks)
    
    # Filter out failed reads
    valid_files = [f for f in file_data if f is not None]
    
    if not valid_files:
        return JSONResponse(
            status_code=400,
            content={"error": "Failed to read any files"}
        )
    
    read_time = time.time() - t_start
    print(f"  📖 Read {len(valid_files)} files in {read_time*1000:.0f}ms")
    
    # Convert all files in parallel
    ip_address = request.client.host if request.client else "unknown"
    result = await process_batch_conversion_fast(valid_files, ip_address)
    
    # Record stats in background (don't wait)
    asyncio.create_task(record_conversion(result))
    
    # Handle all failures
    if result["success_count"] == 0:
        return JSONResponse(
            status_code=400,
            content={
                "error": f"All {result['total_files']} files failed",
                "details": result["failed_files"]
            }
        )
    
    converted = result["converted_files"]
    count = len(converted)
    
    # For any number of files, return ZIP if > 1
    if count == 1:
        # Single file - return directly
        f = converted[0]
        return Response(
            content=f["content"],
            media_type="image/png",
            headers={
                "Content-Disposition": f'attachment; filename="{f["output_filename"]}"',
                "X-Conversion-Time-Ms": str(round(result["duration_ms"])),
                "X-Files-Converted": "1"
            }
        )
    else:
        # Multiple files - create ZIP (using STORE for speed)
        zip_start = time.time()
        zip_content = create_zip_archive_fast(converted)
        zip_time = time.time() - zip_start
        print(f"  📦 ZIP created in {zip_time*1000:.0f}ms ({len(zip_content)/(1024*1024):.1f}MB)")
        
        total_time = time.time() - t_start
        print(f"  ✅ Total time: {total_time*1000:.0f}ms")
        
        return Response(
            content=zip_content,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="converted_{count}_images.zip"',
                "Content-Length": str(len(zip_content)),
                "X-Total-Time-Ms": str(round(total_time * 1000)),
                "X-Conversion-Time-Ms": str(round(result["duration_ms"])),
                "X-Files-Converted": str(count),
                "X-Files-Failed": str(result["error_count"])
            }
        )

@router.get("/stats")
async def conversion_stats():
    """Get conversion statistics."""
    try:
        return await get_stats()
    except Exception:
        return {"conversions_today": 0, "total_files_converted": 0}