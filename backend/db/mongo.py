import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# MongoDB configuration from .env
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("MONGODB_DB", "heic_converter")
MONGODB_MAX_POOL_SIZE = int(os.getenv("MONGODB_MAX_POOL_SIZE", 10))
MONGODB_MIN_POOL_SIZE = int(os.getenv("MONGODB_MIN_POOL_SIZE", 1))

# Initialize client and db as None
client: AsyncIOMotorClient = None
db = None

async def connect_to_mongo():
    """Connect to MongoDB and initialize database with indexes."""
    global client, db
    
    try:
        # Handle both regular and SRV connection strings
        if "mongodb+srv://" in MONGODB_URI:
            client = AsyncIOMotorClient(
                MONGODB_URI,
                maxPoolSize=MONGODB_MAX_POOL_SIZE,
                minPoolSize=MONGODB_MIN_POOL_SIZE,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=10000,
                retryWrites=True,
                w='majority'
            )
        else:
            client = AsyncIOMotorClient(
                MONGODB_URI,
                maxPoolSize=MONGODB_MAX_POOL_SIZE,
                minPoolSize=MONGODB_MIN_POOL_SIZE,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=10000
            )
        
        # Test the connection
        await client.admin.command('ping')
        print("✅ Successfully connected to MongoDB Atlas!")
        
        # Get database
        db = client[DATABASE_NAME]
        
        # Create indexes for better query performance
        await db.conversions.create_index("timestamp", background=True)
        await db.conversions.create_index("ip_hash", background=True)
        await db.conversions.create_index([("timestamp", -1)], background=True)
        
        print(f"✅ Database '{DATABASE_NAME}' initialized with indexes")
        
        return db
        
    except Exception as e:
        print(f"❌ Failed to connect to MongoDB: {str(e)}")
        raise e

async def close_mongo_connection():
    """Close MongoDB connection properly."""
    global client
    if client:
        try:
            client.close()
            print("✅ MongoDB connection closed successfully")
        except Exception as e:
            print(f"❌ Error closing MongoDB connection: {str(e)}")

async def get_database():
    """Get database instance. Throws error if not connected."""
    global db
    if db is None:
        raise Exception("Database not initialized. Call connect_to_mongo() first.")
    return db

# Helper functions for common operations
async def get_conversions_collection():
    """Get conversions collection."""
    database = await get_database()
    return database.get_collection("conversions")

async def check_connection():
    """Check if MongoDB connection is alive."""
    try:
        database = await get_database()
        await database.command('ping')
        return True
    except Exception:
        return False