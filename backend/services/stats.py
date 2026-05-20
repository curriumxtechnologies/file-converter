from datetime import datetime, timedelta
from db.mongo import get_database, check_connection
import logging

logger = logging.getLogger(__name__)

async def record_conversion(stats_data: dict):
    """
    Record conversion event in MongoDB.
    Continues even if database is unavailable.
    """
    try:
        # Check if database is available
        if not await check_connection():
            logger.warning("Database not available, skipping stats recording")
            return None
        
        db = await get_database()
        
        document = {
            "timestamp": datetime.utcnow(),
            "file_count": stats_data.get("file_count", 0),
            "total_input_bytes": stats_data.get("total_input_bytes", 0),
            "total_output_bytes": stats_data.get("total_output_bytes", 0),
            "duration_ms": stats_data.get("duration_ms", 0),
            "ip_hash": stats_data.get("ip_hash", ""),
            "filenames": [f[1] for f in stats_data.get("converted_files", [])],
            "error_count": stats_data.get("error_count", 0)
        }
        
        result = await db.conversions.insert_one(document)
        logger.info(f"Recorded conversion with ID: {result.inserted_id}")
        return result.inserted_id
        
    except Exception as e:
        logger.error(f"Failed to record conversion stats: {str(e)}")
        # Don't raise the error - stats recording should not break the API
        return None

async def get_stats() -> dict:
    """
    Get aggregate conversion statistics.
    Returns default values if database is unavailable.
    """
    try:
        # Check if database is available
        if not await check_connection():
            logger.warning("Database not available, returning default stats")
            return get_default_stats()
        
        db = await get_database()
        
        # Get all-time stats using aggregation pipeline
        all_time_pipeline = [
            {
                "$group": {
                    "_id": None,
                    "total_files": {"$sum": "$file_count"},
                    "total_input_bytes": {"$sum": "$total_input_bytes"},
                    "total_output_bytes": {"$sum": "$total_output_bytes"},
                    "total_conversions": {"$sum": 1},
                    "avg_duration_ms": {"$avg": "$duration_ms"}
                }
            }
        ]
        
        all_time_results = await db.conversions.aggregate(all_time_pipeline).to_list(length=1)
        
        # Get today's stats
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        today_pipeline = [
            {
                "$match": {
                    "timestamp": {"$gte": today_start}
                }
            },
            {
                "$group": {
                    "_id": None,
                    "total_files": {"$sum": "$file_count"},
                    "total_conversions": {"$sum": 1},
                    "total_input_bytes": {"$sum": "$total_input_bytes"}
                }
            }
        ]
        
        today_results = await db.conversions.aggregate(today_pipeline).to_list(length=1)
        
        # Parse results
        all_time_data = all_time_results[0] if all_time_results else {}
        today_data = today_results[0] if today_results else {}
        
        return {
            "total_files_converted": all_time_data.get("total_files", 0),
            "total_mb_processed": round(all_time_data.get("total_input_bytes", 0) / (1024 * 1024), 2),
            "total_conversions": all_time_data.get("total_conversions", 0),
            "conversions_today": today_data.get("total_files", 0),
            "average_duration_ms": round(all_time_data.get("avg_duration_ms", 0), 2),
            "total_output_mb": round(all_time_data.get("total_output_bytes", 0) / (1024 * 1024), 2)
        }
        
    except Exception as e:
        logger.error(f"Failed to get stats: {str(e)}")
        return get_default_stats()

def get_default_stats() -> dict:
    """Return default stats structure."""
    return {
        "total_files_converted": 0,
        "total_mb_processed": 0.0,
        "total_conversions": 0,
        "conversions_today": 0,
        "average_duration_ms": 0.0,
        "total_output_mb": 0.0
    }