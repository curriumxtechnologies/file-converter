import io
import os
import re
import hashlib
import asyncio
from typing import List, Tuple, Dict, Any
from datetime import datetime
import zipfile
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
from functools import partial
import multiprocessing

from PIL import Image
from pillow_heif import register_heif_opener
import aiofiles

register_heif_opener()

# Optimize Pillow settings
Image.MAX_IMAGE_PIXELS = None  # Remove size limits
Image.warnings.simplefilter('ignore')  # Suppress warnings for speed

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

# Use CPU cores for parallel processing
CPU_COUNT = multiprocessing.cpu_count()
OPTIMAL_WORKERS = max(CPU_COUNT - 1, 2)  # Leave one core free
print(f"🚀 Using {OPTIMAL_WORKERS} workers for parallel conversion")

# Thread pool for CPU-intensive tasks
thread_pool = ThreadPoolExecutor(max_workers=OPTIMAL_WORKERS * 2)

# Process pool for heavy conversions
process_pool = ProcessPoolExecutor(max_workers=OPTIMAL_WORKERS)

def sanitize_filename(filename: str) -> str:
    """Fast filename sanitization."""
    # Quick sanitize - remove path separators and dangerous chars
    filename = re.sub(r'[<>:"/\\|?*\x00]', '_', filename)
    # Ensure no leading/trailing dots or spaces
    filename = filename.strip('. ')
    if not filename:
        filename = 'unnamed'
    if len(filename) > 200:
        name, ext = os.path.splitext(filename)
        filename = name[:195] + ext
    return filename

def validate_heic_magic_bytes(content: bytes) -> bool:
    """Quick HEIC validation."""
    if len(content) < 12:
        return False
    # Fast check for ftyp box
    return content[4:8] == b'ftyp'

def hash_ip(ip: str) -> str:
    """Hash IP address."""
    return hashlib.sha256(ip.encode()).hexdigest()

def convert_heic_bytes_sync(file_content: bytes) -> Tuple[bytes, int]:
    """
    Synchronous conversion function - runs in thread pool.
    This is the core conversion that's parallelized.
    """
    try:
        # Open from memory
        image = Image.open(io.BytesIO(file_content))
        
        # Fast conversion - convert mode if needed
        if image.mode not in ('RGB', 'RGBA'):
            image = image.convert('RGB')
        
        # Optimize for speed
        # Resize if image is huge (> 4000px) to speed up encoding
        max_dimension = 4000
        if max(image.size) > max_dimension:
            ratio = max_dimension / max(image.size)
            new_size = tuple(int(dim * ratio) for dim in image.size)
            image = image.resize(new_size, Image.LANCZOS)
        
        # Save to PNG with speed optimizations
        output = io.BytesIO()
        image.save(
            output,
            format='PNG',
            optimize=False,  # Disable optimization for speed
            compress_level=1  # Fast compression (0-9, lower = faster)
        )
        
        return output.getvalue()
        
    except Exception as e:
        raise ValueError(f"Conversion failed: {str(e)}")

async def convert_heic_to_png_fast(
    file_content: bytes, 
    filename: str
) -> Dict[str, Any]:
    """
    Convert a single HEIC file to PNG using thread pool for parallelism.
    """
    try:
        # Run conversion in thread pool (non-blocking)
        loop = asyncio.get_event_loop()
        converted_content = await loop.run_in_executor(
            thread_pool,
            convert_heic_bytes_sync,
            file_content
        )
        
        output_filename = sanitize_filename(
            os.path.splitext(filename)[0] + '.png'
        )
        
        return {
            "success": True,
            "filename": filename,
            "output_filename": output_filename,
            "content": converted_content,
            "output_size": len(converted_content),
            "input_size": len(file_content)
        }
        
    except Exception as e:
        return {
            "success": False,
            "filename": filename,
            "error": str(e),
            "input_size": len(file_content)
        }

async def process_batch_conversion_fast(
    files: List[Tuple[bytes, str]], 
    ip_address: str
) -> Dict[str, Any]:
    """
    Ultra-fast batch processing - all files converted in parallel.
    """
    start_time = datetime.utcnow()
    
    # Pre-validate all files first (fast)
    valid_files = []
    invalid_files = []
    
    for content, filename in files:
        if len(content) > MAX_FILE_SIZE:
            invalid_files.append({
                "filename": filename,
                "error": f"File size exceeds 50MB limit ({len(content) / (1024*1024):.1f}MB)",
                "input_size": len(content)
            })
        elif not validate_heic_magic_bytes(content):
            invalid_files.append({
                "filename": filename,
                "error": "Invalid HEIC format",
                "input_size": len(content)
            })
        else:
            valid_files.append((content, filename))
    
    print(f"  ✓ {len(valid_files)} valid files, ✗ {len(invalid_files)} invalid")
    
    # Convert all valid files IN PARALLEL (this is the key optimization)
    if valid_files:
        tasks = [
            convert_heic_to_png_fast(content, filename)
            for content, filename in valid_files
        ]
        results = await asyncio.gather(*tasks)  # All run concurrently!
    else:
        results = []
    
    # Separate successes and failures
    converted_files = []
    failed_files = invalid_files.copy()
    
    for result in results:
        if result["success"]:
            converted_files.append(result)
        else:
            failed_files.append(result)
    
    # Calculate stats
    total_input = sum(f.get("input_size", 0) for f in converted_files)
    total_output = sum(f.get("output_size", 0) for f in converted_files)
    duration = (datetime.utcnow() - start_time).total_seconds() * 1000
    
    print(f"  ⚡ Converted {len(converted_files)} files in {duration:.0f}ms")
    print(f"  📊 {total_input / (1024*1024):.1f}MB → {total_output / (1024*1024):.1f}MB")
    if converted_files:
        avg_time = duration / len(converted_files)
        print(f"  ⏱️ Average: {avg_time:.0f}ms per file")
    
    return {
        "total_files": len(files),
        "success_count": len(converted_files),
        "error_count": len(failed_files),
        "total_input_bytes": total_input,
        "total_output_bytes": total_output,
        "duration_ms": duration,
        "converted_files": converted_files,
        "failed_files": failed_files,
        "ip_hash": hash_ip(ip_address)
    }

def create_zip_archive_fast(files_data: List[Dict[str, Any]]) -> bytes:
    """
    Create ZIP archive with minimal compression for speed.
    For PNG files (already compressed), use STORE method.
    """
    zip_buffer = io.BytesIO()
    used_names = set()
    
    # Use ZIP_STORED for PNG files (they're already compressed)
    # This is MUCH faster than compressing again
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_STORED) as zf:
        for file_data in files_data:
            filename = file_data["output_filename"]
            
            # Handle duplicates
            if filename in used_names:
                name, ext = os.path.splitext(filename)
                counter = 1
                while f"{name}_{counter}{ext}" in used_names:
                    counter += 1
                filename = f"{name}_{counter}{ext}"
            
            used_names.add(filename)
            zf.writestr(filename, file_data["content"])
    
    return zip_buffer.getvalue()