import sqlite3
import os
import random
import string
import hashlib
import json
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), "rasoilink.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def hash_secret(secret: str) -> str:
    """Simple SHA256 hashing for password storage."""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()

def init_db():
    conn = sqlite3.connect(DB_PATH, timeout=15.0)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    cursor = conn.cursor()

    # 1. Categories
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        icon TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0
    );
    """)

    # 2. Menu Items
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        cost_price REAL DEFAULT 0.0,
        veg INTEGER DEFAULT 1,
        spice_level TEXT DEFAULT 'Mild',
        image_url TEXT,
        is_available INTEGER DEFAULT 1,
        prep_time_minutes INTEGER DEFAULT 15,
        is_bestseller INTEGER DEFAULT 0,
        calories INTEGER DEFAULT 250,
        allergens TEXT DEFAULT 'None',
        FOREIGN KEY (category_id) REFERENCES categories (id)
    );
    """)

    # Ensure added columns exist if table was already created
    for col_def in [
        ("is_bestseller", "INTEGER DEFAULT 0"),
        ("calories", "INTEGER DEFAULT 250"),
        ("allergens", "TEXT DEFAULT 'None'"),
        ("cost_price", "REAL DEFAULT 0.0")
    ]:
        try:
            cursor.execute(f"ALTER TABLE menu_items ADD COLUMN {col_def[0]} {col_def[1]}")
        except sqlite3.OperationalError:
            pass

    # 3. Promo Codes with Customer Frequency Tier & Margin Protection
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY,
        title TEXT DEFAULT '',
        description TEXT DEFAULT '',
        discount_type TEXT NOT NULL, -- 'PERCENT' or 'FLAT'
        discount_value REAL NOT NULL,
        min_order_value REAL DEFAULT 0,
        max_discount REAL DEFAULT 9999,
        customer_tier TEXT DEFAULT 'ALL', -- 'ALL', 'FIRST_TIME', 'REPEAT', 'REGULAR', 'VIP'
        min_visits INTEGER DEFAULT 0,
        max_margin_share_pct REAL DEFAULT 50.0, -- Max % of dish margin discountable to prevent loss
        is_active INTEGER DEFAULT 1,
        is_single_use INTEGER DEFAULT 0,
        is_used INTEGER DEFAULT 0,
        expires_at TEXT
    );
    """)

    for col_def in [
        ("title", "TEXT DEFAULT ''"),
        ("description", "TEXT DEFAULT ''"),
        ("customer_tier", "TEXT DEFAULT 'ALL'"),
        ("min_visits", "INTEGER DEFAULT 0"),
        ("max_margin_share_pct", "REAL DEFAULT 50.0")
    ]:
        try:
            cursor.execute(f"ALTER TABLE promo_codes ADD COLUMN {col_def[0]} {col_def[1]}")
        except sqlite3.OperationalError:
            pass

    # 4. Store Branding & Profile Settings
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS store_settings (
        id INTEGER PRIMARY KEY,
        store_name TEXT NOT NULL,
        tagline TEXT,
        description TEXT,
        location_name TEXT NOT NULL,
        full_address TEXT,
        opening_hours TEXT,
        phone TEXT,
        announcement TEXT,
        rating REAL DEFAULT 4.9,
        reviews_count INTEGER DEFAULT 1240,
        updated_at TEXT NOT NULL
    );
    """)

    # 5. Time Slots for Capacity Management
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS time_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slot_date TEXT NOT NULL,
        slot_time TEXT NOT NULL,
        max_capacity INTEGER DEFAULT 8,
        UNIQUE(slot_date, slot_time)
    );
    """)

    # 6. Orders Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_code TEXT UNIQUE NOT NULL,
        order_type TEXT NOT NULL, -- 'DINE_IN', 'TAKEAWAY', 'DELIVERY'
        table_number TEXT,
        party_size INTEGER DEFAULT 1,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        delivery_address TEXT,
        items_json TEXT NOT NULL,
        subtotal REAL NOT NULL,
        discount_amount REAL DEFAULT 0,
        coupon_code TEXT,
        total_amount REAL NOT NULL,
        payment_status TEXT DEFAULT 'PAID',
        payment_method TEXT DEFAULT 'UPI',
        order_status TEXT DEFAULT 'PENDING', -- 'PENDING', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'
        scheduled_date TEXT,
        scheduled_slot TEXT,
        bounce_back_coupon_code TEXT,
        notes TEXT,
        tip_amount REAL DEFAULT 0,
        no_cutlery INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """)

    for col_def in [
        ("tip_amount", "REAL DEFAULT 0"),
        ("no_cutlery", "INTEGER DEFAULT 0"),
        ("party_size", "INTEGER DEFAULT 1"),
        ("restaurant_id", "TEXT DEFAULT 'cp-artisan'")
    ]:
        try:
            cursor.execute(f"ALTER TABLE orders ADD COLUMN {col_def[0]} {col_def[1]}")
        except sqlite3.OperationalError:
            pass

    # Ensure existing rows have restaurant_id set
    cursor.execute("UPDATE orders SET restaurant_id = 'cp-artisan' WHERE restaurant_id IS NULL OR restaurant_id = ''")

    # 7. Admin Users Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT DEFAULT 'Manager', -- 'Owner', 'Manager', 'Head Chef'
        created_at TEXT NOT NULL
    );
    """)

    # 8. Admin Active Sessions
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS admin_sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES admin_users (id)
    );
    """)

    # 9. Restaurants / Franchise Outlets Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS restaurants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        tagline TEXT,
        description TEXT,
        cuisine_type TEXT,
        location_name TEXT NOT NULL,
        full_address TEXT NOT NULL,
        city TEXT NOT NULL,
        phone TEXT NOT NULL,
        opening_hours TEXT NOT NULL,
        rating REAL DEFAULT 4.9,
        reviews_count INTEGER DEFAULT 1200,
        delivery_time_mins TEXT DEFAULT '25-35 mins',
        price_for_two TEXT DEFAULT '₹350 for two',
        image_url TEXT,
        is_active INTEGER DEFAULT 1,
        table_count INTEGER DEFAULT 20,
        created_at TEXT NOT NULL
    );
    """)

    # 10. Waste-to-Profit Flash Deals Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS waste_flash_deals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        discount_pct REAL NOT NULL,
        original_price REAL NOT NULL,
        discount_price REAL NOT NULL,
        quantity_available INTEGER DEFAULT 5,
        quantity_sold INTEGER DEFAULT 0,
        reason TEXT DEFAULT 'Excess Prep / Shift End Spoilage Prevention',
        expires_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        restaurant_id TEXT DEFAULT 'cp-artisan',
        created_at TEXT NOT NULL,
        FOREIGN KEY (item_id) REFERENCES menu_items (id)
    );
    """)

    # 11. Waste Impact Audit Logs
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS waste_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        quantity_saved INTEGER DEFAULT 1,
        rupees_saved REAL DEFAULT 0,
        co2_kg_avoided REAL DEFAULT 0,
        logged_at TEXT NOT NULL,
        restaurant_id TEXT DEFAULT 'cp-artisan'
    );
    """)

    # 12. Marketing Autopilot Campaigns
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS marketing_campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_name TEXT NOT NULL,
        target_segment TEXT NOT NULL,
        template_text TEXT NOT NULL,
        promo_code TEXT,
        channel TEXT DEFAULT 'WHATSAPP',
        total_recipients INTEGER DEFAULT 0,
        sent_count INTEGER DEFAULT 0,
        clicks_count INTEGER DEFAULT 0,
        conversions_count INTEGER DEFAULT 0,
        revenue_generated REAL DEFAULT 0,
        created_at TEXT NOT NULL
    );
    """)

    # 13. Group Hunger Network Pools
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS group_pools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pool_code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        pool_type TEXT NOT NULL, -- 'STUDENT_HOSTEL', 'CORPORATE_OFFICE', 'RESIDENTIAL_SOCIETY', 'FRIENDS_COMMUNITY'
        location_name TEXT NOT NULL,
        delivery_address TEXT NOT NULL,
        creator_name TEXT NOT NULL,
        creator_phone TEXT NOT NULL,
        restaurant_id TEXT DEFAULT 'cp-artisan',
        target_amount REAL DEFAULT 1500.0,
        current_amount REAL DEFAULT 0.0,
        discount_tier_pct REAL DEFAULT 0.0,
        status TEXT DEFAULT 'ACTIVE', -- 'ACTIVE', 'FINALIZED', 'EXPIRED'
        order_code TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    """)

    # 14. Group Pool Members & Orders
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS group_pool_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pool_code TEXT NOT NULL,
        participant_name TEXT NOT NULL,
        participant_phone TEXT NOT NULL,
        items_json TEXT NOT NULL,
        subtotal REAL NOT NULL,
        discount_amount REAL DEFAULT 0.0,
        final_amount REAL NOT NULL,
        payment_status TEXT DEFAULT 'PAID',
        notes TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (pool_code) REFERENCES group_pools (pool_code)
    );
    """)

    # 15. SafeKitchen Hygiene & Safety Protocol Audits
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS safekitchen_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        restaurant_id TEXT UNIQUE NOT NULL,
        trust_score INTEGER NOT NULL,
        fssai_license TEXT NOT NULL,
        audit_date TEXT NOT NULL,
        auditor_name TEXT NOT NULL,
        checks_json TEXT NOT NULL,
        is_verified INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants (id)
    );
    """)

    # Add columns to orders table for group pool and offline sync
    for col_def in [
        ("pool_code", "TEXT"),
        ("offline_synced", "INTEGER DEFAULT 0"),
        ("offline_ref", "TEXT")
    ]:
        try:
            cursor.execute(f"ALTER TABLE orders ADD COLUMN {col_def[0]} {col_def[1]}")
        except sqlite3.OperationalError:
            pass

    conn.commit()
    seed_initial_data(conn)
    seed_admin_users(conn)
    seed_restaurants(conn)
    seed_waste_data(conn)
    seed_marketing_data(conn)
    seed_group_pools_data(conn)
    seed_safekitchen_audits(conn)
    conn.close()

def seed_admin_users(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM admin_users")
    if cursor.fetchone()[0] == 0:
        now = datetime.now().isoformat()
        # Seed default Admin / Head Chef user (Role: Head Chef & Manager)
        # Password: rasoi2026 | PIN: 1234
        admin_data = (
            "admin",
            hash_secret("rasoi2026"),
            hash_secret("1234"),
            "Store Manager",
            "Head Chef & Manager",
            now
        )
        cursor.execute("""
            INSERT INTO admin_users (username, password_hash, pin_hash, full_name, role, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, admin_data)
        conn.commit()

def verify_admin_login(username: str = None, password: str = None, pin: str = None):
    """Verifies manager credentials or staff PIN and generates an authenticated session token."""
    conn = get_db_connection()
    cursor = conn.cursor()

    user = None
    clean_pin = pin.strip() if (pin and isinstance(pin, str) and pin.strip()) else None
    clean_user = username.strip().lower() if (username and isinstance(username, str) and username.strip()) else None
    clean_pass = password.strip() if (password and isinstance(password, str) and password.strip()) else None

    if clean_pin:
        cursor.execute("SELECT * FROM admin_users WHERE pin_hash = ?", (hash_secret(clean_pin),))
        user = cursor.fetchone()

    if not user and clean_user and clean_pass:
        cursor.execute("""
            SELECT * FROM admin_users 
            WHERE username = ? AND password_hash = ?
        """, (clean_user, hash_secret(clean_pass)))
        user = cursor.fetchone()

    if not user:
        conn.close()
        return None

    # Generate session token
    token = f"RS-SESSION-{''.join(random.choices(string.ascii_uppercase + string.digits, k=24))}"
    now = datetime.now()
    expires_at = (now + timedelta(hours=24)).isoformat()

    cursor.execute("""
        INSERT INTO admin_sessions (token, user_id, username, full_name, role, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (token, user["id"], user["username"], user["full_name"], user["role"], now.isoformat(), expires_at))

    conn.commit()
    conn.close()

    return {
        "token": token,
        "username": user["username"],
        "full_name": user["full_name"],
        "role": user["role"],
        "expires_at": expires_at
    }

def verify_session_token(token: str):
    """Verifies if an admin session token is active and not expired."""
    if not token:
        return None
    conn = get_db_connection()
    cursor = conn.cursor()
    now_str = datetime.now().isoformat()
    cursor.execute("""
        SELECT token, user_id, username, full_name, role, expires_at
        FROM admin_sessions
        WHERE token = ? AND expires_at > ?
    """, (token, now_str))
    session = cursor.fetchone()
    conn.close()
    if session:
        return dict(session)
    return None

def destroy_admin_session(token: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM admin_sessions WHERE token = ?", (token,))
    conn.commit()
    conn.close()
    return True

def seed_initial_data(conn):
    cursor = conn.cursor()

    # Check if categories exist
    cursor.execute("SELECT COUNT(*) FROM categories")
    if cursor.fetchone()[0] == 0:
        categories = [
            (1, "Chai & Brews", "coffee", 1),
            (2, "Artisanal Chaat", "sparkles", 2),
            (3, "Parathas & Meals", "utensils", 3),
            (4, "Biryani & Bowls", "flame", 4),
            (5, "Desserts & Mithai", "heart", 5),
        ]
        cursor.executemany("INSERT INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)", categories)

        # Realistic Indian Cafe Menu Items with nutrition, allergen info, and bestseller flags
        menu_items = [
            # Chai & Tapri Sips
            (1, 1, "Masala Cutting Chai", "Authentic tapri brew slow-simmered with freshly crushed ginger, green cardamom, and full-cream dairy.", 30.0, 1, "Mild", "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500&auto=format&fit=crop&q=60", 1, 5, 1, 110, "Dairy"),
            (2, 1, "Kulhad Adrak Chai", "Earthy terracotta pot tea infused with roasted cloves, crushed ginger, and holy basil leaves.", 45.0, 1, "Mild", "https://images.unsplash.com/photo-1597481499750-3e6b22637e12?w=500&auto=format&fit=crop&q=60", 1, 6, 0, 120, "Dairy"),
            (3, 1, "Bombay Cold Coffee", "Rich, frothy, thick artisanal cold brew blended with full-cream milk & vanilla scoop.", 90.0, 1, "Mild", "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=500&auto=format&fit=crop&q=60", 1, 5, 1, 240, "Dairy"),
            (4, 1, "Kesar Mango Lassi", "Velvety whipped Alphonso mango yogurt topped with saffron strands, pistachios, and almond slivers.", 85.0, 1, "Mild", "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=500&auto=format&fit=crop&q=60", 1, 5, 0, 260, "Dairy, Tree Nuts"),
            (5, 1, "Fresh Shikanji Soda", "Zesty sparkling lemonade spiked with roasted cumin, rock salt, mint sprigs, and lemon rings.", 50.0, 1, "Mild", "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500&auto=format&fit=crop&q=60", 1, 4, 0, 80, "None"),

            # Artisanal Chaat & Bites
            (6, 2, "Bombay Pav Bhaji", "Slow-mashed butter-laden spiced vegetable gravy garnished with cilantro, served with 2 golden toasted Amul pavs.", 150.0, 1, "Medium", "https://images.unsplash.com/photo-1606491956689-2ea866880c84?w=500&auto=format&fit=crop&q=60", 1, 12, 1, 480, "Dairy, Gluten"),
            (7, 2, "Batata Vada Pav (2 pcs)", "Golden crisp-fried spiced potato fritters tucked in fresh ladi pav with fiery garlic podi & mint chutney.", 80.0, 1, "Spicy", "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=500&auto=format&fit=crop&q=60", 1, 8, 1, 390, "Gluten, Garlic"),
            (8, 2, "Bun Maska with Chai Combo", "Warm soft Irani bun generously slathered with salted Amul butter paired with steaming cutting chai.", 90.0, 1, "Mild", "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=500&auto=format&fit=crop&q=60", 1, 6, 0, 340, "Dairy, Gluten"),
            (9, 2, "Samosa Chaat Deluxe", "Two crushed golden samosas smothered with tangy tamarind, seasoned curd, sev, and slow-cooked chole ragda.", 95.0, 1, "Medium", "https://images.unsplash.com/photo-1601050690187-0d359b3806be?w=500&auto=format&fit=crop&q=60", 1, 10, 0, 420, "Dairy, Gluten"),
            (10, 2, "Paneer Kathi Roll", "Smoky tandoori paneer strips, crunchy bell peppers & house mint mayo rolled in flaky multi-grain paratha.", 160.0, 1, "Medium", "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=60", 1, 12, 1, 450, "Dairy, Gluten"),
            (11, 2, "Dahi Batata Puri (6 pcs)", "Crispy semolina puris filled with diced potatoes, chilled sweetened yogurt, date chutney & fine nylon sev.", 90.0, 1, "Mild", "https://images.unsplash.com/photo-1606491956689-2ea866880c84?w=500&auto=format&fit=crop&q=60", 1, 7, 0, 310, "Dairy, Gluten"),

            # Fresh Parathas & Meals
            (12, 3, "Amritsari Aloo Pyaaz Paratha", "Flaky tawa flatbread stuffed with spiced potato-onion mash, served with pure white butter, curd, and mango pickle.", 120.0, 1, "Medium", "https://images.unsplash.com/photo-1626074353765-517a681e40be?w=500&auto=format&fit=crop&q=60", 1, 15, 0, 410, "Dairy, Gluten"),
            (13, 3, "Paneer Cheese Paratha", "Fresh grated cottage cheese, mild green chilies, and melted mozzarella baked in whole-wheat flatbread.", 150.0, 1, "Mild", "https://images.unsplash.com/photo-1604152135912-04a022e23696?w=500&auto=format&fit=crop&q=60", 1, 15, 0, 490, "Dairy, Gluten"),
            (14, 3, "Chole Bhature Platter (2 pcs)", "Puffed golden bhatures accompanied with spicy slow-cooked Pindi chole, pickled carrots & mint onions.", 160.0, 1, "Spicy", "https://images.unsplash.com/photo-1626132647523-66f5bf380027?w=500&auto=format&fit=crop&q=60", 1, 15, 1, 580, "Gluten"),
            (15, 3, "Dal Makhani & Jeera Rice Bowl", "24-hour slow-cooked creamy black urad lentils topped with white butter, served with fragrant cumin basmati rice.", 180.0, 1, "Mild", "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=60", 1, 12, 1, 520, "Dairy"),
            (16, 3, "Butter Chicken Bowl (Non-Veg)", "Tender boneless chicken tikka simmered in silky tomato-cashew makhani gravy with aged basmati rice.", 220.0, 0, "Medium", "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=60", 1, 15, 1, 610, "Dairy, Tree Nuts"),

            # Royal Biryani & Bowls
            (17, 4, "Hyderabadi Veg Dum Biryani", "Layered long-grain basmati with marinated seasonal vegetables, saffron milk, fresh mint, and spicy salan.", 210.0, 1, "Medium", "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=500&auto=format&fit=crop&q=60", 1, 18, 1, 510, "Dairy"),
            (18, 4, "Murgh Dum Biryani (Non-Veg)", "Authentic dum-cooked spiced chicken biryani with boiled farm egg, caramelized onions, and burani garlic raita.", 260.0, 0, "Spicy", "https://images.unsplash.com/photo-1633945274405-b6c8069047b0?w=500&auto=format&fit=crop&q=60", 1, 18, 1, 640, "Dairy, Egg"),
            (19, 4, "Paneer Tikka Masala Rice Bowl", "Char-grilled malai paneer cubes in onion-tomato masala reduction over aromatic steamed jeera pulao.", 210.0, 1, "Medium", "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=60", 1, 14, 0, 530, "Dairy"),

            # Desi Mithai & Desserts
            (20, 5, "Warm Gulab Jamun (2 pcs)", "Soft melt-in-the-mouth khoya dumplings soaked in fragrant rose and green cardamom infused sugar syrup.", 60.0, 1, "Mild", "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=500&auto=format&fit=crop&q=60", 1, 5, 1, 280, "Dairy, Gluten"),
            (21, 5, "Shahi Matka Kulfi", "Traditional dense slow-reduced milk kulfi flavored with saffron, almonds, pistachios, and rose water.", 80.0, 1, "Mild", "https://images.unsplash.com/photo-1505394033641-40c6ad1178d7?w=500&auto=format&fit=crop&q=60", 1, 4, 0, 260, "Dairy, Tree Nuts"),
            (22, 5, "Warm Gajar Ka Halwa", "Rich winter red carrot fudge cooked in pure desi ghee, khoya, roasted cashews, and golden raisins.", 110.0, 1, "Mild", "https://images.unsplash.com/photo-1571867424488-4565932edb41?w=500&auto=format&fit=crop&q=60", 1, 5, 0, 360, "Dairy, Tree Nuts"),
        ]
        cursor.executemany("""
            INSERT INTO menu_items (id, category_id, name, description, price, veg, spice_level, image_url, is_available, prep_time_minutes, is_bestseller, calories, allergens)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, menu_items)

    # Check promo codes
    cursor.execute("SELECT COUNT(*) FROM promo_codes")
    if cursor.fetchone()[0] == 0:
        promos = [
            ("WELCOME50", "First-Timer Welcome Gift", "Special welcome offer for your very first order at RasoiLink", "FLAT", 50.0, 150.0, 50.0, "FIRST_TIME", 0, 50.0, 1, 0, 0, (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d")),
            ("REPEAT15", "Repeat Diner Reward", "15% OFF reward for returning guests on their 2nd+ visit", "PERCENT", 15.0, 180.0, 75.0, "REPEAT", 1, 45.0, 1, 0, 0, (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d")),
            ("REGULAR20", "Cafe Regular Club", "20% OFF exclusive reward for loyal regulars with 3+ visits", "PERCENT", 20.0, 200.0, 100.0, "REGULAR", 3, 50.0, 1, 0, 0, (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d")),
            ("VIP25", "VIP TrueAddams Circle", "25% OFF highest tier privilege for frequent patrons with 5+ visits", "PERCENT", 25.0, 250.0, 150.0, "VIP", 5, 50.0, 1, 0, 0, (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d")),
            ("HAPPY20", "Happy Hours Special", "20% OFF open promo for all diners", "PERCENT", 20.0, 200.0, 100.0, "ALL", 0, 50.0, 1, 0, 0, (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d")),
            ("RASOI10", "Quick Bite Discount", "10% OFF on all items", "PERCENT", 10.0, 100.0, 50.0, "ALL", 0, 50.0, 1, 0, 0, (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d")),
        ]
        cursor.executemany("""
            INSERT INTO promo_codes (code, title, description, discount_type, discount_value, min_order_value, max_discount, customer_tier, min_visits, max_margin_share_pct, is_active, is_single_use, is_used, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, promos)
    else:
        # Update existing promo codes with titles, tiers and margin share if empty
        promos_update = [
            ("First-Timer Welcome Gift", "Special welcome offer for your very first order at RasoiLink", "FIRST_TIME", 0, 50.0, "WELCOME50"),
            ("Repeat Diner Reward", "15% OFF reward for returning guests on their 2nd+ visit", "REPEAT", 1, 45.0, "REPEAT15"),
            ("Cafe Regular Club", "20% OFF exclusive reward for loyal regulars with 3+ visits", "REGULAR", 3, 50.0, "REGULAR20"),
            ("VIP TrueAddams Circle", "25% OFF highest tier privilege for frequent patrons with 5+ visits", "VIP", 5, 50.0, "VIP25"),
            ("Happy Hours Special", "20% OFF open promo for all diners", "ALL", 0, 50.0, "HAPPY20"),
            ("Quick Bite Discount", "10% OFF on all items", "ALL", 0, 50.0, "RASOI10"),
        ]
        for p in promos_update:
            cursor.execute("""
                INSERT OR IGNORE INTO promo_codes (code, title, description, discount_type, discount_value, min_order_value, max_discount, customer_tier, min_visits, max_margin_share_pct, is_active, is_single_use, is_used, expires_at)
                VALUES (?, ?, ?, 'PERCENT', 15.0, 150.0, 75.0, ?, ?, ?, 1, 0, 0, ?)
            """, (p[5], p[0], p[1], p[2], p[3], p[4], (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d")))
            cursor.execute("""
                UPDATE promo_codes 
                SET title = ?, description = ?, customer_tier = ?, min_visits = ?, max_margin_share_pct = ?
                WHERE code = ? AND (title IS NULL OR title = '')
            """, (p[0], p[1], p[2], p[3], p[4], p[5]))

    # Seed dish cost prices for margin tracking & loss prevention
    dish_cost_mapping = {
        1: 8.0, 2: 12.0, 3: 28.0, 4: 28.0, 5: 12.0,
        6: 55.0, 7: 24.0, 8: 28.0, 9: 32.0, 10: 65.0, 11: 28.0,
        12: 40.0, 13: 60.0, 14: 52.0, 15: 62.0, 16: 95.0,
        17: 75.0, 18: 115.0, 19: 80.0, 20: 16.0, 21: 24.0, 22: 38.0
    }
    for item_id, cost in dish_cost_mapping.items():
        cursor.execute("UPDATE menu_items SET cost_price = ? WHERE id = ? AND (cost_price IS NULL OR cost_price = 0.0)", (cost, item_id))

    # Seed 30-minute time slots for today and next 6 days
    seed_time_slots(conn)
    seed_store_settings(conn)
    conn.commit()

def seed_store_settings(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM store_settings")
    if cursor.fetchone()[0] == 0:
        now = datetime.now().isoformat()
        cursor.execute("""
            INSERT INTO store_settings (
                id, store_name, tagline, description, location_name, full_address, opening_hours, phone, announcement, rating, reviews_count, updated_at
            )
            VALUES (
                1,
                'RasoiLink Kitchen & Chai Bar',
                'Artisanal Indian Bites & Handcrafted Tapri Brews',
                'Authentic cutting chai, butter-loaded pav bhaji, hand-rolled parathas, and slow-cooked dum biryani prepared fresh to order.',
                'Connaught Place, New Delhi',
                'Shop 14, Block M, Inner Circle, Connaught Place, New Delhi - 110001',
                '10:00 AM – 10:30 PM Daily',
                '+91 98765 43210',
                'Freshly prepared to order. Zero aggregator markups!',
                4.9,
                1240,
                ?
            )
        """, (now,))

def seed_time_slots(conn):
    cursor = conn.cursor()
    # 30-minute intervals from 10:00 to 22:30
    slot_hours = [
        "10:00 - 10:30", "10:30 - 11:00",
        "11:00 - 11:30", "11:30 - 12:00",
        "12:00 - 12:30", "12:30 - 13:00",
        "13:00 - 13:30", "13:30 - 14:00",
        "14:00 - 14:30", "14:30 - 15:00",
        "15:00 - 15:30", "15:30 - 16:00",
        "16:00 - 16:30", "16:30 - 17:00",
        "17:00 - 17:30", "17:30 - 18:00",
        "18:00 - 18:30", "18:30 - 19:00",
        "19:00 - 19:30", "19:30 - 20:00",
        "20:00 - 20:30", "20:30 - 21:00",
        "21:00 - 21:30", "21:30 - 22:00",
        "22:00 - 22:30"
    ]

    today = datetime.now().date()
    for day_offset in range(7):
        target_date = (today + timedelta(days=day_offset)).strftime("%Y-%m-%d")
        for slot in slot_hours:
            cursor.execute("""
                INSERT OR IGNORE INTO time_slots (slot_date, slot_time, max_capacity)
                VALUES (?, ?, 8)
            """, (target_date, slot))
    conn.commit()

def create_bounce_back_coupon(conn):
    """Generates a unique single-use bounce-back coupon e.g. BACK50-7A3F for ₹50 off within 7 days."""
    cursor = conn.cursor()
    code = None
    for _ in range(10):
        random_suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
        candidate = f"BACK50-{random_suffix}"
        cursor.execute("SELECT 1 FROM promo_codes WHERE code = ?", (candidate,))
        if not cursor.fetchone():
            code = candidate
            break
    if not code:
        code = f"BACK50-{''.join(random.choices(string.ascii_uppercase + string.digits, k=6))}"
    
    expires_at = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")

    cursor.execute("""
        INSERT INTO promo_codes (code, discount_type, discount_value, min_order_value, max_discount, is_active, is_single_use, is_used, expires_at)
        VALUES (?, 'FLAT', 50.0, 199.0, 50.0, 1, 1, 0, ?)
    """, (code, expires_at))
    return code

def seed_restaurants(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM restaurants")
    if cursor.fetchone()[0] == 0:
        now = datetime.now().isoformat()
        branches = [
            (
                "cp-artisan",
                "RasoiLink Flagship Artisan Cafe",
                "cp-artisan",
                "Signature Flagship Cafe & Chai Bar",
                "Authentic cutting chai, butter-loaded pav bhaji, hand-rolled parathas, and slow-cooked dum biryani prepared fresh to order.",
                "Signature Chai, Bombay Street Eats, Dum Biryani",
                "Connaught Place, Central Delhi",
                "Shop 14, Block M, Inner Circle, Connaught Place, New Delhi - 110001",
                "New Delhi",
                "+91 98765 43210",
                "10:00 AM - 10:30 PM Daily",
                4.9,
                1840,
                "20-30 mins",
                "₹350 for two",
                "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&auto=format&fit=crop&q=60",
                1,
                24,
                now
            ),
            (
                "cyberhub-bistro",
                "RasoiLink Gourmet Bistro & Lounge",
                "cyberhub-bistro",
                "Corporate Dining, Express Bowls & Artisan Platters",
                "Executive thalis, gourmet kathi rolls, artisanal cold brews, and rapid lunchtime delivery for corporate teams.",
                "Modern North Indian, Artisanal Platters, Cold Brews",
                "DLF Cyber Hub, Gurugram",
                "Unit 2A, Ground Floor, DLF Cyber Hub, DLF Phase 2, Gurugram - 122002",
                "Gurugram",
                "+91 98765 43211",
                "09:30 AM - 11:30 PM Daily",
                4.8,
                2410,
                "25-35 mins",
                "₹500 for two",
                "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&auto=format&fit=crop&q=60",
                1,
                32,
                now
            ),
            (
                "khan-market",
                "RasoiLink Express Chai & Street Kitchen",
                "khan-market",
                "Fast Grab-and-Go & High-Speed Neighborhood Delivery",
                "Signature kulhad chai, piping hot samosa chaat, bun maska combos, and quick takeaway meals on the go.",
                "High-Speed Tapri Chai, Kathi Rolls, Quick Chaat",
                "Khan Market, South Delhi",
                "Shop 48-B, Middle Lane, Khan Market, New Delhi - 110003",
                "New Delhi",
                "+91 98765 43212",
                "09:00 AM - 10:00 PM Daily",
                4.9,
                980,
                "15-25 mins",
                "₹280 for two",
                "https://images.unsplash.com/photo-1543007630-9710e4a00a20?w=600&auto=format&fit=crop&q=60",
                1,
                14,
                now
            ),
            (
                "indiranagar",
                "RasoiLink Roastery & Kitchen",
                "indiranagar",
                "Southern Flagship Roastery & Garden Cafe",
                "Filter kaapi blends, Amritsari aloo kulchas, Hyderabadi dum biryani bowls, and artisanal desserts in a serene cafe setting.",
                "South-North Fusion, Filter Kaapi, Artisanal Bowls",
                "Indiranagar, Bengaluru",
                "777, 100 Feet Road, HAL 2nd Stage, Indiranagar, Bengaluru - 560038",
                "Bengaluru",
                "+91 98765 43213",
                "08:30 AM - 11:00 PM Daily",
                4.9,
                1620,
                "25-35 mins",
                "₹400 for two",
                "https://images.unsplash.com/photo-1525610553991-2bede1a236e2?w=600&auto=format&fit=crop&q=60",
                1,
                28,
                now
            )
        ]
        cursor.executemany("""
            INSERT INTO restaurants (
                id, name, slug, tagline, description, cuisine_type, location_name, full_address, city, phone, opening_hours, rating, reviews_count, delivery_time_mins, price_for_two, image_url, is_active, table_count, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, branches)
        conn.commit()

def get_all_restaurants(active_only: bool = True):
    conn = get_db_connection()
    cursor = conn.cursor()
    query = "SELECT * FROM restaurants"
    if active_only:
        query += " WHERE is_active = 1"
    query += " ORDER BY id ASC"
    cursor.execute(query)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

def get_restaurant_by_id(restaurant_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM restaurants WHERE id = ?", (restaurant_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def seed_waste_data(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM waste_flash_deals")
    if cursor.fetchone()[0] == 0:
        now = datetime.now()
        exp = (now + timedelta(hours=4)).isoformat()
        deals = [
            (10, 30.0, 160.0, 112.0, 4, 1, "Afternoon Prep Surplus - Paneer Rolls", exp, 1, "cp-artisan", now.isoformat()),
            (22, 40.0, 110.0, 66.0, 6, 2, "Fresh Batch Closing Spoilage Saver - Gajar Halwa", exp, 1, "cp-artisan", now.isoformat()),
            (6, 25.0, 150.0, 112.5, 5, 0, "Excess Pav Bhaji Batch - Save Food Deal", exp, 1, "cp-artisan", now.isoformat())
        ]
        cursor.executemany("""
            INSERT INTO waste_flash_deals (
                item_id, discount_pct, original_price, discount_price, quantity_available, quantity_sold, reason, expires_at, is_active, restaurant_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, deals)
        
        # Initial waste audit logs (meals saved, ₹ saved from spoilage, co2 avoided)
        logs = [
            (10, 8, 1280.0, 20.0, (now - timedelta(days=2)).isoformat(), "cp-artisan"),
            (22, 14, 1540.0, 35.0, (now - timedelta(days=1)).isoformat(), "cp-artisan"),
            (17, 10, 2100.0, 25.0, now.isoformat(), "cp-artisan")
        ]
        cursor.executemany("""
            INSERT INTO waste_logs (item_id, quantity_saved, rupees_saved, co2_kg_avoided, logged_at, restaurant_id)
            VALUES (?, ?, ?, ?, ?, ?)
        """, logs)
        conn.commit()

def seed_marketing_data(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM marketing_campaigns")
    if cursor.fetchone()[0] == 0:
        now = datetime.now().isoformat()
        campaigns = [
            ("Weekend Chai & Pav Bhaji Churn Win-Back", "CHURN_RISK", "Hey {{name}}! 👋 We miss you at RasoiLink. Enjoy 25% OFF your favorite {{favorite_dish}} with code MISSYOU25! Valid this weekend only ☕✨", "MISSYOU25", "WHATSAPP", 45, 45, 32, 18, 4250.0, now),
            ("Biryani Lovers Feast Alert", "BIRYANI_LOVERS", "Namaste {{name}}! 🍛 Special Dum Biryani Handi is simmering fresh at RasoiLink. Order now and get FREE Gulab Jamun (2 pcs) with code BIRYANIJOY!", "BIRYANIJOY", "WHATSAPP", 60, 60, 48, 29, 7830.0, now),
            ("VIP TrueAddams Privilege Club", "VIP_LOYALISTS", "Greetings {{name}}! 👑 As our privileged VIP patron, unlock flat ₹100 OFF on orders above ₹300 today with code VIP100. Priority kitchen prep included! 🚀", "VIP100", "WHATSAPP", 28, 28, 24, 19, 6460.0, now)
        ]
        cursor.executemany("""
            INSERT INTO marketing_campaigns (
                campaign_name, target_segment, template_text, promo_code, channel, total_recipients, sent_count, clicks_count, conversions_count, revenue_generated, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, campaigns)
        conn.commit()

def seed_group_pools_data(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM group_pools")
    if cursor.fetchone()[0] == 0:
        now = datetime.now()
        exp1 = (now + timedelta(minutes=45)).isoformat()
        exp2 = (now + timedelta(minutes=75)).isoformat()
        pools = [
            ("HOSTEL", "IIT Delhi Hostel 7 Night Munchies", "STUDENT_HOSTEL", "IIT Campus, Hauz Khas", "Hostel 7 Common Room, Ground Floor", "Rohan Verma", "+91 98112 34567", "cp-artisan", 1200.0, 930.0, 15.0, "ACTIVE", None, exp1, now.isoformat()),
            ("CYBER1", "DLF Cyber City Block B Lunch Squad", "CORPORATE_OFFICE", "DLF Cyber Hub, Gurugram", "Tower B, 4th Floor Tech Lounge", "Sneha Kapoor", "+91 98990 12345", "cp-artisan", 2000.0, 1680.0, 25.0, "ACTIVE", None, exp2, now.isoformat())
        ]
        cursor.executemany("""
            INSERT INTO group_pools (
                pool_code, title, pool_type, location_name, delivery_address, creator_name, creator_phone, restaurant_id, target_amount, current_amount, discount_tier_pct, status, order_code, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, pools)

        # Seed pool members
        members = [
            ("HOSTEL", "Rohan Verma", "+91 98112 34567", json.dumps([{"id": 6, "name": "Bombay Pav Bhaji", "price": 150.0, "quantity": 2}, {"id": 1, "name": "Masala Cutting Chai", "price": 30.0, "quantity": 2}]), 360.0, 54.0, 306.0, "PAID", "Extra butter pav please", now.isoformat()),
            ("HOSTEL", "Aman Gupta", "+91 98112 88888", json.dumps([{"id": 14, "name": "Chole Bhature Platter (2 pcs)", "price": 160.0, "quantity": 1}, {"id": 20, "name": "Warm Gulab Jamun (2 pcs)", "price": 60.0, "quantity": 1}]), 220.0, 33.0, 187.0, "PAID", "Pack bhature separately", now.isoformat()),
            ("HOSTEL", "Karan Sharma", "+91 98112 99999", json.dumps([{"id": 17, "name": "Hyderabadi Veg Dum Biryani", "price": 210.0, "quantity": 1}, {"id": 4, "name": "Kesar Mango Lassi", "price": 85.0, "quantity": 1}, {"id": 5, "name": "Fresh Shikanji Soda", "price": 50.0, "quantity": 1}]), 345.0, 51.75, 293.25, "PAID", "Extra spicy salan", now.isoformat()),
            ("CYBER1", "Sneha Kapoor", "+91 98990 12345", json.dumps([{"id": 15, "name": "Dal Makhani & Jeera Rice Bowl", "price": 180.0, "quantity": 2}, {"id": 3, "name": "Bombay Cold Coffee", "price": 90.0, "quantity": 2}]), 540.0, 135.0, 405.0, "PAID", "Cutlery not needed", now.isoformat()),
            ("CYBER1", "Vikram Malhotra", "+91 98990 23456", json.dumps([{"id": 18, "name": "Murgh Dum Biryani (Non-Veg)", "price": 260.0, "quantity": 2}, {"id": 1, "name": "Masala Cutting Chai", "price": 30.0, "quantity": 2}]), 580.0, 145.0, 435.0, "PAID", "No onions raita", now.isoformat()),
            ("CYBER1", "Ananya Rao", "+91 98990 34567", json.dumps([{"id": 10, "name": "Paneer Kathi Roll", "price": 160.0, "quantity": 2}, {"id": 7, "name": "Batata Vada Pav (2 pcs)", "price": 80.0, "quantity": 3}]), 560.0, 140.0, 420.0, "PAID", "Mild spicy", now.isoformat())
        ]
        cursor.executemany("""
            INSERT INTO group_pool_members (
                pool_code, participant_name, participant_phone, items_json, subtotal, discount_amount, final_amount, payment_status, notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, members)
        conn.commit()

def seed_safekitchen_audits(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM safekitchen_audits")
    if cursor.fetchone()[0] == 0:
        now = datetime.now().isoformat()
        
        # The 9 mandatory FSSAI SafeKitchen Protocol Checks in exact required order
        standard_checks = [
            {"id": "handwashing", "title": "Handwashing completed", "verified": True, "detail": "Staff hand-wash protocol executed every 30 mins with food-grade sanitization.", "frequency": "Every 30 Mins"},
            {"id": "gloves_apron", "title": "Gloves and apron changed", "verified": True, "detail": "Single-use food-grade nitrile gloves & sanitized aprons refreshed per shift.", "frequency": "Daily Shift Start"},
            {"id": "veg_nonveg", "title": "Veg/Non-veg separated", "verified": True, "detail": "100% physically segregated chopping boards, knives, fryers & prep stations.", "frequency": "Continuous Protocol"},
            {"id": "fresh_ingredients", "title": "Fresh ingredients logged", "verified": True, "detail": "Morning farm delivery audited for temperature, batch freshness & shelf-life.", "frequency": "Daily 07:00 AM"},
            {"id": "oil_change", "title": "Oil-change log updated", "verified": True, "detail": "Total Polar Material (TPM) measured < 15%. Fresh groundnut & mustard oil logged.", "frequency": "Twice Daily"},
            {"id": "fridge_temp", "title": "Fridge temperature checked", "verified": True, "detail": "Chiller cold storage calibrated at 2.8°C; deep freeze at -18.4°C.", "frequency": "Continuous Digital Sensor"},
            {"id": "cleaning_schedule", "title": "Cleaning schedule completed", "verified": True, "detail": "3-stage sanitization (rinse, food-grade chlorination, steam) completed.", "frequency": "End of Shift Deep Clean"},
            {"id": "allergy_safe", "title": "Allergy-safe handling available", "verified": True, "detail": "Nut, gluten & dairy containment protocols active with dedicated cook stations.", "frequency": "Active Protocol"},
            {"id": "packaging_hygiene", "title": "Packaging hygiene verified", "verified": True, "detail": "UV-sanitized tamper-evident biodegradable packaging & contactless seal applied.", "frequency": "Continuous per Order"}
        ]
        
        checks_json_str = json.dumps(standard_checks)
        
        audits = [
            ("cp-artisan", 98, "FSSAI-10021011000452", "Today (Shift Monitored)", "Dr. A. Sharma (Lead Food Safety Auditor)", checks_json_str, 1, now, now),
            ("cyberhub-bistro", 97, "FSSAI-10822015000881", "Today (Shift Monitored)", "R. K. Mehra (FSSAI Empanelled Inspector)", checks_json_str, 1, now, now),
            ("khan-market", 99, "FSSAI-10021011000789", "Today (Shift Monitored)", "P. Deshmukh (Certified Hygiene Officer)", checks_json_str, 1, now, now),
            ("indiranagar", 96, "FSSAI-11223334000192", "Today (Shift Monitored)", "V. Swaminathan (BBMP Food Safety Cell)", checks_json_str, 1, now, now)
        ]
        
        cursor.executemany("""
            INSERT INTO safekitchen_audits (
                restaurant_id, trust_score, fssai_license, audit_date, auditor_name, checks_json, is_verified, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, audits)
        conn.commit()

def get_safekitchen_audit(restaurant_id: str = "cp-artisan"):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM safekitchen_audits WHERE restaurant_id = ?", (restaurant_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    data = dict(row)
    if isinstance(data.get("checks_json"), str):
        try:
            data["checks"] = json.loads(data["checks_json"])
        except Exception:
            data["checks"] = []
    else:
        data["checks"] = []
    return data
