from pydantic import BaseModel, Field
from typing import List, Optional

class OrderItem(BaseModel):
    id: int
    name: str
    price: float
    quantity: int = Field(ge=1)
    notes: Optional[str] = ""

class OrderCreateRequest(BaseModel):
    order_type: str # 'DINE_IN', 'TAKEAWAY', 'DELIVERY'
    table_number: Optional[str] = None
    party_size: Optional[int] = 1
    customer_name: str
    customer_phone: str
    delivery_address: Optional[str] = None
    items: List[OrderItem]
    coupon_code: Optional[str] = None
    payment_method: str = "UPI"
    scheduled_date: Optional[str] = None
    scheduled_slot: Optional[str] = None
    restaurant_id: Optional[str] = "cp-artisan"
    notes: Optional[str] = None
    tip_amount: float = Field(default=0.0, ge=0.0)
    no_cutlery: bool = False

class CouponValidateRequest(BaseModel):
    code: str
    subtotal: float
    customer_phone: Optional[str] = None
    items: Optional[List[dict]] = None

class StockToggleRequest(BaseModel):
    is_available: bool

class SlotCapacityUpdate(BaseModel):
    slot_date: str
    slot_time: str
    max_capacity: int = Field(ge=0)

class OrderStatusUpdate(BaseModel):
    status: str # 'PENDING', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'

class CancelOrderRequest(BaseModel):
    reason: Optional[str] = "Customer requested cancellation"

class ChatMessageRequest(BaseModel):
    message: str
    history: List[dict] = Field(default_factory=list)
    current_cart: List[dict] = Field(default_factory=list)

# Admin Portal Models
class AdminLoginRequest(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    pin: Optional[str] = None

class MenuItemUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = Field(default=None, gt=0)
    cost_price: Optional[float] = Field(default=None, ge=0)
    category_id: Optional[int] = None
    is_available: Optional[bool] = None
    is_bestseller: Optional[bool] = None
    calories: Optional[int] = None
    allergens: Optional[str] = None
    spice_level: Optional[str] = None

class NewDishRequest(BaseModel):
    category_id: int
    name: str
    description: str
    price: float = Field(gt=0)
    cost_price: Optional[float] = Field(default=0.0, ge=0)
    veg: int = 1
    spice_level: str = "Medium"
    image_url: Optional[str] = "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=60"
    prep_time_minutes: int = 15
    calories: Optional[int] = 250
    allergens: Optional[str] = "None"

class PromoCreateRequest(BaseModel):
    code: str
    title: Optional[str] = ""
    description: Optional[str] = ""
    discount_type: str = "PERCENT" # 'PERCENT' or 'FLAT'
    discount_value: float = Field(gt=0)
    min_order_value: float = Field(ge=0, default=150.0)
    max_discount: float = Field(gt=0, default=100.0)
    customer_tier: str = "ALL" # 'ALL', 'FIRST_TIME', 'REPEAT', 'REGULAR', 'VIP'
    min_visits: int = Field(ge=0, default=0)
    max_margin_share_pct: float = Field(ge=10.0, le=90.0, default=50.0) # Protects profit margin
    expires_in_days: int = Field(ge=1, default=30)

class StoreSettingsUpdateRequest(BaseModel):
    store_name: str
    tagline: Optional[str] = ""
    description: Optional[str] = ""
    location_name: str
    full_address: Optional[str] = ""
    opening_hours: Optional[str] = ""
    phone: Optional[str] = ""
    announcement: Optional[str] = ""

class RestaurantCreateRequest(BaseModel):
    id: Optional[str] = None
    name: str
    tagline: Optional[str] = ""
    description: Optional[str] = ""
    cuisine_type: Optional[str] = "Artisanal Indian Bites & Handcrafted Tapri Brews"
    location_name: str
    full_address: str
    city: str = "New Delhi"
    phone: str
    opening_hours: str = "10:00 AM - 10:30 PM Daily"
    rating: Optional[float] = 4.9
    delivery_time_mins: Optional[str] = "25-35 mins"
    price_for_two: Optional[str] = "₹350 for two"
    image_url: Optional[str] = "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&auto=format&fit=crop&q=60"
    table_count: Optional[int] = 20

class RestaurantUpdateRequest(BaseModel):
    name: Optional[str] = None
    tagline: Optional[str] = None
    description: Optional[str] = None
    cuisine_type: Optional[str] = None
    location_name: Optional[str] = None
    full_address: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    opening_hours: Optional[str] = None
    rating: Optional[float] = None
    delivery_time_mins: Optional[str] = None
    price_for_two: Optional[str] = None
    image_url: Optional[str] = None
    is_active: Optional[bool] = None
    table_count: Optional[int] = None

# ========================================================
# 1. AI Waste-to-Profit Engine Models
# ========================================================
class WasteDiscountApplyRequest(BaseModel):
    item_id: int
    discount_pct: float = Field(ge=5.0, le=75.0, default=30.0)
    duration_hours: float = Field(ge=0.5, le=24.0, default=3.0)
    quantity_available: int = Field(ge=1, default=5)
    reason: Optional[str] = "Excess Prep / Spoilage Prevention"
    restaurant_id: Optional[str] = "cp-artisan"

class WasteLogRecordRequest(BaseModel):
    item_id: int
    quantity_saved: int = Field(ge=1, default=1)
    rupees_saved: float = Field(ge=0.0)
    restaurant_id: Optional[str] = "cp-artisan"

# ========================================================
# 2. AI Marketing Autopilot Models
# ========================================================
class MarketingCampaignCreateRequest(BaseModel):
    campaign_name: str
    target_segment: str # 'CHURN_RISK', 'VIP_LOYALISTS', 'WEEKEND_REGULARS', 'BIRYANI_LOVERS', 'CHAI_SQUAD', 'NEW_LEADS', 'ALL'
    tone: Optional[str] = "TAPRI_HINGLISH" # 'FRIENDLY', 'TAPRI_HINGLISH', 'URGENT_FOMO', 'FESTIVE'
    discount_pct: Optional[float] = Field(ge=5.0, le=60.0, default=20.0)
    custom_prompt: Optional[str] = None
    promo_code: Optional[str] = None
    restaurant_id: Optional[str] = "cp-artisan"

class WhatsAppOfferSendRequest(BaseModel):
    customer_phone: str
    customer_name: str
    message_text: str
    promo_code: Optional[str] = None
    campaign_id: Optional[int] = None

# ========================================================
# 3. Group Hunger Network Models
# ========================================================
class GroupPoolCreateRequest(BaseModel):
    title: str
    pool_type: str = "STUDENT_HOSTEL" # 'STUDENT_HOSTEL', 'CORPORATE_OFFICE', 'RESIDENTIAL_SOCIETY', 'FRIENDS_COMMUNITY'
    location_name: str
    delivery_address: str
    creator_name: str
    creator_phone: str
    target_amount: Optional[float] = Field(ge=200.0, default=1200.0)
    duration_minutes: Optional[int] = Field(ge=10, le=180, default=45)
    restaurant_id: Optional[str] = "cp-artisan"

class GroupPoolJoinRequest(BaseModel):
    participant_name: str
    participant_phone: str
    items: List[OrderItem]
    notes: Optional[str] = ""

class GroupPoolFinalizeRequest(BaseModel):
    notes: Optional[str] = ""

# ========================================================
# 4. Offline Bharat Sync Models
# ========================================================
class OfflineSyncItem(BaseModel):
    offline_ref: str
    order_data: OrderCreateRequest
    offline_created_at: str

class OfflineSyncBatchRequest(BaseModel):
    orders: List[OfflineSyncItem]

