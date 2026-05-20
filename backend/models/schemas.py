from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class ConversionRecord(BaseModel):
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    file_count: int
    total_input_bytes: int
    total_output_bytes: int
    duration_ms: float
    ip_hash: str
    filenames: List[str] = []

class StatsResponse(BaseModel):
    total_files_converted: int
    total_mb_processed: float
    total_conversions: int
    conversions_today: int

class ErrorResponse(BaseModel):
    error: str
    code: str
    details: Optional[str] = None

class ConversionFile(BaseModel):
    filename: str
    original_size: int
    converted_size: Optional[int] = None
    status: str
    error: Optional[str] = None