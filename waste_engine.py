import json
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from database import get_db_connection

# Shelf-life / perishability rating by category name
PERISHABLE_CATEGORIES = {
    "Chai & Brews": {"perishable": True, "shelf_life_hours": 4, "portion_kg": 0.25},
    "Artisanal Chaat": {"perishable": True, "shelf_life_hours": 6, "portion_kg": 0.35},
    "Parathas & Meals": {"perishable": True, "shelf_life_hours": 8, "portion_kg": 0.45},
    "Biryani & Bowls": {"perishable": True, "shelf_life_hours": 10, "portion_kg": 0.50},
    "Desserts & Mithai": {"perishable": False, "shelf_life_hours": 24, "portion_kg": 0.20},
}

def predict_daily_food_demand(restaurant_id: str = "cp-artisan") -> Dict[str, Any]:
    """
    Predicts daily food demand, identifies surplus/leftover risks,
    and calculates dynamic discount suggestions to convert waste into profit.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Fetch menu items with category info
    cursor.execute("""
        SELECT m.id, m.name, m.price, m.cost_price, m.is_available, m.prep_time_minutes,
               c.name as category_name, m.image_url, m.veg
        FROM menu_items m
        JOIN categories c ON m.category_id = c.id
        ORDER BY c.sort_order, m.id
    """)
    menu_items = [dict(r) for r in cursor.fetchall()]

    # 2. Analyze sales history from orders table
    cursor.execute("""
        SELECT items_json, created_at, order_status
        FROM orders
        WHERE (restaurant_id = ? OR restaurant_id IS NULL)
          AND order_status != 'CANCELLED'
    """, (restaurant_id,))
    orders = cursor.fetchall()

    # Aggregate item sales across all recorded history and today
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    current_hour = now.hour + (now.minute / 60.0)

    total_sales_per_item = {}
    today_sales_per_item = {}

    for row in orders:
        try:
            items = json.loads(row["items_json"])
            is_today = (row["created_at"] or "").startswith(today_str)
            for itm in items:
                itm_id = itm.get("id")
                qty = itm.get("quantity", 1)
                total_sales_per_item[itm_id] = total_sales_per_item.get(itm_id, 0) + qty
                if is_today:
                    today_sales_per_item[itm_id] = today_sales_per_item.get(itm_id, 0) + qty
        except Exception:
            continue

    # Day of week demand factor (Weekends 1.3x, Fridays 1.15x, Weekdays 1.0x)
    weekday = now.weekday()
    day_multiplier = 1.30 if weekday in (5, 6) else (1.15 if weekday == 4 else 1.0)

    # Shift progress factor (Assume 10:00 to 22:30 -> 12.5 hour operational window)
    store_open_hour = 10.0
    store_close_hour = 22.5
    hours_elapsed = max(0.5, min(12.5, current_hour - store_open_hour)) if current_hour >= store_open_hour else 2.0
    shift_progress_pct = min(1.0, max(0.1, hours_elapsed / 12.5))

    predictions = []
    total_surplus_cost = 0.0
    total_potential_recovery = 0.0
    high_risk_count = 0

    # Fetch any currently active flash deals
    cursor.execute("""
        SELECT item_id, discount_pct, expires_at, quantity_available, quantity_sold
        FROM waste_flash_deals
        WHERE is_active = 1 AND expires_at > ?
    """, (now.isoformat(),))
    active_deals_map = {r["item_id"]: dict(r) for r in cursor.fetchall()}

    for item in menu_items:
        itm_id = item["id"]
        category = item["category_name"]
        cat_meta = PERISHABLE_CATEGORIES.get(category, {"perishable": True, "shelf_life_hours": 8, "portion_kg": 0.35})
        
        hist_total = total_sales_per_item.get(itm_id, 0)
        # Baseline estimated daily demand
        base_demand = max(4, round((hist_total / 10.0) * day_multiplier)) if hist_total > 0 else (12 if item["veg"] else 8)
        
        # Planned morning batch prep
        planned_batch = round(base_demand * 1.15)
        sold_so_far = today_sales_per_item.get(itm_id, min(planned_batch - 2, max(1, round(planned_batch * shift_progress_pct * 0.7))))
        
        # Remaining estimated demand for rest of shift
        remaining_expected_sales = round(base_demand * (1.0 - shift_progress_pct))
        current_inventory = max(0, planned_batch - sold_so_far)
        estimated_leftover = max(0, current_inventory - remaining_expected_sales)
        
        # Risk assessment
        cost_price = item["cost_price"] or (item["price"] * 0.35)
        is_perishable = cat_meta["perishable"]

        if is_perishable and (estimated_leftover >= 3 or (shift_progress_pct > 0.65 and estimated_leftover >= 2)):
            risk_level = "HIGH"
            suggested_discount_pct = 40.0 if shift_progress_pct > 0.75 else 30.0
            high_risk_count += 1
            action_badge = "Immediate Flash Deal Recommended"
        elif estimated_leftover >= 2:
            risk_level = "MEDIUM"
            suggested_discount_pct = 25.0
            action_badge = "Monitor & Offer Happy Hour"
        else:
            risk_level = "LOW"
            suggested_discount_pct = 15.0
            action_badge = "Stock Level Optimal"

        potential_recovery = round(estimated_leftover * item["price"] * (1.0 - (suggested_discount_pct / 100.0)), 2)
        surplus_waste_loss = round(estimated_leftover * cost_price, 2)
        total_surplus_cost += surplus_waste_loss
        total_potential_recovery += potential_recovery

        # Environmental footprint (portion_kg * estimated_leftover * 2.5 kg CO2e)
        co2_kg_saved = round(estimated_leftover * cat_meta["portion_kg"] * 2.5, 2)

        has_active_deal = itm_id in active_deals_map

        predictions.append({
            "item_id": itm_id,
            "name": item["name"],
            "category": category,
            "price": item["price"],
            "cost_price": cost_price,
            "image_url": item["image_url"],
            "veg": bool(item["veg"]),
            "is_available": bool(item["is_available"]),
            "predicted_daily_demand": base_demand,
            "planned_prep_batch": planned_batch,
            "sold_today": sold_so_far,
            "current_stock": current_inventory,
            "estimated_leftover": estimated_leftover,
            "spoilage_risk": risk_level,
            "action_badge": action_badge,
            "suggested_discount_pct": suggested_discount_pct,
            "discounted_price": round(item["price"] * (1.0 - suggested_discount_pct / 100.0), 2),
            "potential_recovery_inr": potential_recovery,
            "surplus_cost_at_risk": surplus_waste_loss,
            "co2_kg_avoidable": co2_kg_saved,
            "active_deal": active_deals_map.get(itm_id),
            "is_perishable": is_perishable
        })

    # Sort high risk first, then estimated leftover
    predictions.sort(key=lambda x: (0 if x["spoilage_risk"] == "HIGH" else (1 if x["spoilage_risk"] == "MEDIUM" else 2), -x["estimated_leftover"]))

    conn.close()

    return {
        "timestamp": now.isoformat(),
        "restaurant_id": restaurant_id,
        "shift_progress_pct": round(shift_progress_pct * 100, 1),
        "total_items_analyzed": len(menu_items),
        "high_risk_items_count": high_risk_count,
        "total_surplus_cost_at_risk": round(total_surplus_cost, 2),
        "total_potential_recovery_inr": round(total_potential_recovery, 2),
        "items": predictions
    }

def apply_waste_discount(
    item_id: int,
    discount_pct: float,
    duration_hours: float = 3.0,
    quantity_available: int = 5,
    reason: str = "Surplus Inventory Reduction",
    restaurant_id: str = "cp-artisan"
) -> Dict[str, Any]:
    """Applies a dynamic flash discount to surplus inventory to turn waste into profit."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Get item price
    cursor.execute("SELECT id, name, price, image_url FROM menu_items WHERE id = ?", (item_id,))
    item = cursor.fetchone()
    if not item:
        conn.close()
        raise ValueError(f"Menu item with ID {item_id} not found.")

    original_price = float(item["price"])
    discount_price = round(original_price * (1.0 - (discount_pct / 100.0)), 2)

    now = datetime.now()
    expires_at = (now + timedelta(hours=duration_hours)).isoformat()

    # Deactivate any prior active deal for this item
    cursor.execute("""
        UPDATE waste_flash_deals
        SET is_active = 0
        WHERE item_id = ? AND restaurant_id = ? AND is_active = 1
    """, (item_id, restaurant_id))

    cursor.execute("""
        INSERT INTO waste_flash_deals (
            item_id, discount_pct, original_price, discount_price,
            quantity_available, quantity_sold, reason, expires_at,
            is_active, restaurant_id, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?)
    """, (
        item_id, discount_pct, original_price, discount_price,
        quantity_available, reason, expires_at, restaurant_id, now.isoformat()
    ))
    deal_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return {
        "deal_id": deal_id,
        "item_id": item_id,
        "item_name": item["name"],
        "original_price": original_price,
        "discount_price": discount_price,
        "discount_pct": discount_pct,
        "quantity_available": quantity_available,
        "reason": reason,
        "expires_at": expires_at,
        "duration_hours": duration_hours,
        "status": "ACTIVE"
    }

def get_active_waste_deals(restaurant_id: str = "cp-artisan") -> List[Dict[str, Any]]:
    """Fetches active unexpired flash discount deals for customers and kitchen staff."""
    conn = get_db_connection()
    cursor = conn.cursor()
    now_str = datetime.now().isoformat()

    cursor.execute("""
        SELECT d.id, d.item_id, d.discount_pct, d.original_price, d.discount_price,
               d.quantity_available, d.quantity_sold, d.reason, d.expires_at,
               m.name as item_name, m.image_url, m.veg, m.spice_level, c.name as category_name
        FROM waste_flash_deals d
        JOIN menu_items m ON d.item_id = m.id
        JOIN categories c ON m.category_id = c.id
        WHERE d.is_active = 1
          AND d.expires_at > ?
          AND d.quantity_available > d.quantity_sold
          AND (d.restaurant_id = ? OR d.restaurant_id IS NULL)
        ORDER BY d.discount_pct DESC, d.id DESC
    """, (now_str, restaurant_id))

    deals = []
    now = datetime.now()
    for row in cursor.fetchall():
        d = dict(row)
        exp_dt = datetime.fromisoformat(d["expires_at"])
        remaining_seconds = max(0, int((exp_dt - now).total_seconds()))
        d["seconds_remaining"] = remaining_seconds
        d["portions_left"] = d["quantity_available"] - d["quantity_sold"]
        d["savings_amount"] = round(d["original_price"] - d["discount_price"], 2)
        deals.append(d)

    conn.close()
    return deals

def get_waste_impact_stats(restaurant_id: str = "cp-artisan") -> Dict[str, Any]:
    """Calculates overall sustainability and financial impact of the Waste-to-Profit engine."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Query from logs
    cursor.execute("""
        SELECT COUNT(*) as total_logs,
               COALESCE(SUM(quantity_saved), 0) as total_portions_rescued,
               COALESCE(SUM(rupees_saved), 0) as total_rupees_recovered,
               COALESCE(SUM(co2_kg_avoided), 0) as total_co2_avoided
        FROM waste_logs
        WHERE restaurant_id = ? OR restaurant_id IS NULL
    """, (restaurant_id,))
    log_stats = dict(cursor.fetchone())

    # Query deals redeemed
    cursor.execute("""
        SELECT COALESCE(SUM(quantity_sold), 0) as deal_items_sold,
               COALESCE(SUM(quantity_sold * discount_price), 0) as revenue_from_flash_deals
        FROM waste_flash_deals
        WHERE restaurant_id = ? OR restaurant_id IS NULL
    """, (restaurant_id,))
    deal_stats = dict(cursor.fetchone())

    active_deals = get_active_waste_deals(restaurant_id)

    meals_rescued = int(log_stats["total_portions_rescued"]) + int(deal_stats["deal_items_sold"])
    revenue_recovered = float(log_stats["total_rupees_recovered"]) + float(deal_stats["revenue_from_flash_deals"])
    co2_kg = float(log_stats["total_co2_avoided"]) + round(int(deal_stats["deal_items_sold"]) * 0.35 * 2.5, 2)

    conn.close()

    return {
        "meals_rescued_count": meals_rescued,
        "revenue_recovered_inr": round(revenue_recovered, 2),
        "co2_emissions_avoided_kg": round(co2_kg, 2),
        "active_eco_deals_count": len(active_deals),
        "landfill_diversion_kg": round(meals_rescued * 0.38, 2),
        "trees_equivalent": round(co2_kg / 21.0, 1) # ~21 kg CO2 absorbed per tree/year
    }
