import json
import random
import string
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from database import get_db_connection

# Tier definitions for Group Hunger Network
TIER_RULES = [
    {"tier": 3, "min_amount": 1500.0, "min_members": 6, "discount_pct": 25.0, "perk": "25% OFF Mega Group Saver + Free Artisanal Mithai"},
    {"tier": 2, "min_amount": 800.0, "min_members": 4, "discount_pct": 15.0, "perk": "15% OFF + Free Cutting Chai round"},
    {"tier": 1, "min_amount": 400.0, "min_members": 2, "discount_pct": 10.0, "perk": "10% OFF + Zero Delivery Fee"},
    {"tier": 0, "min_amount": 0.0, "min_members": 1, "discount_pct": 0.0, "perk": "Group Pool Active — Add more to unlock 10%"}
]

def calculate_tier(current_amount: float, members_count: int) -> Dict[str, Any]:
    """Calculates active tier and progress to next tier."""
    for rule in TIER_RULES:
        if current_amount >= rule["min_amount"] or (rule["min_members"] > 1 and members_count >= rule["min_members"]):
            active_rule = rule
            break
    else:
        active_rule = TIER_RULES[-1]

    # Find next tier
    next_rule = None
    amount_to_next = 0.0
    members_to_next = 0
    if active_rule["tier"] < 3:
        for rule in reversed(TIER_RULES):
            if rule["tier"] == active_rule["tier"] + 1:
                next_rule = rule
                amount_to_next = max(0.0, round(rule["min_amount"] - current_amount, 2))
                members_to_next = max(0, rule["min_members"] - members_count)
                break

    return {
        "tier": active_rule["tier"],
        "discount_pct": active_rule["discount_pct"],
        "perk": active_rule["perk"],
        "next_tier": next_rule["tier"] if next_rule else None,
        "next_discount_pct": next_rule["discount_pct"] if next_rule else None,
        "amount_to_next": amount_to_next,
        "members_to_next": members_to_next
    }

def generate_unique_pool_code() -> str:
    """Generates a clean 6-character pool join code."""
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(random.choices(chars, k=6))

def create_group_pool(
    title: str,
    pool_type: str,
    location_name: str,
    delivery_address: str,
    creator_name: str,
    creator_phone: str,
    target_amount: float = 1200.0,
    duration_minutes: int = 45,
    restaurant_id: str = "cp-artisan"
) -> Dict[str, Any]:
    """Creates a new Group Hunger Network food pool."""
    conn = get_db_connection()
    cursor = conn.cursor()

    pool_code = generate_unique_pool_code()
    # Ensure uniqueness
    for _ in range(5):
        cursor.execute("SELECT id FROM group_pools WHERE pool_code = ?", (pool_code,))
        if not cursor.fetchone():
            break
        pool_code = generate_unique_pool_code()

    now = datetime.now()
    expires_at = (now + timedelta(minutes=duration_minutes)).isoformat()

    cursor.execute("""
        INSERT INTO group_pools (
            pool_code, title, pool_type, location_name, delivery_address,
            creator_name, creator_phone, restaurant_id, target_amount,
            current_amount, discount_tier_pct, status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, 0.0, 'ACTIVE', ?, ?)
    """, (
        pool_code, title, pool_type, location_name, delivery_address,
        creator_name, creator_phone, restaurant_id, target_amount,
        expires_at, now.isoformat()
    ))
    conn.commit()
    conn.close()

    return get_group_pool_details(pool_code)

def get_group_pool_details(pool_code: str) -> Optional[Dict[str, Any]]:
    """Retrieves live pool status, participants, items, unlocked discount tier, and countdown."""
    conn = get_db_connection()
    cursor = conn.cursor()

    clean_code = pool_code.strip().upper()
    cursor.execute("SELECT * FROM group_pools WHERE pool_code = ?", (clean_code,))
    pool_row = cursor.fetchone()
    if not pool_row:
        conn.close()
        return None

    pool = dict(pool_row)

    # Fetch members
    cursor.execute("""
        SELECT id, participant_name, participant_phone, items_json,
               subtotal, discount_amount, final_amount, payment_status, notes, created_at
        FROM group_pool_members
        WHERE pool_code = ?
        ORDER BY id ASC
    """, (clean_code,))
    member_rows = cursor.fetchall()

    members = []
    total_subtotal = 0.0
    consolidated_items = {}

    for mr in member_rows:
        m = dict(mr)
        try:
            m["items"] = json.loads(m["items_json"])
        except Exception:
            m["items"] = []
        total_subtotal += float(m["subtotal"])
        
        # Aggregate consolidated batch
        for itm in m["items"]:
            itm_id = itm.get("id")
            if itm_id not in consolidated_items:
                consolidated_items[itm_id] = {
                    "id": itm_id,
                    "name": itm.get("name"),
                    "price": itm.get("price"),
                    "quantity": 0,
                    "notes_list": []
                }
            consolidated_items[itm_id]["quantity"] += itm.get("quantity", 1)
            if itm.get("notes"):
                consolidated_items[itm_id]["notes_list"].append(f"{m['participant_name']}: {itm.get('notes')}")

        members.append(m)

    tier_info = calculate_tier(total_subtotal, len(members))
    discount_pct = tier_info["discount_pct"]

    # Recompute discount amount for all members if tier changed
    total_discount = round(total_subtotal * (discount_pct / 100.0), 2)
    total_final = round(total_subtotal - total_discount, 2)

    # Update pool record
    cursor.execute("""
        UPDATE group_pools
        SET current_amount = ?, discount_tier_pct = ?
        WHERE pool_code = ?
    """, (total_subtotal, discount_pct, clean_code))
    conn.commit()
    conn.close()

    now = datetime.now()
    exp_dt = datetime.fromisoformat(pool["expires_at"])
    seconds_remaining = max(0, int((exp_dt - now).total_seconds()))
    is_expired = seconds_remaining == 0 and pool["status"] == "ACTIVE"

    return {
        "pool_code": clean_code,
        "title": pool["title"],
        "pool_type": pool["pool_type"],
        "location_name": pool["location_name"],
        "delivery_address": pool["delivery_address"],
        "creator_name": pool["creator_name"],
        "creator_phone": pool["creator_phone"],
        "restaurant_id": pool["restaurant_id"],
        "target_amount": pool["target_amount"],
        "current_amount": total_subtotal,
        "discount_tier_pct": discount_pct,
        "total_discount_amount": total_discount,
        "total_final_amount": total_final,
        "status": "EXPIRED" if is_expired else pool["status"],
        "order_code": pool["order_code"],
        "expires_at": pool["expires_at"],
        "seconds_remaining": seconds_remaining,
        "members_count": len(members),
        "tier_info": tier_info,
        "members": members,
        "consolidated_items": list(consolidated_items.values()),
        "share_url": f"http://127.0.0.1:8000/?pool={clean_code}"
    }

def join_group_pool(
    pool_code: str,
    participant_name: str,
    participant_phone: str,
    items: List[Dict[str, Any]],
    notes: str = ""
) -> Dict[str, Any]:
    """Adds a participant's items to the group food pool and unlocks higher tier discounts."""
    clean_code = pool_code.strip().upper()
    pool = get_group_pool_details(clean_code)
    if not pool:
        raise ValueError(f"Group pool '{clean_code}' not found.")
    if pool["status"] != "ACTIVE":
        raise ValueError(f"Group pool '{clean_code}' is already {pool['status']}.")

    subtotal = sum(float(itm.get("price", 0)) * int(itm.get("quantity", 1)) for itm in items)
    current_tier_pct = pool["discount_tier_pct"]
    discount_amount = round(subtotal * (current_tier_pct / 100.0), 2)
    final_amount = round(subtotal - discount_amount, 2)

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO group_pool_members (
            pool_code, participant_name, participant_phone, items_json,
            subtotal, discount_amount, final_amount, payment_status, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PAID', ?, ?)
    """, (
        clean_code, participant_name, participant_phone, json.dumps(items),
        subtotal, discount_amount, final_amount, notes, datetime.now().isoformat()
    ))
    conn.commit()
    conn.close()

    # Recalculate pool and return refreshed state
    return get_group_pool_details(clean_code)

def list_active_group_pools(restaurant_id: str = "cp-artisan") -> List[Dict[str, Any]]:
    """Returns active pools for customers to discover and join."""
    conn = get_db_connection()
    cursor = conn.cursor()
    now_str = datetime.now().isoformat()

    cursor.execute("""
        SELECT pool_code FROM group_pools
        WHERE status = 'ACTIVE' AND expires_at > ?
          AND (restaurant_id = ? OR restaurant_id IS NULL)
        ORDER BY id DESC
    """, (now_str, restaurant_id))
    codes = [r["pool_code"] for r in cursor.fetchall()]
    conn.close()

    return [get_group_pool_details(c) for c in codes if c]

def finalize_group_pool_order(pool_code: str, notes: str = "") -> Dict[str, Any]:
    """Closes pool, generates a consolidated master order for the kitchen."""
    clean_code = pool_code.strip().upper()
    pool = get_group_pool_details(clean_code)
    if not pool:
        raise ValueError(f"Group pool '{clean_code}' not found.")
    if not pool["members"]:
        raise ValueError("Cannot finalize an empty group pool. Add items first.")

    conn = get_db_connection()
    cursor = conn.cursor()

    # Generate official order code with collision guard
    order_code = None
    for _ in range(10):
        random_digits = "".join(random.choices(string.digits, k=4))
        candidate = f"GP-{clean_code}-{random_digits}"
        cursor.execute("SELECT 1 FROM orders WHERE order_code = ?", (candidate,))
        if not cursor.fetchone():
            order_code = candidate
            break
    if not order_code:
        order_code = f"GP-{clean_code}-{''.join(random.choices(string.digits, k=6))}"
    now_iso = datetime.now().isoformat()

    # Consolidated kitchen items JSON
    items_json = json.dumps(pool["consolidated_items"])
    subtotal = pool["current_amount"]
    discount = pool["total_discount_amount"]
    total_amount = pool["total_final_amount"]

    full_notes = f"[GROUP POOL: {pool['title']} ({clean_code})] {len(pool['members'])} Members. {notes}".strip()

    cursor.execute("""
        INSERT INTO orders (
            order_code, order_type, table_number, party_size,
            customer_name, customer_phone, delivery_address, items_json,
            subtotal, discount_amount, coupon_code, total_amount,
            payment_status, payment_method, order_status, notes,
            pool_code, restaurant_id, created_at, updated_at
        ) VALUES (
            ?, 'DELIVERY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAID', 'UPI_GROUP_SPLIT', 'PENDING', ?, ?, ?, ?, ?
        )
    """, (
        order_code,
        f"POOL-{clean_code}",
        pool["members_count"],
        f"{pool['creator_name']} & Squad ({pool['title']})",
        pool["creator_phone"],
        pool["delivery_address"],
        items_json,
        subtotal,
        discount,
        f"GROUP{int(pool['discount_tier_pct'])}",
        total_amount,
        full_notes,
        clean_code,
        pool["restaurant_id"],
        now_iso,
        now_iso
    ))

    # Mark pool as FINALIZED
    cursor.execute("""
        UPDATE group_pools
        SET status = 'FINALIZED', order_code = ?
        WHERE pool_code = ?
    """, (order_code, clean_code))

    conn.commit()
    conn.close()

    refreshed = get_group_pool_details(clean_code)
    refreshed["generated_order_code"] = order_code
    return refreshed
