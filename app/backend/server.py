from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
import jwt
from enum import Enum


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI(title="KickShop API", description="API pour site e-commerce de chaussures")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Security
security = HTTPBearer()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
SECRET_KEY = "your-secret-key-here"  # In production, use environment variable
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Enums
class ShoeCategory(str, Enum):
    SNEAKERS = "sneakers"
    BOOTS = "boots"
    CASUAL = "casual"
    ATHLETIC = "athletic"
    FORMAL = "formal"

class ShoeBrand(str, Enum):
    NIKE = "Nike"
    ADIDAS = "Adidas"
    PUMA = "Puma"
    CONVERSE = "Converse"
    VANS = "Vans"
    TIMBERLAND = "Timberland"

# Models
class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: EmailStr
    full_name: str
    hashed_password: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str
    created_at: datetime

class Product(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str
    price: float
    brand: ShoeBrand
    category: ShoeCategory
    sizes: List[float]
    image_url: str
    stock: int = 100
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CartItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    product_id: str
    size: float
    quantity: int = 1
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CartItemCreate(BaseModel):
    product_id: str
    size: float
    quantity: int = 1

class Order(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    items: List[CartItem]
    total_amount: float
    status: str = "pending"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Token(BaseModel):
    access_token: str
    token_type: str

# Helper functions
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
    user = await db.users.find_one({"email": email})
    if user is None:
        raise credentials_exception
    return User(**user)

# Authentication endpoints
@api_router.post("/auth/register", response_model=UserResponse)
async def register(user: UserCreate):
    # Check if user exists
    existing_user = await db.users.find_one({"email": user.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create new user
    hashed_password = get_password_hash(user.password)
    user_dict = user.dict()
    del user_dict["password"]
    user_dict["hashed_password"] = hashed_password
    
    new_user = User(**user_dict)
    await db.users.insert_one(new_user.dict())
    
    return UserResponse(**new_user.dict())

@api_router.post("/auth/login", response_model=Token)
async def login(user_credentials: UserLogin):
    user = await db.users.find_one({"email": user_credentials.email})
    if not user or not verify_password(user_credentials.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user["email"]}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@api_router.get("/auth/me", response_model=UserResponse)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return UserResponse(**current_user.dict())

# Product endpoints
@api_router.get("/products", response_model=List[Product])
async def get_products(category: Optional[ShoeCategory] = None, brand: Optional[ShoeBrand] = None):
    query = {}
    if category:
        query["category"] = category
    if brand:
        query["brand"] = brand
    
    products = await db.products.find(query).to_list(100)
    return [Product(**product) for product in products]

@api_router.get("/products/{product_id}", response_model=Product)
async def get_product(product_id: str):
    product = await db.products.find_one({"id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return Product(**product)

# Cart endpoints
@api_router.post("/cart/add")
async def add_to_cart(cart_item: CartItemCreate, current_user: User = Depends(get_current_user)):
    # Check if product exists
    product = await db.products.find_one({"id": cart_item.product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    # Check if item already in cart
    existing_item = await db.cart_items.find_one({
        "user_id": current_user.id,
        "product_id": cart_item.product_id,
        "size": cart_item.size
    })
    
    if existing_item:
        # Update quantity
        new_quantity = existing_item["quantity"] + cart_item.quantity
        await db.cart_items.update_one(
            {"id": existing_item["id"]},
            {"$set": {"quantity": new_quantity}}
        )
        return {"message": "Quantity updated"}
    else:
        # Add new item
        item_dict = cart_item.dict()
        item_dict["user_id"] = current_user.id
        new_cart_item = CartItem(**item_dict)
        await db.cart_items.insert_one(new_cart_item.dict())
        return {"message": "Item added to cart"}

@api_router.get("/cart", response_model=List[CartItem])
async def get_cart(current_user: User = Depends(get_current_user)):
    cart_items = await db.cart_items.find({"user_id": current_user.id}).to_list(100)
    return [CartItem(**item) for item in cart_items]

@api_router.delete("/cart/{item_id}")
async def remove_from_cart(item_id: str, current_user: User = Depends(get_current_user)):
    result = await db.cart_items.delete_one({"id": item_id, "user_id": current_user.id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Cart item not found")
    return {"message": "Item removed from cart"}

# Initialize sample products
@api_router.post("/init-products")
async def init_products():
    sample_products = [
        {
            "name": "Nike Air Force 1",
            "description": "Chaussures de basketball iconiques avec un style intemporel",
            "price": 89.99,
            "brand": "Nike",
            "category": "sneakers",
            "sizes": [36, 37, 38, 39, 40, 41, 42, 43, 44, 45],
            "image_url": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1Nzh8MHwxfHNlYXJjaHwxfHxzaG9lc3xlbnwwfHx8fDE3NTg2Mjg2NTR8MA&ixlib=rb-4.1.0&q=85"
        },
        {
            "name": "Baskets Athlétiques Blanches",
            "description": "Baskets sport moderne pour un look décontracté",
            "price": 65.99,
            "brand": "Nike",
            "category": "athletic",
            "sizes": [36, 37, 38, 39, 40, 41, 42, 43, 44],
            "image_url": "https://images.unsplash.com/photo-1560769629-975ec94e6a86?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1Nzh8MHwxfHNlYXJjaHwyfHxzaG9lc3xlbnwwfHx8fDE3NTg2Mjg2NTR8MA&ixlib=rb-4.1.0&q=85"
        },
        {
            "name": "Nike Air Force Colorées",
            "description": "Version colorée des célèbres Air Force avec design moderne",
            "price": 95.99,
            "brand": "Nike",
            "category": "sneakers",
            "sizes": [37, 38, 39, 40, 41, 42, 43, 44, 45],
            "image_url": "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzd8MHwxfHNlYXJjaHwxfHxzbmVha2Vyc3xlbnwwfHx8fDE3NTg2Mjg2NjB8MA&ixlib=rb-4.1.0&q=85"
        },
        {
            "name": "Nike High-Top Blanches",
            "description": "Baskets montantes premium avec finition soignée",
            "price": 79.99,
            "brand": "Nike",
            "category": "sneakers",
            "sizes": [36, 37, 38, 39, 40, 41, 42, 43, 44],
            "image_url": "https://images.unsplash.com/photo-1512374382149-233c42b6a83b?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzd8MHwxfHNlYXJjaHwzfHxzbmVha2Vyc3xlbnwwfHx8fDE3NTg2Mjg2NjB8MA&ixlib=rb-4.1.0&q=85"
        },
        {
            "name": "Air Jordan 1",
            "description": "Baskets légendaires avec l'héritage Jordan",
            "price": 149.99,
            "brand": "Nike",
            "category": "sneakers",
            "sizes": [38, 39, 40, 41, 42, 43, 44, 45],
            "image_url": "https://images.unsplash.com/photo-1552346154-21d32810aba3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzd8MHwxfHNlYXJjaHw0fHxzbmVha2Vyc3xlbnwwfHx8fDE3NTg2Mjg2NjB8MA&ixlib=rb-4.1.0&q=85"
        },
        {
            "name": "Chaussures Décontractées Bordeaux",
            "description": "Style décontracté parfait pour le quotidien",
            "price": 55.99,
            "brand": "Vans",
            "category": "casual",
            "sizes": [36, 37, 38, 39, 40, 41, 42, 43],
            "image_url": "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1Nzh8MHwxfHNlYXJjaHwzfHxzaG9lc3xlbnwwfHx8fDE3NTg2Mjg2NTR8MA&ixlib=rb-4.1.0&q=85"
        },
        {
            "name": "Bottes en Cuir Marron",
            "description": "Bottes robustes en cuir véritable avec lacets",
            "price": 129.99,
            "brand": "Timberland",
            "category": "boots",
            "sizes": [38, 39, 40, 41, 42, 43, 44, 45],
            "image_url": "https://images.unsplash.com/photo-1605812860427-4024433a70fd?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Njl8MHwxfHNlYXJjaHwxfHxib290c3xlbnwwfHx8fDE3NTg2Mjg2NjR8MA&ixlib=rb-4.1.0&q=85"
        },
        {
            "name": "Bottes Classiques Cuir",
            "description": "Bottes élégantes pour toutes les occasions",
            "price": 159.99,
            "brand": "Timberland",
            "category": "boots",
            "sizes": [39, 40, 41, 42, 43, 44, 45],
            "image_url": "https://images.unsplash.com/photo-1608256246200-53e635b5b65f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Njl8MHwxfHNlYXJjaHwyfHxib290c3xlbnwwfHx8fDE3NTg2Mjg2NjR8MA&ixlib=rb-4.1.0&q=85"
        }
    ]
    
    # Clear existing products
    await db.products.delete_many({})
    
    # Insert sample products
    products = []
    for product_data in sample_products:
        product = Product(**product_data)
        await db.products.insert_one(product.dict())
        products.append(product)
    
    return {"message": f"Initialized {len(products)} products"}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()