import os
import json
import urllib.parse
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import httpx
from database import get_db_connection

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

TEMPLATES_BY_SEGMENT_AND_TONE = {
    "CHURN_RISK": {
        "TAPRI_HINGLISH": (
            "Arrey {name} bhai! 👋 Bahut din ho gaye, aapki favourite {favorite_dish} aur cutting chai ki yaad aa rahi hai! ☕✨\n\n"
            "Aaj direct RasoiLink se order karo aur pao flat {discount_pct}% OFF using code: *{promo_code}*!\n\n"
            "👉 Instant 1-Tap Order Link: {store_url}?coupon={promo_code}\n\n"
            "Zero commission, seedha kitchen se garma-garam fresh!"
        ),
        "FRIENDLY": (
            "Hello {name}! 👋 We've missed serving you at RasoiLink!\n\n"
            "Your favorite {favorite_dish} is being prepared fresh right now. Here's an exclusive {discount_pct}% welcome-back reward just for you: *{promo_code}* 🎁\n\n"
            "👉 Tap to order: {store_url}?coupon={promo_code}\n\n"
            "Warm regards,\nTeam RasoiLink"
        ),
        "URGENT_FOMO": (
            "⚡ FLASH WIN-BACK: {name}, your table is waiting!\n\n"
            "Claim {discount_pct}% OFF on your next order with code *{promo_code}* before midnight tonight!\n\n"
            "🔥 Valid for the next 4 hours only: {store_url}?coupon={promo_code}"
        ),
        "FESTIVE": (
            "Celebrate good times with authentic flavors, {name}! 🎉\n\n"
            "Enjoy {discount_pct}% OFF your order today with code *{promo_code}*.\n\n"
            "👉 Order direct: {store_url}?coupon={promo_code}"
        )
    },
    "VIP_LOYALISTS": {
        "TAPRI_HINGLISH": (
            "Namaste VIP {name} ji! 👑\n\n"
            "RasoiLink TrueAddams Circle ke privileged guest ke naate, aapke liye flat {discount_pct}% VIP privilege discount ready hai! Code: *{promo_code}* 🌟\n\n"
            "Aapki usual choice {favorite_dish} aur chef special fresh batch waiting!\n\n"
            "👉 VIP Order: {store_url}?coupon={promo_code}"
        ),
        "FRIENDLY": (
            "Dear {name}, thank you for being one of our most valued patrons! 🌟\n\n"
            "As a token of our appreciation, please enjoy {discount_pct}% OFF your order with code *{promo_code}*. Priority kitchen preparation included!\n\n"
            "👉 Order now: {store_url}?coupon={promo_code}"
        ),
        "URGENT_FOMO": (
            "Exclusive VIP Alert for {name}! 💎\n\n"
            "Top tier chef specials are rolling out of the kitchen. Unlock your secret VIP {discount_pct}% discount code *{promo_code}* today!\n\n"
            "👉 {store_url}?coupon={promo_code}"
        ),
        "FESTIVE": (
            "Wishing our VIP patron {name} a wonderful day! 🎊\n\n"
            "Treat yourself and your family with {discount_pct}% OFF using code *{promo_code}*.\n\n"
            "👉 {store_url}?coupon={promo_code}"
        )
    },
    "BIRYANI_LOVERS": {
        "TAPRI_HINGLISH": (
            "Biryani Alert! 🍛🔥 {name} ji, hamari slow dum-cooked aromatic biryani ki handi abhi abhi open hui hai!\n\n"
            "Special Dum Biryani treat: Use code *{promo_code}* for flat {discount_pct}% OFF!\n\n"
            "Saath me complimentary chilled raita aur mirchi ka salan! 😋\n\n"
            "👉 Order Dum Biryani: {store_url}?coupon={promo_code}"
        ),
        "FRIENDLY": (
            "Craving authentic Dum Biryani, {name}? 🍛\n\n"
            "Our slow-cooked layered basmati rice with fragrant saffron and roasted spices is ready. Enjoy {discount_pct}% OFF with code *{promo_code}* today!\n\n"
            "👉 {store_url}?coupon={promo_code}"
        ),
        "URGENT_FOMO": (
            "⏳ Limited Handi Alert! Only 8 portions of fresh Dum Biryani remaining today for {name}!\n\n"
            "Lock your portion with {discount_pct}% OFF code: *{promo_code}*.\n\n"
            "👉 Order before it sells out: {store_url}?coupon={promo_code}"
        ),
        "FESTIVE": (
            "Royal Dum Biryani celebration for {name}! 👑\n\n"
            "Get {discount_pct}% OFF with code *{promo_code}* on all royal bowls.\n\n"
            "👉 {store_url}?coupon={promo_code}"
        )
    },
    "CHAI_SQUAD": {
        "TAPRI_HINGLISH": (
            "Chai Break Time! ☕✨ {name} bhai, shaam ki tapri chai aur butter Bun Maska ya Samosa ka combo ready hai!\n\n"
            "Aapke liye special Chai Squad discount {discount_pct}% OFF! Code: *{promo_code}*\n\n"
            "👉 Garma-garam Chai Order Karo: {store_url}?coupon={promo_code}"
        ),
        "FRIENDLY": (
            "It's tapri tea time, {name}! ☕\n\n"
            "Fresh adrak-elaichi cutting chai simmered to perfection. Enjoy {discount_pct}% OFF your tea & snacks with code *{promo_code}*!\n\n"
            "👉 {store_url}?coupon={promo_code}"
        ),
        "URGENT_FOMO": (
            "Evening Slump Buster for {name}! ⚡\n\n"
            "Recharge with artisanal tapri chai & snacks at {discount_pct}% OFF. Code: *{promo_code}* valid for the next 2 hours!\n\n"
            "👉 {store_url}?coupon={promo_code}"
        ),
        "FESTIVE": (
            "Happy Chai Hours for {name}! ☕🎉\n\n"
            "Enjoy {discount_pct}% OFF with code *{promo_code}*.\n\n"
            "👉 {store_url}?coupon={promo_code}"
        )
    },
    "WEEKEND_REGULARS": {
        "TAPRI_HINGLISH": (
            "Weekend Sorted! 🥳 {name} ji, kitchen me cookline full speed par hai!\n\n"
            "Family & friends ke saath enjoy karo delicious artisanal meals at {discount_pct}% OFF! Code: *{promo_code}*\n\n"
            "👉 Order Direct: {store_url}?coupon={promo_code}"
        ),
        "FRIENDLY": (
            "Happy Weekend {name}! 🌟\n\n"
            "Take a break from cooking and let RasoiLink deliver wholesome comfort food to your doorstep. Enjoy {discount_pct}% OFF with code *{promo_code}*!\n\n"
            "👉 {store_url}?coupon={promo_code}"
        ),
        "URGENT_FOMO": (
            "Weekend Rush Alert! 🚀 Skip the aggregator queue and get priority prep at {discount_pct}% OFF with code *{promo_code}*.\n\n"
            "👉 Order now: {store_url}?coupon={promo_code}"
        ),
        "FESTIVE": (
            "Celebrate the weekend, {name}! 🎉 Get {discount_pct}% OFF with code *{promo_code}*.\n\n"
            "👉 {store_url}?coupon={promo_code}"
        )
    },
    "FIRST_TIMER_WINBACK": {
        "TAPRI_HINGLISH": (
            "Namaste {name}! 🙏 RasoiLink par aapka pehla order hume bahut pasand aaya!\n\n"
            "Aapke second visit ke liye special flat {discount_pct}% OFF promo code create kiya gaya hai: *{promo_code}*!\n\n"
            "Aapka taste buds dobara satisfy karne ke liye ready hai!\n\n"
            "👉 Order again: {store_url}?coupon={promo_code}"
        ),
        "FRIENDLY": (
            "Welcome back to RasoiLink, {name}! 🌟\n\n"
            "Thank you for trying us out recently. We'd love to treat you again with {discount_pct}% OFF using code *{promo_code}*.\n\n"
            "👉 {store_url}?coupon={promo_code}"
        ),
        "URGENT_FOMO": (
            "Your 2nd Visit Special Reward is expiring soon, {name}! ⏰\n\n"
            "Use code *{promo_code}* for {discount_pct}% OFF before it expires.\n\n"
            "👉 {store_url}?coupon={promo_code}"
        ),
        "FESTIVE": (
            "Special treat for {name}! 🎉 Enjoy {discount_pct}% OFF your next order with code *{promo_code}*.\n\n"
            "👉 {store_url}?coupon={promo_code}"
        )
    }
}

def analyze_customer_rfm_segments(restaurant_id: str = "cp-artisan") -> Dict[str, Any]:
    """
    Performs RFM (Recency, Frequency, Monetary) segmentation across all customers in the database.
    Categorizes them into high-converting actionable segments.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT customer_name, customer_phone, items_json, total_amount, created_at, order_status
        FROM orders
        WHERE (restaurant_id = ? OR restaurant_id IS NULL)
          AND customer_phone IS NOT NULL AND customer_phone != ''
          AND order_status != 'CANCELLED'
        ORDER BY created_at ASC
    """, (restaurant_id,))
    rows = cursor.fetchall()

    customers = {}
    now = datetime.now()

    for r in rows:
        phone = r["customer_phone"].strip()
        name = r["customer_name"].strip() or "Valued Customer"
        amount = float(r["total_amount"] or 0)
        created_at_str = r["created_at"]

        try:
            created_dt = datetime.fromisoformat(created_at_str)
        except Exception:
            created_dt = now - timedelta(days=2)

        if phone not in customers:
            customers[phone] = {
                "phone": phone,
                "name": name,
                "orders_count": 0,
                "total_spend": 0.0,
                "first_order_date": created_dt,
                "last_order_date": created_dt,
                "dishes_ordered": {},
                "categories_ordered": {}
            }

        cust = customers[phone]
        cust["orders_count"] += 1
        cust["total_spend"] += amount
        if created_dt > cust["last_order_date"]:
            cust["last_order_date"] = created_dt
            cust["name"] = name  # Most recent name

        # Count dishes
        try:
            items = json.loads(r["items_json"])
            for itm in items:
                d_name = itm.get("name", "Special Dish")
                qty = itm.get("quantity", 1)
                cust["dishes_ordered"][d_name] = cust["dishes_ordered"].get(d_name, 0) + qty
        except Exception:
            pass

    segments = {
        "CHURN_RISK": [],
        "VIP_LOYALISTS": [],
        "WEEKEND_REGULARS": [],
        "BIRYANI_LOVERS": [],
        "CHAI_SQUAD": [],
        "FIRST_TIMER_WINBACK": []
    }

    all_customer_list = []

    for phone, cust in customers.items():
        days_ago = max(0, (now - cust["last_order_date"]).days)
        cust["days_since_last_order"] = days_ago
        cust["aov"] = round(cust["total_spend"] / max(1, cust["orders_count"]), 2)
        cust["total_spend"] = round(cust["total_spend"], 2)

        # Favorite dish
        fav_dish = max(cust["dishes_ordered"].items(), key=lambda x: x[1])[0] if cust["dishes_ordered"] else "Masala Cutting Chai"
        cust["favorite_dish"] = fav_dish

        # Segmentation logic
        assigned_segment = "FIRST_TIMER_WINBACK"
        if cust["orders_count"] >= 4 or cust["total_spend"] >= 1200:
            assigned_segment = "VIP_LOYALISTS"
        elif cust["orders_count"] >= 2 and days_ago >= 7:
            assigned_segment = "CHURN_RISK"
        elif "Biryani" in fav_dish or "Bowl" in fav_dish:
            assigned_segment = "BIRYANI_LOVERS"
        elif "Chai" in fav_dish or "Coffee" in fav_dish:
            assigned_segment = "CHAI_SQUAD"
        elif cust["orders_count"] >= 3:
            assigned_segment = "WEEKEND_REGULARS"
        else:
            assigned_segment = "FIRST_TIMER_WINBACK"

        cust["assigned_segment"] = assigned_segment

        client_summary = {
            "phone": cust["phone"],
            "name": cust["name"],
            "orders_count": cust["orders_count"],
            "total_spend": cust["total_spend"],
            "aov": cust["aov"],
            "days_since_last_order": cust["days_since_last_order"],
            "favorite_dish": cust["favorite_dish"],
            "assigned_segment": assigned_segment
        }
        segments[assigned_segment].append(client_summary)
        all_customer_list.append(client_summary)

    # Sort each segment by recency or value
    for k in segments:
        segments[k].sort(key=lambda x: (-x["total_spend"], x["days_since_last_order"]))

    conn.close()

    return {
        "timestamp": now.isoformat(),
        "total_unique_customers": len(customers),
        "segments_summary": {
            "CHURN_RISK": len(segments["CHURN_RISK"]),
            "VIP_LOYALISTS": len(segments["VIP_LOYALISTS"]),
            "BIRYANI_LOVERS": len(segments["BIRYANI_LOVERS"]),
            "CHAI_SQUAD": len(segments["CHAI_SQUAD"]),
            "WEEKEND_REGULARS": len(segments["WEEKEND_REGULARS"]),
            "FIRST_TIMER_WINBACK": len(segments["FIRST_TIMER_WINBACK"])
        },
        "segments": segments,
        "all_customers": all_customer_list
    }

def generate_personalized_offer_copy(
    name: str,
    phone: str,
    segment: str,
    tone: str,
    discount_pct: float,
    promo_code: str,
    favorite_dish: str = "Masala Cutting Chai",
    store_url: str = "http://127.0.0.1:8000"
) -> Dict[str, Any]:
    """Generates customized message copy and 1-click WhatsApp deep link."""
    # Check templates
    segment_dict = TEMPLATES_BY_SEGMENT_AND_TONE.get(segment, TEMPLATES_BY_SEGMENT_AND_TONE["CHURN_RISK"])
    template = segment_dict.get(tone, segment_dict.get("TAPRI_HINGLISH", ""))

    message_text = template.format(
        name=name,
        favorite_dish=favorite_dish,
        discount_pct=int(discount_pct) if discount_pct.is_integer() else discount_pct,
        promo_code=promo_code,
        store_url=store_url
    )

    clean_phone = phone.replace("+", "").replace(" ", "").replace("-", "")
    if len(clean_phone) == 10:
        clean_phone = "91" + clean_phone

    encoded_msg = urllib.parse.quote(message_text)
    wa_url = f"https://wa.me/{clean_phone}?text={encoded_msg}"

    return {
        "name": name,
        "phone": phone,
        "clean_phone": clean_phone,
        "segment": segment,
        "tone": tone,
        "promo_code": promo_code,
        "discount_pct": discount_pct,
        "message_text": message_text,
        "whatsapp_url": wa_url
    }

def create_marketing_campaign(
    campaign_name: str,
    target_segment: str,
    tone: str = "TAPRI_HINGLISH",
    discount_pct: float = 20.0,
    custom_prompt: Optional[str] = None,
    promo_code: Optional[str] = None,
    restaurant_id: str = "cp-artisan"
) -> Dict[str, Any]:
    """Creates, registers, and simulates an AI WhatsApp marketing campaign."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Generate promo code if not provided
    if not promo_code:
        prefix = target_segment[:4].upper()
        promo_code = f"{prefix}{int(discount_pct)}"

    # Register promo code in promo_codes table
    expires_at = (datetime.now() + timedelta(days=14)).strftime("%Y-%m-%d")
    cursor.execute("""
        INSERT OR IGNORE INTO promo_codes (
            code, title, description, discount_type, discount_value,
            min_order_value, max_discount, customer_tier, min_visits,
            max_margin_share_pct, is_active, is_single_use, is_used, expires_at
        ) VALUES (?, ?, ?, 'PERCENT', ?, 150.0, 100.0, 'ALL', 0, 50.0, 1, 0, 0, ?)
    """, (
        promo_code,
        f"WhatsApp Autopilot: {campaign_name}",
        f"Exclusive {discount_pct}% OFF promo code for {target_segment}",
        discount_pct,
        expires_at
    ))

    # Get target customers
    rfm = analyze_customer_rfm_segments(restaurant_id)
    target_customers = rfm["segments"].get(target_segment, [])
    if not target_customers and target_segment == "ALL":
        target_customers = rfm["all_customers"]
    elif not target_customers:
        target_customers = rfm["all_customers"][:5]

    total_recipients = len(target_customers)

    # Generate previews for each customer
    previews = []
    for c in target_customers[:10]:
        p = generate_personalized_offer_copy(
            name=c["name"],
            phone=c["phone"],
            segment=target_segment,
            tone=tone,
            discount_pct=discount_pct,
            promo_code=promo_code,
            favorite_dish=c["favorite_dish"]
        )
        previews.append(p)

    sample_template = previews[0]["message_text"] if previews else f"RasoiLink offer: {discount_pct}% OFF with {promo_code}"

    now_iso = datetime.now().isoformat()
    # Simulated conversion benchmarks (WhatsApp ~70% open/click, ~25% conversion)
    simulated_sent = max(1, total_recipients)
    simulated_clicks = round(simulated_sent * 0.72)
    simulated_conversions = round(simulated_sent * 0.32)
    estimated_revenue = round(simulated_conversions * 240.0, 2)

    cursor.execute("""
        INSERT INTO marketing_campaigns (
            campaign_name, target_segment, template_text, promo_code,
            channel, total_recipients, sent_count, clicks_count,
            conversions_count, revenue_generated, created_at
        ) VALUES (?, ?, ?, ?, 'WHATSAPP', ?, ?, ?, ?, ?, ?)
    """, (
        campaign_name, target_segment, sample_template, promo_code,
        total_recipients, simulated_sent, simulated_clicks,
        simulated_conversions, estimated_revenue, now_iso
    ))
    campaign_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return {
        "campaign_id": campaign_id,
        "campaign_name": campaign_name,
        "target_segment": target_segment,
        "tone": tone,
        "promo_code": promo_code,
        "discount_pct": discount_pct,
        "total_recipients": total_recipients,
        "simulated_sent": simulated_sent,
        "simulated_clicks": simulated_clicks,
        "simulated_conversions": simulated_conversions,
        "estimated_revenue_inr": estimated_revenue,
        "previews": previews,
        "status": "DISPATCHED"
    }

def get_marketing_campaigns_list() -> List[Dict[str, Any]]:
    """Retrieves all past and active marketing autopilot campaigns."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, campaign_name, target_segment, template_text, promo_code,
               channel, total_recipients, sent_count, clicks_count,
               conversions_count, revenue_generated, created_at
        FROM marketing_campaigns
        ORDER BY id DESC
    """)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows
