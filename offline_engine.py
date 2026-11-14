import json
import random
import string
from datetime import datetime
from typing import List, Dict, Any
from database import get_db_connection, create_bounce_back_coupon

def sync_single_offline_order(offline_order: Dict[str, Any]) -> Dict[str, Any]:
    """
    Safely commits an offline queued order to the database.
    Ensures idempotency based on offline_ref.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    offline_ref = offline_order.get("offline_ref")
    if not offline_ref:
        offline_ref = f"OFFLINE-{int(datetime.now().timestamp() * 1000)}"

    # Check if already synced (idempotent)
    cursor.execute("SELECT order_code, total_amount, bounce_back_coupon_code FROM orders WHERE offline_ref = ?", (offline_ref,))
    existing = cursor.fetchone()
    if existing:
        conn.close()
        return {
            "status": "ALREADY_SYNCED",
            "order_code": existing["order_code"],
            "total_amount": existing["total_amount"],
            "bounce_back_coupon_code": existing["bounce_back_coupon_code"],
            "offline_ref": offline_ref,
            "message": "Order was already synchronized."
        }

    # Extract fields
    order_data = offline_order.get("order_data") or offline_order
    order_type = order_data.get("order_type", "DINE_IN")
    table_number = order_data.get("table_number")
    party_size = order_data.get("party_size", 1)
    customer_name = order_data.get("customer_name", "Bharat Offline Guest")
    customer_phone = order_data.get("customer_phone", "+91 99999 99999")
    delivery_address = order_data.get("delivery_address")
    items = order_data.get("items", [])
    coupon_code = order_data.get("coupon_code")
    payment_method = order_data.get("payment_method", "CASH_ON_DELIVERY")
    scheduled_date = order_data.get("scheduled_date")
    scheduled_slot = order_data.get("scheduled_slot")
    restaurant_id = order_data.get("restaurant_id", "cp-artisan")
    notes = order_data.get("notes") or ""
    tip_amount = float(order_data.get("tip_amount", 0.0))
    no_cutlery = 1 if order_data.get("no_cutlery") else 0
    pool_code = order_data.get("pool_code")

    # Calculate subtotal
    subtotal = sum(float(i.get("price", 0)) * int(i.get("quantity", 1)) for i in items)
    discount_amount = float(order_data.get("discount_amount", 0.0))
    total_amount = max(0.0, round(subtotal - discount_amount + tip_amount, 2))

    # Generate official order code
    random_digits = "".join(random.choices(string.digits, k=4))
    order_code = f"RL-{random_digits}"
    for _ in range(5):
        cursor.execute("SELECT id FROM orders WHERE order_code = ?", (order_code,))
        if not cursor.fetchone():
            break
        order_code = f"RL-{''.join(random.choices(string.digits, k=4))}"

    bounce_coupon = create_bounce_back_coupon(conn)
    now_iso = datetime.now().isoformat()
    offline_created = offline_order.get("offline_created_at") or now_iso

    tagged_notes = f"[BHARAT OFFLINE SYNCED: Placed {offline_created}] {notes}".strip()

    cursor.execute("""
        INSERT INTO orders (
            order_code, order_type, table_number, party_size,
            customer_name, customer_phone, delivery_address, items_json,
            subtotal, discount_amount, coupon_code, total_amount,
            payment_status, payment_method, order_status, scheduled_date,
            scheduled_slot, bounce_back_coupon_code, notes, tip_amount,
            no_cutlery, restaurant_id, pool_code, offline_synced, offline_ref,
            created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAID', ?, 'PENDING', ?,
            ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?
        )
    """, (
        order_code, order_type, table_number, party_size,
        customer_name, customer_phone, delivery_address, json.dumps(items),
        subtotal, discount_amount, coupon_code, total_amount,
        payment_method, scheduled_date, scheduled_slot,
        bounce_coupon, tagged_notes, tip_amount, no_cutlery,
        restaurant_id, pool_code, offline_ref, now_iso, now_iso
    ))

    conn.commit()
    conn.close()

    return {
        "status": "SYNCED",
        "order_code": order_code,
        "offline_ref": offline_ref,
        "total_amount": total_amount,
        "bounce_back_coupon_code": bounce_coupon,
        "customer_phone": customer_phone,
        "created_at": now_iso
    }

def sync_batch_offline_orders(orders_list: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Syncs a batch of offline orders queued by customer or restaurant staff."""
    results = []
    synced_count = 0
    for itm in orders_list:
        try:
            res = sync_single_offline_order(itm)
            results.append(res)
            if res.get("status") in ("SYNCED", "ALREADY_SYNCED"):
                synced_count += 1
        except Exception as e:
            results.append({
                "status": "ERROR",
                "error": str(e),
                "offline_ref": itm.get("offline_ref")
            })

    return {
        "total_submitted": len(orders_list),
        "synced_count": synced_count,
        "results": results
    }
