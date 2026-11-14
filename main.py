import os
import io
import csv
import json
import random
from datetime import datetime, timedelta
from typing import Optional, List
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Query, Header, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from database import (
    init_db,
    get_db_connection,
    create_bounce_back_coupon,
    verify_admin_login,
    verify_session_token,
    destroy_admin_session,
    seed_time_slots,
    get_all_restaurants,
    get_restaurant_by_id,
    get_safekitchen_audit
)
from models import (
    OrderCreateRequest,
    CouponValidateRequest,
    StockToggleRequest,
    SlotCapacityUpdate,
    OrderStatusUpdate,
    CancelOrderRequest,
    ChatMessageRequest,
    AdminLoginRequest,
    MenuItemUpdateRequest,
    NewDishRequest,
    PromoCreateRequest,
    StoreSettingsUpdateRequest,
    RestaurantCreateRequest,
    RestaurantUpdateRequest,
    WasteDiscountApplyRequest,
    WasteLogRecordRequest,
    MarketingCampaignCreateRequest,
    WhatsAppOfferSendRequest,
    GroupPoolCreateRequest,
    GroupPoolJoinRequest,
    GroupPoolFinalizeRequest,
    OfflineSyncBatchRequest
)
from chatbot_engine import process_chat_message
from waste_engine import (
    predict_daily_food_demand,
    apply_waste_discount,
    get_active_waste_deals,
    get_waste_impact_stats
)
from marketing_engine import (
    analyze_customer_rfm_segments,
    create_marketing_campaign,
    get_marketing_campaigns_list,
    generate_personalized_offer_copy
)
from group_hunger_engine import (
    create_group_pool,
    get_group_pool_details,
    join_group_pool,
    list_active_group_pools,
    finalize_group_pool_order
)
from offline_engine import (
    sync_single_offline_order,
    sync_batch_offline_orders
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(
    title="RasoiLink API",
    description="Zero-Commission Direct Mobile Ordering & Real-Time Kitchen Display System (KDS) for Local Cafes.",
    version="2.0.0",
    contact={
        "name": "Akshdeep Singh & Team TrueAddams",
        "url": "https://github.com/akshdeepsingh7/RasoiLink",
    },
    lifespan=lifespan,
)

# Enable CORS for flexible integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_customer_order_history(phone: Optional[str]) -> tuple[int, str]:
    """Returns (prior_orders_count, customer_tier) based on non-cancelled prior orders."""
    if not phone or not phone.strip():
        return 0, "FIRST_TIME"
    
    clean_phone = phone.strip()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT COUNT(*) FROM orders 
        WHERE customer_phone = ? AND order_status != 'CANCELLED'
    """, (clean_phone,))
    count = cursor.fetchone()[0]
    conn.close()

    if count == 0:
        tier = "FIRST_TIME"
    elif count < 3:
        tier = "REPEAT"
    elif count < 5:
        tier = "REGULAR"
    else:
        tier = "VIP"
    return count, tier

def calculate_cart_margin(conn, items: Optional[List[dict]], subtotal: float = 0.0) -> tuple[float, float]:
    """Calculates aggregate food cost (COGS) and gross margin for items in the cart.
    Returns (total_cost, gross_margin). If items is empty but subtotal is present, estimates
    standard cafe margin benchmark (35% COGS, 65% gross margin).
    """
    if not items:
        if subtotal > 0:
            cost = round(subtotal * 0.35, 2)
            margin = max(0.0, round(subtotal - cost, 2))
            return cost, margin
        return 0.0, 0.0

    cursor = conn.cursor()
    total_sale = 0.0
    total_cost = 0.0

    for it in items:
        item_id = it.get("id")
        qty = int(it.get("quantity", 1))
        price = float(it.get("price", 0.0))

        cursor.execute("SELECT price, cost_price FROM menu_items WHERE id = ?", (item_id,))
        row = cursor.fetchone()
        if row:
            db_price = row["price"]
            cost = row["cost_price"] if row["cost_price"] is not None and row["cost_price"] > 0 else (db_price * 0.35)
            total_sale += db_price * qty
            total_cost += cost * qty
        else:
            total_sale += price * qty
            total_cost += (price * 0.35) * qty

    gross_margin = max(0.0, total_sale - total_cost)
    return total_cost, gross_margin

def validate_and_calculate_discount(
    coupon: dict,
    subtotal: float,
    customer_phone: Optional[str] = None,
    items: Optional[List[dict]] = None,
    conn = None
) -> tuple[bool, float, str, dict]:
    """Validates coupon eligibility against customer frequency and limits discount based on dish margins.
    Returns (is_valid, discount_amount, message, metadata).
    """
    if not coupon.get("is_active"):
        return False, 0.0, "This promo code is no longer active.", {}
    if coupon.get("is_single_use") and coupon.get("is_used"):
        return False, 0.0, "This single-use voucher has already been redeemed.", {}
    if coupon.get("expires_at"):
        today_str = datetime.now().strftime("%Y-%m-%d")
        if coupon["expires_at"] < today_str:
            return False, 0.0, "This promo code has expired.", {}

    min_order = coupon.get("min_order_value", 0.0)
    if subtotal < min_order:
        return False, 0.0, f"Minimum order of ₹{min_order:.0f} required for this coupon.", {}

    # Customer Frequency & Repeat Order Validation
    visit_count, actual_tier = get_customer_order_history(customer_phone)
    required_tier = coupon.get("customer_tier", "ALL")
    min_visits = int(coupon.get("min_visits", 0) or 0)

    if customer_phone and customer_phone.strip():
        if required_tier == "FIRST_TIME" and visit_count > 0:
            return False, 0.0, f"Promo {coupon.get('code')} is exclusively for first-time diners! Welcome back! Try REPEAT15 for your return order.", {}
        if min_visits > 0 and visit_count < min_visits:
            needed = min_visits - visit_count
            return False, 0.0, f"Promo {coupon.get('code')} is reserved for regular patrons ({min_visits}+ completed orders). You have {visit_count} recorded visit(s). Complete {needed} more order(s) to unlock this club reward!", {}

    # Calculate nominal discount safely
    disc_val = float(coupon.get("discount_value") or 0.0)
    if coupon.get("discount_type") == "PERCENT":
        calc = (subtotal * disc_val) / 100.0
        max_disc = float(coupon["max_discount"]) if coupon.get("max_discount") is not None else calc
        nominal_discount = min(calc, max_disc)
    else:
        nominal_discount = min(disc_val, subtotal)

    # Margin-Based Discount Capping to Prevent Restaurant Losses
    max_margin_share_pct = float(coupon.get("max_margin_share_pct", 50.0) or 50.0)
    should_close_conn = False
    if conn is None:
        conn = get_db_connection()
        should_close_conn = True

    try:
        cogs, gross_margin = calculate_cart_margin(conn, items, subtotal=subtotal)
    finally:
        if should_close_conn:
            conn.close()

    margin_cap = None
    final_discount = nominal_discount
    margin_capped = False

    if gross_margin > 0:
        margin_cap = round(gross_margin * (max_margin_share_pct / 100.0), 2)
        if nominal_discount > margin_cap:
            # Protect restaurant margin: discount cannot exceed allocated share of gross profit
            final_discount = min(nominal_discount, max(0.0, margin_cap))
            margin_capped = True
    elif items:
        # Items were provided and produced no margin
        final_discount = 0.0
        margin_capped = True

    meta = {
        "customer_visit_count": visit_count,
        "customer_tier": actual_tier,
        "gross_margin": gross_margin,
        "margin_cap": margin_cap,
        "margin_capped": margin_capped,
        "food_cost": cogs
    }

    if margin_capped:
        msg = f"Applied {coupon.get('code')}! Margin-optimized discount of ₹{final_discount:.2f} granted based on your tray's fresh items."
    else:
        msg = f"Applied {coupon.get('code')} successfully! You saved ₹{final_discount:.2f}."

    return True, round(final_discount, 2), msg, meta

# Mount static files directory
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(STATIC_DIR):
    os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# HTML Page Routes
@app.get("/")
def serve_index():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "RasoiLink Frontend Loading..."}

@app.get("/kitchen.html")
@app.get("/kitchen")
@app.get("/admin")
@app.get("/dashboard")
def serve_kitchen():
    kitchen_file = os.path.join(STATIC_DIR, "kitchen.html")
    if os.path.exists(kitchen_file):
        return FileResponse(kitchen_file)
    return {"message": "RasoiLink Kitchen Board Loading..."}

@app.get("/landing")
@app.get("/landing.html")
@app.get("/home")
@app.get("/about")
def serve_landing():
    landing_file = os.path.join(STATIC_DIR, "landing.html")
    if os.path.exists(landing_file):
        return FileResponse(landing_file)
    return {"message": "RasoiLink Landing Page Loading..."}

@app.get("/sw.js")
def serve_service_worker():
    sw_file = os.path.join(STATIC_DIR, "sw.js")
    if os.path.exists(sw_file):
        return FileResponse(sw_file, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="Service worker not found")

# API Endpoints

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "RasoiLink",
        "groq_configured": bool(os.getenv("GROQ_API_KEY", "").strip()),
        "timestamp": datetime.now().isoformat()
    }

# ==========================================
# ADMIN AUTHENTICATION & DASHBOARD APIs
# ==========================================

@app.post("/api/admin/login")
def admin_login(req: AdminLoginRequest):
    auth = verify_admin_login(username=req.username, password=req.password, pin=req.pin)
    if not auth:
        raise HTTPException(status_code=401, detail="Invalid manager credentials or staff PIN.")
    return {"success": True, **auth}

@app.get("/api/admin/verify")
def admin_verify(token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    session_token = token if isinstance(token, str) else None
    auth_str = authorization if isinstance(authorization, str) else None
    if not session_token and auth_str and auth_str.startswith("Bearer "):
        session_token = auth_str.split(" ")[1]

    session = verify_session_token(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Session expired or invalid.")
    return {"valid": True, "session": session}

@app.post("/api/admin/logout")
def admin_logout(token: Optional[str] = None):
    token_str = token if isinstance(token, str) else None
    if token_str:
        destroy_admin_session(token_str)
    return {"success": True, "message": "Logged out successfully."}

@app.get("/api/admin/analytics")
def get_admin_analytics():
    conn = get_db_connection()
    cursor = conn.cursor()
    today_str = datetime.now().strftime("%Y-%m-%d")

    # 1. Total & Today's Volume
    cursor.execute("SELECT COUNT(*), COALESCE(SUM(total_amount), 0) FROM orders WHERE order_status != 'CANCELLED'")
    row_all = cursor.fetchone()
    total_orders = row_all[0]
    total_gross_revenue = round(row_all[1], 2)

    cursor.execute("""
        SELECT COUNT(*), COALESCE(SUM(total_amount), 0) 
        FROM orders 
        WHERE order_status != 'CANCELLED' AND created_at LIKE ?
    """, (f"{today_str}%",))
    row_today = cursor.fetchone()
    today_orders = row_today[0]
    today_sales = round(row_today[1], 2)

    # 2. Orders breakdown by type
    cursor.execute("""
        SELECT order_type, COUNT(*) as cnt, COALESCE(SUM(total_amount), 0) as total
        FROM orders
        WHERE order_status != 'CANCELLED'
        GROUP BY order_type
    """)
    type_breakdown = {row["order_type"]: {"count": row["cnt"], "revenue": round(row["total"], 2)} for row in cursor.fetchall()}

    # 3. Top Selling Dishes (from items_json)
    cursor.execute("SELECT items_json FROM orders WHERE order_status != 'CANCELLED'")
    item_counts = {}
    for row in cursor.fetchall():
        try:
            items = json.loads(row["items_json"])
            for it in items:
                name = it.get("name", "Unknown")
                qty = it.get("quantity", 1)
                item_counts[name] = item_counts.get(name, 0) + qty
        except Exception:
            pass

    sorted_top = sorted(item_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    top_dishes = [{"name": k, "sold_count": v} for k, v in sorted_top]

    # 4. Retention Coupon Stats
    cursor.execute("SELECT COUNT(*) FROM promo_codes WHERE code LIKE 'BACK50-%'")
    retention_issued = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM promo_codes WHERE code LIKE 'BACK50-%' AND is_used = 1")
    retention_redeemed = cursor.fetchone()[0]

    conn.close()

    return {
        "today_orders": today_orders,
        "today_sales": today_sales,
        "total_orders": total_orders,
        "total_gross_revenue": total_gross_revenue,
        "average_order_value": round(total_gross_revenue / max(1, total_orders), 2),
        "type_breakdown": type_breakdown,
        "top_dishes": top_dishes,
        "retention_coupons": {
            "issued": retention_issued,
            "redeemed": retention_redeemed,
            "redemption_rate": f"{round((retention_redeemed / max(1, retention_issued)) * 100, 1)}%"
        }
    }

@app.get("/api/admin/promos")
def get_admin_promos():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT code, title, description, discount_type, discount_value, min_order_value, max_discount,
               customer_tier, min_visits, max_margin_share_pct, is_active, is_single_use, is_used, expires_at
        FROM promo_codes
        ORDER BY is_active DESC, is_single_use ASC, code ASC
    """)
    promos = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"promos": promos}

@app.post("/api/admin/promos")
def create_custom_promo(req: PromoCreateRequest):
    code = req.code.strip().upper()
    expires_at = (datetime.now() + timedelta(days=req.expires_in_days)).strftime("%Y-%m-%d")
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            INSERT OR REPLACE INTO promo_codes (
                code, title, description, discount_type, discount_value, min_order_value, max_discount,
                customer_tier, min_visits, max_margin_share_pct, is_active, is_single_use, is_used, expires_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?)
        """, (
            code,
            req.title.strip() if req.title else f"{code} Special",
            req.description.strip() if req.description else "",
            req.discount_type.upper(),
            req.discount_value,
            req.min_order_value,
            req.max_discount,
            req.customer_tier.upper(),
            req.min_visits,
            req.max_margin_share_pct,
            expires_at
        ))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Promo code '{code}' already exists or invalid.")

    conn.close()
    return {"success": True, "code": code, "expires_at": expires_at}

@app.get("/api/store/settings")
def get_store_settings():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT store_name, tagline, description, location_name, full_address, opening_hours, phone, announcement, rating, reviews_count, updated_at
        FROM store_settings
        WHERE id = 1
    """)
    row = cursor.fetchone()
    conn.close()
    if not row:
        return {"settings": {
            "store_name": "RasoiLink Kitchen & Chai Bar",
            "tagline": "Artisanal Indian Bites & Handcrafted Tapri Brews",
            "description": "Authentic cutting chai, butter-loaded pav bhaji, hand-rolled parathas, and slow-cooked dum biryani prepared fresh to order.",
            "location_name": "Connaught Place, New Delhi",
            "full_address": "Shop 14, Block M, Inner Circle, Connaught Place, New Delhi - 110001",
            "opening_hours": "10:00 AM – 10:30 PM Daily",
            "phone": "+91 98765 43210",
            "announcement": "Freshly prepared to order. Zero aggregator markups!"
        }}
    return {"settings": dict(row)}

@app.post("/api/admin/store/settings")
def update_store_settings(req: StoreSettingsUpdateRequest):
    now_iso = datetime.now().isoformat()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE store_settings
        SET store_name = ?, tagline = ?, description = ?, location_name = ?, full_address = ?, opening_hours = ?, phone = ?, announcement = ?, updated_at = ?
        WHERE id = 1
    """, (
        req.store_name.strip(),
        req.tagline.strip() if req.tagline else "",
        req.description.strip() if req.description else "",
        req.location_name.strip(),
        req.full_address.strip() if req.full_address else "",
        req.opening_hours.strip() if req.opening_hours else "",
        req.phone.strip() if req.phone else "",
        req.announcement.strip() if req.announcement else "",
        now_iso
    ))
    if cursor.rowcount == 0:
        cursor.execute("""
            INSERT INTO store_settings (id, store_name, tagline, description, location_name, full_address, opening_hours, phone, announcement, updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            req.store_name.strip(),
            req.tagline.strip() if req.tagline else "",
            req.description.strip() if req.description else "",
            req.location_name.strip(),
            req.full_address.strip() if req.full_address else "",
            req.opening_hours.strip() if req.opening_hours else "",
            req.phone.strip() if req.phone else "",
            req.announcement.strip() if req.announcement else "",
            now_iso
        ))
    conn.commit()
    conn.close()
    return {"success": True, "message": "Store profile updated successfully."}

# ==========================================
# MULTI-RESTAURANT & OUTLET MANAGEMENT APIs
# ==========================================

@app.get("/api/restaurants")
def list_restaurants(active_only: bool = True):
    conn = get_db_connection()
    cursor = conn.cursor()
    query = "SELECT * FROM restaurants"
    if active_only:
        query += " WHERE is_active = 1"
    query += " ORDER BY id ASC"
    cursor.execute(query)
    restaurants = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return {"restaurants": restaurants}

@app.get("/api/restaurants/{restaurant_id}")
def get_restaurant(restaurant_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM restaurants WHERE id = ?", (restaurant_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Restaurant outlet not found")
    return {"restaurant": dict(row)}

# SafeKitchen Hygiene & Safety Protocol Audits
@app.get("/api/safekitchen/{restaurant_id}")
def get_safekitchen_status(restaurant_id: str):
    audit = get_safekitchen_audit(restaurant_id)
    if not audit:
        raise HTTPException(status_code=404, detail="SafeKitchen audit record not found for this outlet")
    return {
        "success": True,
        "restaurant_id": audit["restaurant_id"],
        "trust_score": audit["trust_score"],
        "fssai_license": audit["fssai_license"],
        "audit_date": audit["audit_date"],
        "auditor_name": audit["auditor_name"],
        "is_verified": bool(audit["is_verified"]),
        "checks": audit.get("checks", [])
    }

@app.get("/api/safekitchen")
def get_default_safekitchen_status(restaurant_id: Optional[str] = "cp-artisan"):
    rid = restaurant_id if (restaurant_id and isinstance(restaurant_id, str)) else "cp-artisan"
    return get_safekitchen_status(rid)

@app.post("/api/admin/restaurants")
def create_restaurant(req: RestaurantCreateRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    now_iso = datetime.now().isoformat()
    rest_id = req.id.strip().lower() if req.id else req.name.lower().replace(" ", "-")[:20]
    cursor.execute("SELECT id FROM restaurants WHERE id = ?", (rest_id,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail=f"Restaurant ID '{rest_id}' already exists.")

    cursor.execute("""
        INSERT INTO restaurants (
            id, name, slug, tagline, description, cuisine_type, location_name, full_address, city, phone, opening_hours, rating, reviews_count, delivery_time_mins, price_for_two, image_url, is_active, table_count, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 100, ?, ?, ?, 1, ?, ?)
    """, (
        rest_id,
        req.name.strip(),
        rest_id,
        req.tagline.strip() if req.tagline else "",
        req.description.strip() if req.description else "",
        req.cuisine_type.strip() if req.cuisine_type else "Artisanal Indian Bites & Handcrafted Tapri Brews",
        req.location_name.strip(),
        req.full_address.strip(),
        req.city.strip() if req.city else "New Delhi",
        req.phone.strip(),
        req.opening_hours.strip() if req.opening_hours else "10:00 AM - 10:30 PM Daily",
        req.rating or 4.9,
        req.delivery_time_mins or "25-35 mins",
        req.price_for_two or "₹350 for two",
        req.image_url or "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&auto=format&fit=crop&q=60",
        req.table_count or 20,
        now_iso
    ))
    conn.commit()
    conn.close()
    return {"success": True, "id": rest_id, "name": req.name}

@app.put("/api/admin/restaurants/{restaurant_id}")
def update_restaurant(restaurant_id: str, req: RestaurantUpdateRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM restaurants WHERE id = ?", (restaurant_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Restaurant outlet not found.")

    updates = []
    params = []
    for field, val in req.model_dump(exclude_unset=True).items():
        if field == "is_active":
            updates.append(f"{field} = ?")
            params.append(1 if val else 0)
        elif val is not None:
            updates.append(f"{field} = ?")
            params.append(val)

    if updates:
        params.append(restaurant_id)
        cursor.execute(f"UPDATE restaurants SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()

    conn.close()
    return {"success": True, "restaurant_id": restaurant_id}

@app.post("/api/admin/menu/item")
def create_menu_item(req: NewDishRequest):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM categories WHERE id = ?", (req.category_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=400, detail=f"Category ID {req.category_id} does not exist.")

        cursor.execute("""
            INSERT INTO menu_items (category_id, name, description, price, cost_price, veg, spice_level, image_url, is_available, prep_time_minutes, calories, allergens)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        """, (
            req.category_id,
            req.name.strip(),
            req.description.strip(),
            req.price,
            req.cost_price or (req.price * 0.35),
            req.veg,
            req.spice_level,
            req.image_url or "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=60",
            req.prep_time_minutes,
            req.calories or 250,
            req.allergens or "None"
        ))
        new_id = cursor.lastrowid
        conn.commit()
        return {"success": True, "id": new_id, "name": req.name}
    finally:
        conn.close()

@app.patch("/api/admin/menu/{item_id}")
def update_menu_item(item_id: int, req: MenuItemUpdateRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name FROM menu_items WHERE id = ?", (item_id,))
    item = cursor.fetchone()
    if not item:
        conn.close()
        raise HTTPException(status_code=404, detail="Item not found")

    updates = []
    params = []
    if req.name is not None and req.name.strip():
        updates.append("name = ?")
        params.append(req.name.strip())
    if req.description is not None:
        updates.append("description = ?")
        params.append(req.description.strip())
    if req.price is not None:
        updates.append("price = ?")
        params.append(req.price)
    if req.cost_price is not None:
        updates.append("cost_price = ?")
        params.append(req.cost_price)
    if req.category_id is not None:
        updates.append("category_id = ?")
        params.append(req.category_id)
    if req.spice_level is not None:
        updates.append("spice_level = ?")
        params.append(req.spice_level)
    if req.calories is not None:
        updates.append("calories = ?")
        params.append(req.calories)
    if req.allergens is not None:
        updates.append("allergens = ?")
        params.append(req.allergens)
    if req.is_available is not None:
        updates.append("is_available = ?")
        params.append(1 if req.is_available else 0)
    if req.is_bestseller is not None:
        updates.append("is_bestseller = ?")
        params.append(1 if req.is_bestseller else 0)

    if updates:
        params.append(item_id)
        cursor.execute(f"UPDATE menu_items SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()

    conn.close()
    return {"success": True, "item_id": item_id}

# ==========================================
# PUBLIC CATALOG & ORDER APIs
# ==========================================

@app.get("/api/menu")
def get_menu():
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id, name, icon, sort_order FROM categories ORDER BY sort_order ASC")
    categories = [dict(row) for row in cursor.fetchall()]

    cursor.execute("""
        SELECT id, category_id, name, description, price, cost_price, veg, spice_level, image_url, is_available, 
               prep_time_minutes, is_bestseller, calories, allergens
        FROM menu_items
        ORDER BY category_id ASC, id ASC
    """)
    items = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return {"categories": categories, "items": items}

@app.post("/api/menu/{item_id}/toggle-stock")
def toggle_stock(item_id: int, req: StockToggleRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name FROM menu_items WHERE id = ?", (item_id,))
    item = cursor.fetchone()
    if not item:
        conn.close()
        raise HTTPException(status_code=404, detail="Item not found")

    new_val = 1 if req.is_available else 0
    cursor.execute("UPDATE menu_items SET is_available = ? WHERE id = ?", (new_val, item_id))
    conn.commit()
    conn.close()
    return {"success": True, "item_id": item_id, "name": item["name"], "is_available": req.is_available}

@app.get("/api/slots")
def get_slots(date: Optional[str] = None):
    target_date = date if isinstance(date, str) and date.strip() else datetime.now().strftime("%Y-%m-%d")
    conn = get_db_connection()
    try:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, slot_date, slot_time, max_capacity
            FROM time_slots
            WHERE slot_date = ?
            ORDER BY slot_time ASC
        """, (target_date,))
        slots = [dict(row) for row in cursor.fetchall()]

        if not slots:
            seed_time_slots(conn)
            conn.commit()
            cursor.execute("""
                SELECT id, slot_date, slot_time, max_capacity
                FROM time_slots
                WHERE slot_date = ?
                ORDER BY slot_time ASC
            """, (target_date,))
            slots = [dict(row) for row in cursor.fetchall()]

        for slot in slots:
            cursor.execute("""
                SELECT COUNT(*) FROM orders
                WHERE scheduled_date = ? AND scheduled_slot = ? AND order_status != 'CANCELLED'
            """, (target_date, slot["slot_time"]))
            booked = cursor.fetchone()[0]
            slot["current_orders_count"] = booked
            slot["remaining_capacity"] = max(0, slot["max_capacity"] - booked)
            slot["is_full"] = booked >= slot["max_capacity"]

        return {"date": target_date, "slots": slots}
    finally:
        conn.close()

@app.post("/api/slots/capacity")
def update_slot_capacity(req: SlotCapacityUpdate):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE time_slots
        SET max_capacity = ?
        WHERE slot_date = ? AND slot_time = ?
    """, (req.max_capacity, req.slot_date, req.slot_time))

    if cursor.rowcount == 0:
        cursor.execute("""
            INSERT INTO time_slots (slot_date, slot_time, max_capacity)
            VALUES (?, ?, ?)
        """, (req.slot_date, req.slot_time, req.max_capacity))

    conn.commit()
    conn.close()
    return {"success": True, "slot_date": req.slot_date, "slot_time": req.slot_time, "max_capacity": req.max_capacity}

@app.post("/api/coupons/validate")
def validate_coupon(req: CouponValidateRequest):
    code = req.code.strip().upper()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT code, title, description, discount_type, discount_value, min_order_value, max_discount,
               customer_tier, min_visits, max_margin_share_pct, is_active, is_single_use, is_used, expires_at
        FROM promo_codes
        WHERE code = ?
    """, (code,))
    coupon = cursor.fetchone()

    if not coupon:
        conn.close()
        raise HTTPException(status_code=400, detail="Invalid promo code.")

    coupon_dict = dict(coupon)
    is_valid, discount_amount, message, meta = validate_and_calculate_discount(
        coupon_dict,
        req.subtotal,
        customer_phone=req.customer_phone,
        items=req.items,
        conn=conn
    )
    conn.close()

    if not is_valid:
        raise HTTPException(status_code=400, detail=message)

    return {
        "valid": True,
        "code": coupon_dict["code"],
        "title": coupon_dict.get("title", ""),
        "description": coupon_dict.get("description", ""),
        "discount_type": coupon_dict["discount_type"],
        "discount_value": coupon_dict["discount_value"],
        "discount_amount": discount_amount,
        "message": message,
        "customer_tier": meta.get("customer_tier"),
        "customer_visit_count": meta.get("customer_visit_count"),
        "gross_margin": meta.get("gross_margin"),
        "margin_capped": meta.get("margin_capped"),
        "margin_cap": meta.get("margin_cap")
    }

@app.post("/api/orders")
def create_order(req: OrderCreateRequest):
    if not req.items:
        raise HTTPException(status_code=400, detail="Order must contain at least one item.")

    channel = req.order_type.strip().upper() if req.order_type else "DINE_IN"
    if channel not in ("DINE_IN", "TAKEAWAY", "DELIVERY"):
        raise HTTPException(status_code=400, detail=f"Invalid dining channel '{req.order_type}'. Must be DINE_IN, TAKEAWAY, or DELIVERY.")

    if channel == "DINE_IN" and not (req.table_number and str(req.table_number).strip()):
        raise HTTPException(status_code=400, detail="Table number is required for Dine-In orders.")

    if channel == "DELIVERY" and not (req.delivery_address and req.delivery_address.strip()):
        raise HTTPException(status_code=400, detail="Delivery street address is required for Delivery orders.")

    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Check item availability and calculate verified subtotal
    subtotal = 0.0
    verified_items = []
    for item in req.items:
        cursor.execute("SELECT id, name, price, is_available FROM menu_items WHERE id = ?", (item.id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            raise HTTPException(status_code=400, detail=f"Item ID {item.id} not found in menu.")
        if not row["is_available"]:
            conn.close()
            raise HTTPException(status_code=400, detail=f"'{row['name']}' is currently out of stock.")

        item_subtotal = row["price"] * item.quantity
        subtotal += item_subtotal
        verified_items.append({
            "id": row["id"],
            "name": row["name"],
            "price": row["price"],
            "quantity": item.quantity,
            "notes": item.notes or ""
        })

    # 2. Check scheduled capacity if scheduling
    if req.scheduled_date and req.scheduled_slot:
        cursor.execute("""
            SELECT max_capacity FROM time_slots
            WHERE slot_date = ? AND slot_time = ?
        """, (req.scheduled_date, req.scheduled_slot))
        slot_row = cursor.fetchone()
        max_cap = slot_row["max_capacity"] if slot_row else 8

        cursor.execute("""
            SELECT COUNT(*) FROM orders
            WHERE scheduled_date = ? AND scheduled_slot = ? AND order_status != 'CANCELLED'
        """, (req.scheduled_date, req.scheduled_slot))
        current_booked = cursor.fetchone()[0]

        if current_booked >= max_cap:
            conn.close()
            raise HTTPException(
                status_code=400,
                detail=f"Slot '{req.scheduled_slot}' on {req.scheduled_date} is fully booked (Max {max_cap} orders). Please select another slot."
            )

    # 3. Validate coupon if provided
    discount_amount = 0.0
    applied_coupon_code = None
    if req.coupon_code:
        code_clean = req.coupon_code.strip().upper()
        cursor.execute("SELECT * FROM promo_codes WHERE code = ?", (code_clean,))
        c_row = cursor.fetchone()
        if c_row:
            is_valid, disc, _, _ = validate_and_calculate_discount(
                dict(c_row),
                subtotal,
                customer_phone=req.customer_phone,
                items=verified_items,
                conn=conn
            )
            if is_valid:
                applied_coupon_code = code_clean
                discount_amount = disc
                if c_row["is_single_use"]:
                    cursor.execute("UPDATE promo_codes SET is_used = 1 WHERE code = ?", (code_clean,))

    # 4. Calculate total amount
    tip = max(0.0, req.tip_amount)
    delivery_fee = 30.0 if req.order_type.upper() == "DELIVERY" else 0.0
    total_amount = max(0.0, subtotal - discount_amount) + delivery_fee + tip

    # 5. Generate unique Order Code
    order_code = f"RL-{random.randint(1000, 9999)}"
    cursor.execute("SELECT id FROM orders WHERE order_code = ?", (order_code,))
    while cursor.fetchone() is not None:
        order_code = f"RL-{random.randint(1000, 9999)}"

    # 6. Retention Engine: Generate single-use bounce-back coupon
    bounce_back_coupon = create_bounce_back_coupon(conn)

    # 7. Insert Order
    now_iso = datetime.now().isoformat()
    rest_id = req.restaurant_id.strip() if req.restaurant_id and req.restaurant_id.strip() else "cp-artisan"
    cursor.execute("""
        INSERT INTO orders (
            order_code, order_type, restaurant_id, table_number, party_size, customer_name, customer_phone, delivery_address,
            items_json, subtotal, discount_amount, coupon_code, total_amount, payment_status,
            payment_method, order_status, scheduled_date, scheduled_slot, bounce_back_coupon_code,
            notes, tip_amount, no_cutlery, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAID', ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        order_code,
        req.order_type.upper(),
        rest_id,
        req.table_number if req.order_type.upper() == "DINE_IN" else None,
        req.party_size if req.order_type.upper() == "DINE_IN" else 1,
        req.customer_name.strip(),
        req.customer_phone.strip(),
        req.delivery_address if req.order_type.upper() == "DELIVERY" else None,
        json.dumps(verified_items),
        subtotal,
        discount_amount,
        applied_coupon_code,
        total_amount,
        req.payment_method.upper(),
        req.scheduled_date,
        req.scheduled_slot,
        bounce_back_coupon,
        req.notes,
        tip,
        1 if req.no_cutlery else 0,
        now_iso,
        now_iso
    ))
    conn.commit()
    conn.close()

    return {
        "success": True,
        "order_code": order_code,
        "order_status": "PENDING",
        "restaurant_id": rest_id,
        "order_type": req.order_type.upper(),
        "table_number": req.table_number if req.order_type.upper() == "DINE_IN" else None,
        "party_size": req.party_size if req.order_type.upper() == "DINE_IN" else 1,
        "delivery_address": req.delivery_address if req.order_type.upper() == "DELIVERY" else None,
        "delivery_fee": delivery_fee,
        "notes": req.notes,
        "scheduled_date": req.scheduled_date,
        "scheduled_slot": req.scheduled_slot,
        "subtotal": subtotal,
        "discount_amount": discount_amount,
        "tip_amount": tip,
        "no_cutlery": req.no_cutlery,
        "total_amount": total_amount,
        "bounce_back_coupon": bounce_back_coupon,
        "bounce_back_coupon_code": bounce_back_coupon,
        "bounce_back_message": f"Thank you for dining with us! Here is your exclusive single-use voucher '{bounce_back_coupon}' for ₹50 OFF on your next visit (valid for 7 days).",
        "created_at": now_iso
    }

@app.get("/api/orders/{order_code}")
def get_order(order_code: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM orders WHERE order_code = ?
    """, (order_code.upper(),))
    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Order not found")

    order = dict(row)
    try:
        order["items"] = json.loads(order.get("items_json") or "[]")
    except Exception:
        order["items"] = []
    return order

@app.get("/api/orders")
def list_orders(status_filter: Optional[str] = None, restaurant_id: Optional[str] = None):
    conn = get_db_connection()
    cursor = conn.cursor()

    conditions = []
    params = []
    if status_filter:
        conditions.append("order_status = ?")
        params.append(status_filter.upper())
    if restaurant_id and restaurant_id.strip() and restaurant_id.upper() != "ALL":
        conditions.append("restaurant_id = ?")
        params.append(restaurant_id.strip())

    query = "SELECT * FROM orders"
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY id DESC"

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    orders = []
    for r in rows:
        d = dict(r)
        try:
            d["items"] = json.loads(d.get("items_json") or "[]")
        except Exception:
            d["items"] = []
        orders.append(d)

    return {"orders": orders}

@app.post("/api/orders/{order_code}/status")
def update_order_status(order_code: str, req: OrderStatusUpdate):
    valid_statuses = ["PENDING", "PREPARING", "READY", "COMPLETED", "CANCELLED"]
    new_status = req.status.upper()
    if new_status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'.")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, order_status FROM orders WHERE order_code = ?", (order_code.upper(),))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Order not found")

    now_iso = datetime.now().isoformat()
    cursor.execute("""
        UPDATE orders
        SET order_status = ?, updated_at = ?
        WHERE order_code = ?
    """, (new_status, now_iso, order_code.upper()))
    conn.commit()
    conn.close()

    return {"success": True, "order_code": order_code.upper(), "previous_status": row["order_status"], "new_status": new_status}

@app.get("/api/kitchen/stats")
def get_kitchen_stats(restaurant_id: Optional[str] = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    today_str = datetime.now().strftime("%Y-%m-%d")

    filter_clause = ""
    filter_params = []
    if restaurant_id and restaurant_id.strip() and restaurant_id.upper() != "ALL":
        filter_clause = " AND restaurant_id = ?"
        filter_params = [restaurant_id.strip()]

    cursor.execute(f"SELECT COUNT(*) FROM orders WHERE order_status NOT IN ('COMPLETED', 'CANCELLED'){filter_clause}", filter_params)
    active_count = cursor.fetchone()[0]

    cursor.execute(f"SELECT COUNT(*) FROM orders WHERE order_status = 'PENDING'{filter_clause}", filter_params)
    pending_count = cursor.fetchone()[0]

    cursor.execute(f"SELECT COUNT(*) FROM orders WHERE order_status = 'PREPARING'{filter_clause}", filter_params)
    preparing_count = cursor.fetchone()[0]

    cursor.execute(f"SELECT COUNT(*) FROM orders WHERE order_status = 'READY'{filter_clause}", filter_params)
    ready_count = cursor.fetchone()[0]

    cursor.execute(f"""
        SELECT COUNT(*), COALESCE(SUM(total_amount), 0)
        FROM orders
        WHERE order_status = 'COMPLETED' AND created_at LIKE ?{filter_clause}
    """, [f"{today_str}%"] + filter_params)
    comp_row = cursor.fetchone()
    completed_today = comp_row[0]

    cursor.execute(f"""
        SELECT COALESCE(SUM(total_amount), 0)
        FROM orders
        WHERE order_status != 'CANCELLED' AND created_at LIKE ?{filter_clause}
    """, [f"{today_str}%"] + filter_params)
    total_sales_today = round(cursor.fetchone()[0], 2)

    conn.close()

    return {
        "active_tickets": active_count,
        "pending_count": pending_count,
        "preparing_count": preparing_count,
        "ready_count": ready_count,
        "completed_today": completed_today,
        "today_revenue": total_sales_today,
        "avg_prep_time_minutes": 14
    }

@app.post("/api/orders/{order_code}/cancel")
def cancel_order(order_code: str, req: CancelOrderRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, order_status, scheduled_date, scheduled_slot FROM orders WHERE order_code = ?", (order_code.upper(),))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Order not found.")

    if row["order_status"] in ["READY", "COMPLETED"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Cannot cancel order that is already ready or completed.")

    now_iso = datetime.now().isoformat()
    cursor.execute("""
        UPDATE orders
        SET order_status = 'CANCELLED',
            updated_at = ?,
            notes = CASE
                WHEN notes IS NULL OR notes = '' THEN '[CANCELLED: ' || ? || ']'
                ELSE notes || ' [CANCELLED: ' || ? || ']'
            END
        WHERE order_code = ?
    """, (now_iso, req.reason or "Customer requested cancellation", req.reason or "Customer requested cancellation", order_code.upper()))

    conn.commit()
    conn.close()

    return {"success": True, "order_code": order_code.upper(), "order_status": "CANCELLED", "reason": req.reason}

@app.post("/api/chat")
def chat_endpoint(req: ChatMessageRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    result = process_chat_message(req.message, req.history, req.current_cart)
    return result

# ==========================================
# ACCOUNTING & REPORTING CSV EXPORT APIS
# ==========================================

@app.get("/api/admin/export/orders.csv")
def export_orders_csv(date: Optional[str] = None):
    """Exports orders into standard accounting CSV format."""
    conn = get_db_connection()
    cursor = conn.cursor()
    if date:
        cursor.execute("""
            SELECT order_code, order_type, customer_name, customer_phone, delivery_address,
                   table_number, party_size, scheduled_date, scheduled_slot, subtotal, discount_amount,
                   tip_amount, total_amount, payment_method, payment_status, order_status,
                   notes, items_json, created_at
            FROM orders
            WHERE DATE(created_at) = ? OR scheduled_date = ?
            ORDER BY id DESC
        """, (date, date))
    else:
        cursor.execute("""
            SELECT order_code, order_type, customer_name, customer_phone, delivery_address,
                   table_number, party_size, scheduled_date, scheduled_slot, subtotal, discount_amount,
                   tip_amount, total_amount, payment_method, payment_status, order_status,
                   notes, items_json, created_at
            FROM orders
            ORDER BY id DESC
        """)
    rows = cursor.fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Order Code", "Created At", "Channel", "Customer Name", "Phone",
        "Table No", "Party Size", "Delivery Address", "Scheduled Date", "Scheduled Slot", "Items Summary",
        "Subtotal (INR)", "Discount (INR)", "Tip (INR)", "Total (INR)",
        "Payment Method", "Payment Status", "Order Status", "Notes"
    ])

    for r in rows:
        items_summary = ""
        try:
            items_list = json.loads(r["items_json"])
            items_summary = "; ".join([f"{it.get('name')} x{it.get('quantity')}" for it in items_list])
        except Exception:
            items_summary = str(r["items_json"])

        writer.writerow([
            r["order_code"],
            r["created_at"],
            r["order_type"],
            r["customer_name"],
            r["customer_phone"],
            r["table_number"] or "-",
            r["party_size"] or 1,
            r["delivery_address"] or "-",
            r["scheduled_date"] or "-",
            r["scheduled_slot"] or "-",
            items_summary,
            f"{float(r['subtotal'] or 0.0):.2f}",
            f"{float(r['discount_amount'] or 0.0):.2f}",
            f"{float(r['tip_amount'] or 0.0):.2f}",
            f"{float(r['total_amount'] or 0.0):.2f}",
            r["payment_method"],
            r["payment_status"],
            r["order_status"],
            r["notes"] or ""
        ])

    csv_data = output.getvalue()
    filename = f"rasoilink_orders_{date or 'all'}.csv"
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/api/admin/export/daily-closing.csv")
def export_daily_closing_csv():
    """Generates daily aggregated financial and operational summary CSV."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            DATE(created_at) as report_date,
            COUNT(*) as total_orders,
            SUM(CASE WHEN order_status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_orders,
            SUM(CASE WHEN order_status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled_orders,
            SUM(CASE WHEN order_type = 'DINE_IN' AND order_status != 'CANCELLED' THEN 1 ELSE 0 END) as dine_in_count,
            SUM(CASE WHEN order_type = 'TAKEAWAY' AND order_status != 'CANCELLED' THEN 1 ELSE 0 END) as takeaway_count,
            SUM(CASE WHEN order_type = 'DELIVERY' AND order_status != 'CANCELLED' THEN 1 ELSE 0 END) as delivery_count,
            SUM(CASE WHEN order_status != 'CANCELLED' THEN subtotal ELSE 0 END) as gross_subtotal,
            SUM(CASE WHEN order_status != 'CANCELLED' THEN discount_amount ELSE 0 END) as total_discounts,
            SUM(CASE WHEN order_status != 'CANCELLED' THEN tip_amount ELSE 0 END) as total_tips,
            SUM(CASE WHEN order_status != 'CANCELLED' THEN total_amount ELSE 0 END) as net_revenue
        FROM orders
        GROUP BY DATE(created_at)
        ORDER BY report_date DESC
    """)
    rows = cursor.fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Date", "Total Orders", "Completed", "Cancelled",
        "Dine-In", "Takeaway", "Delivery",
        "Gross Subtotal (INR)", "Discounts (INR)", "Tips (INR)", "Net Revenue (INR)", "Avg Order Value (INR)"
    ])

    for r in rows:
        valid_orders = r["total_orders"] - r["cancelled_orders"]
        net_rev = r["net_revenue"] or 0.0
        aov = (net_rev / valid_orders) if valid_orders > 0 else 0.0
        writer.writerow([
            r["report_date"],
            r["total_orders"],
            r["completed_orders"],
            r["cancelled_orders"],
            r["dine_in_count"],
            r["takeaway_count"],
            r["delivery_count"],
            f"{r['gross_subtotal'] or 0:.2f}",
            f"{r['total_discounts'] or 0:.2f}",
            f"{r['total_tips'] or 0:.2f}",
            f"{net_rev:.2f}",
            f"{aov:.2f}"
        ])

    csv_data = output.getvalue()
    today_str = datetime.now().strftime("%Y-%m-%d")
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=rasoilink_daily_closing_{today_str}.csv"}
    )

# ========================================================
# 1. AI Waste-to-Profit Engine Endpoints
# ========================================================
@app.get("/api/waste-to-profit/predictions")
def get_waste_predictions(restaurant_id: Optional[str] = "cp-artisan"):
    """Predicts daily food demand, surplus inventory risk, and suggests dynamic discounts."""
    try:
        rid = restaurant_id if (restaurant_id and isinstance(restaurant_id, str)) else "cp-artisan"
        return predict_daily_food_demand(restaurant_id=rid)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/waste-to-profit/apply-discount")
def apply_waste_flash_discount(payload: WasteDiscountApplyRequest):
    """Triggers an AI-recommended flash discount on surplus/leftover items to convert waste into profit."""
    try:
        deal = apply_waste_discount(
            item_id=payload.item_id,
            discount_pct=payload.discount_pct,
            duration_hours=payload.duration_hours,
            quantity_available=payload.quantity_available,
            reason=payload.reason or "Surplus Inventory Reduction",
            restaurant_id=payload.restaurant_id or "cp-artisan"
        )
        return deal
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/waste-to-profit/active-deals")
def get_active_waste_flash_deals(restaurant_id: Optional[str] = "cp-artisan"):
    """Returns active Eco-Saver Flash Deals for customers and storefront banners."""
    try:
        rid = restaurant_id if (restaurant_id and isinstance(restaurant_id, str)) else "cp-artisan"
        return get_active_waste_deals(restaurant_id=rid)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/waste-to-profit/impact")
def get_waste_profit_impact(restaurant_id: Optional[str] = "cp-artisan"):
    """Returns real-time sustainability metrics: meals rescued, rupees saved, CO2 prevented."""
    try:
        rid = restaurant_id if (restaurant_id and isinstance(restaurant_id, str)) else "cp-artisan"
        return get_waste_impact_stats(restaurant_id=rid)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ========================================================
# 2. AI Marketing Autopilot Endpoints
# ========================================================
@app.get("/api/marketing/segments")
def get_marketing_rfm_segments(restaurant_id: Optional[str] = "cp-artisan"):
    """Performs RFM customer segmentation: Churn Risk, VIPs, Biryani Lovers, Chai Squad."""
    try:
        rid = restaurant_id if (restaurant_id and isinstance(restaurant_id, str)) else "cp-artisan"
        return analyze_customer_rfm_segments(restaurant_id=rid)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/marketing/campaigns")
def trigger_marketing_campaign(payload: MarketingCampaignCreateRequest):
    """Generates and deploys an AI WhatsApp marketing campaign targeting an RFM customer segment."""
    try:
        campaign = create_marketing_campaign(
            campaign_name=payload.campaign_name,
            target_segment=payload.target_segment,
            tone=payload.tone or "TAPRI_HINGLISH",
            discount_pct=payload.discount_pct or 20.0,
            custom_prompt=payload.custom_prompt,
            promo_code=payload.promo_code,
            restaurant_id=payload.restaurant_id or "cp-artisan"
        )
        return campaign
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/marketing/campaigns")
def get_campaigns_history():
    """Returns list of past autopilot campaigns with performance metrics and conversions."""
    try:
        return get_marketing_campaigns_list()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/marketing/preview-offer")
def preview_personalized_offer(
    name: str = "Rohan",
    phone: str = "+91 98112 34567",
    segment: str = "CHURN_RISK",
    tone: str = "TAPRI_HINGLISH",
    discount_pct: float = 25.0,
    promo_code: str = "MISSYOU25",
    favorite_dish: str = "Masala Cutting Chai"
):
    """Generates preview copy and WhatsApp click-to-chat URL for an individual patron."""
    try:
        return generate_personalized_offer_copy(
            name=name,
            phone=phone,
            segment=segment,
            tone=tone,
            discount_pct=discount_pct,
            promo_code=promo_code,
            favorite_dish=favorite_dish
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ========================================================
# 3. Group Hunger Network Endpoints
# ========================================================
@app.post("/api/group-pools")
def create_new_group_pool(payload: GroupPoolCreateRequest):
    """Creates a new food order pool for college hostels, offices, or residential societies."""
    try:
        pool = create_group_pool(
            title=payload.title,
            pool_type=payload.pool_type,
            location_name=payload.location_name,
            delivery_address=payload.delivery_address,
            creator_name=payload.creator_name,
            creator_phone=payload.creator_phone,
            target_amount=payload.target_amount or 1200.0,
            duration_minutes=payload.duration_minutes or 45,
            restaurant_id=payload.restaurant_id or "cp-artisan"
        )
        return pool
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/group-pools")
def get_active_group_pools(restaurant_id: Optional[str] = "cp-artisan"):
    """Discovers open group pools near the user's campus or locality."""
    try:
        rid = restaurant_id if (restaurant_id and isinstance(restaurant_id, str)) else "cp-artisan"
        return list_active_group_pools(restaurant_id=rid)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/group-pools/{pool_code}")
def get_pool_by_code(pool_code: str):
    """Fetches real-time status of a group pool: members, total amount, unlocked discount tier, countdown."""
    pool = get_group_pool_details(pool_code)
    if not pool:
        raise HTTPException(status_code=404, detail=f"Group pool '{pool_code}' not found.")
    return pool

@app.post("/api/group-pools/{pool_code}/join")
def join_existing_group_pool(pool_code: str, payload: GroupPoolJoinRequest):
    """Adds items to an active group pool and unlocks higher pooled discount tiers."""
    try:
        items_dict = [itm.model_dump() for itm in payload.items]
        updated_pool = join_group_pool(
            pool_code=pool_code,
            participant_name=payload.participant_name,
            participant_phone=payload.participant_phone,
            items=items_dict,
            notes=payload.notes or ""
        )
        return updated_pool
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/group-pools/{pool_code}/finalize")
def finalize_group_pool(pool_code: str, payload: GroupPoolFinalizeRequest):
    """Closes pool, generates a consolidated master order for the kitchen."""
    try:
        finalized = finalize_group_pool_order(pool_code=pool_code, notes=payload.notes or "")
        return finalized
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ========================================================
# 4. Offline-First Bharat Mode Endpoints
# ========================================================
@app.post("/api/orders/sync-offline")
def sync_single_order_offline(order_data: dict):
    """Synchronizes a single locally queued offline order from customer or staff device."""
    try:
        return sync_single_offline_order(order_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/orders/sync-batch")
def sync_batch_orders_offline(payload: OfflineSyncBatchRequest):
    """Synchronizes a batch of offline orders queued during internet disconnection."""
    try:
        orders_list = [itm.model_dump() for itm in payload.orders]
        return sync_batch_offline_orders(orders_list)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/orders/offline-status")
def get_offline_sync_status(restaurant_id: Optional[str] = "cp-artisan"):
    """Returns statistics on offline orders received and synchronized."""
    rid = restaurant_id if (restaurant_id and isinstance(restaurant_id, str)) else "cp-artisan"
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT COUNT(*) as total_offline_synced,
               COALESCE(SUM(total_amount), 0) as total_offline_revenue
        FROM orders
        WHERE offline_synced = 1 AND (restaurant_id = ? OR restaurant_id IS NULL)
    """, (rid,))
    res = dict(cursor.fetchone())
    conn.close()
    return {
        "restaurant_id": rid,
        "total_offline_synced": res["total_offline_synced"],
        "total_offline_revenue": round(res["total_offline_revenue"], 2),
        "status": "ONLINE",
        "sync_protocol": "Bharat-Mode-v2-WAL"
    }

