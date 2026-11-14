import os
import json
import re
from datetime import datetime, timedelta
from dotenv import load_dotenv
import httpx
from database import get_db_connection

load_dotenv()

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

def process_chat_message(user_message: str, history: list = None, current_cart: list = None) -> dict:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile").strip()

    # Fetch live menu and promos for context
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT m.id, m.name, c.name as category, m.price, m.veg, m.spice_level, m.is_available, m.description
        FROM menu_items m
        JOIN categories c ON m.category_id = c.id
        ORDER BY c.sort_order, m.id
    """)
    menu_items = [dict(row) for row in cursor.fetchall()]

    cursor.execute("SELECT code, discount_type, discount_value, min_order_value FROM promo_codes WHERE is_active = 1")
    promos = [dict(row) for row in cursor.fetchall()]
    conn.close()

    # If Groq API key is present, attempt Groq API call
    if api_key:
        try:
            return call_groq_api(api_key, model, user_message, history, current_cart, menu_items, promos)
        except Exception as e:
            # Fallback to rule-based engine on any error
            print(f"[Groq API Fallback Warning]: {e}")
            return rule_based_chat_fallback(user_message, menu_items, promos)
    else:
        # Rule-based fallback when no API key configured
        return rule_based_chat_fallback(user_message, menu_items, promos)

def call_groq_api(api_key: str, model: str, user_message: str, history: list, current_cart: list, menu_items: list, promos: list) -> dict:
    cart_summary = []
    if current_cart:
        for item in current_cart:
            cart_summary.append(f"- {item.get('name')} x{item.get('quantity', 1)} (₹{item.get('price')})")
    cart_text = "\n".join(cart_summary) if cart_summary else "Cart is currently empty."

    menu_summary = []
    for item in menu_items:
        status = "IN STOCK" if item["is_available"] else "OUT OF STOCK"
        veg = "Veg" if item["veg"] else "Non-Veg"
        menu_summary.append(f"ID:{item['id']} | {item['name']} | ₹{item['price']} | {veg} | {item['spice_level']} | {status}")
    menu_text = "\n".join(menu_summary)

    promo_summary = []
    for p in promos:
        promo_summary.append(f"Code: {p['code']} ({p['discount_type']} ₹{p['discount_value']} off, Min ₹{p['min_order_value']})")
    promo_text = "\n".join(promo_summary)

    system_prompt = f"""You are the friendly, witty AI Cafe Host and Ordering Assistant for 'RasoiLink' — a beloved Indian cafe and quick-service bistro.
Your personality is warm, hospitable, and proudly Indian (using friendly touches like 'Namaste', 'Arre wah!', 'Bilkul!').

LIVE RESTAURANT CONTEXT:
[Active Promos]:
{promo_text}

[Menu Catalog (IDs & Prices in INR)]:
{menu_text}

[Customer's Current Cart]:
{cart_text}

STORE POLICIES & HOURS:
- Operating hours: 10:00 AM to 10:30 PM every day.
- Modes: Dine-in (with QR table orders), Takeaway (counter pickup), and Local Delivery within 5 km.
- Scheduled ordering: 30-minute advance time slots for today and future dates.
- All spices ground in-house, pure desi ghee used for sweets and parathas.

CRITICAL INSTRUCTION - JSON OUTPUT FORMAT:
You MUST respond strictly with a valid JSON object. Do not include markdown code block backticks (like ```json). Respond ONLY with the raw JSON string:
{{
  "message": "Your conversational answer, recommendation, or order confirmation to the user.",
  "actions": [
    // actions can contain zero, one, or multiple objects of:
    // {{"action": "ADD_ITEM", "item_id": <int>, "item_name": "<str>", "quantity": <int>}}
    // {{"action": "REMOVE_ITEM", "item_id": <int>}}
    // {{"action": "APPLY_COUPON", "code": "<str>"}}
    // {{"action": "SET_SCHEDULE", "date": "YYYY-MM-DD", "time_slot": "HH:MM - HH:MM"}}
  ]
}}

RULES FOR ACTIONS:
1. When user asks to order, add, or get an item (e.g. "Add 2 cutting chai and a pav bhaji"), match them with the exact menu ID from the catalog and emit ADD_ITEM actions with the requested quantity.
2. If an item is OUT OF STOCK, politely tell them it is sold out today and suggest a tasty alternative. Do NOT emit ADD_ITEM for out-of-stock items.
3. When user asks for a discount or says "apply happy20" or "any coupon?", emit APPLY_COUPON with the valid promo code.
4. When user asks general questions or dietary advice (e.g. "what are your vegan options?", "is biryani spicy?"), answer warmly and keep actions as [].
5. Always ensure JSON is 100% syntactically valid and parseable.
"""

    messages = [{"role": "system", "content": system_prompt}]

    if history:
        for msg in history[-6:]:
            role = "user" if msg.get("sender") == "user" else "assistant"
            messages.append({"role": role, "content": msg.get("text", "")})

    messages.append({"role": "user", "content": user_message})

    with httpx.Client(timeout=8.0) as client:
        response = client.post(
            GROQ_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
                "temperature": 0.4,
                "max_tokens": 600,
                "response_format": {"type": "json_object"}
            }
        )

        if response.status_code != 200:
            raise Exception(f"Groq API returned HTTP {response.status_code}: {response.text}")

        res_json = response.json()
        raw_content = res_json["choices"][0]["message"]["content"].strip()

        if raw_content.startswith("```json"):
            raw_content = raw_content[7:]
        if raw_content.startswith("```"):
            raw_content = raw_content[3:]
        if raw_content.endswith("```"):
            raw_content = raw_content[:-3]
        raw_content = raw_content.strip()

        parsed = json.loads(raw_content)
        if "message" not in parsed:
            parsed["message"] = "Order updated! Anything else I can get for you?"
        if "actions" not in parsed or not isinstance(parsed["actions"], list):
            parsed["actions"] = []
        return parsed

def rule_based_chat_fallback(user_message: str, menu_items: list, promos: list) -> dict:
    """Intelligent rule-based fallback when Groq API key is not supplied or network fails."""
    text = user_message.lower().strip()
    actions = []
    response_lines = []

    # Number word to int
    word_to_num = {
        "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
        "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "a": 1, "an": 1
    }

    # 1. Coupon detection
    for promo in promos:
        code = promo["code"].lower()
        if code in text or ("coupon" in text and code in ["happy20", "welcome50"]):
            actions.append({"action": "APPLY_COUPON", "code": promo["code"]})
            response_lines.append(f"Applied coupon code **{promo['code']}** to your order successfully.")
            break

    if "discount" in text or "offer" in text or "code" in text:
        if not any(a["action"] == "APPLY_COUPON" for a in actions):
            promo_list = ", ".join([f"`{p['code']}` ({p['discount_type']} ₹{p['discount_value']} off)" for p in promos[:2]])
            response_lines.append(f"We have active offers today! Try using {promo_list} at checkout.")

    # 2. Add Item / Order Intent detection
    for item in menu_items:
        item_name_lower = item["name"].lower()
        short_names = [
            item_name_lower,
            item_name_lower.replace("authentic ", "").replace("bombay ", "").replace("shahi ", "").replace("warm ", ""),
            item_name_lower.split("(")[0].strip()
        ]

        matched = False
        for s in short_names:
            if s in text:
                matched = True
                break

        if not matched:
            if "chai" in text and "chai" in item_name_lower and item["id"] == 1:
                matched = True
            elif "vada pav" in text and item["id"] == 7:
                matched = True
            elif "pav bhaji" in text and item["id"] == 6:
                matched = True
            elif "bun maska" in text and item["id"] == 8:
                matched = True
            elif "samosa" in text and item["id"] == 9:
                matched = True
            elif "paratha" in text and "aloo" in text and item["id"] == 12:
                matched = True
            elif "chole bhature" in text and item["id"] == 14:
                matched = True
            elif "butter chicken" in text and item["id"] == 16:
                matched = True
            elif "gulab jamun" in text and item["id"] == 20:
                matched = True
            elif "lassi" in text and item["id"] == 4:
                matched = True
            elif "kulfi" in text and item["id"] == 21:
                matched = True

        if matched:
            if not item["is_available"]:
                response_lines.append(f"Aiyyo, sorry! **{item['name']}** is sold out for today. Would you like to try something else?")
                continue

            qty = 1
            tokens = (item.get('name') or "").split()
            first_word = tokens[0].lower() if tokens else ""
            if not first_word:
                continue
            match_num = re.search(r"(\d+)\s*(?:x|plate|plates|cups?|orders?)?\s*" + re.escape(first_word), text)
            if match_num:
                qty = int(match_num.group(1))
            else:
                for w, num in word_to_num.items():
                    if f"{w} " in text or f"{w}x" in text:
                        qty = num
                        break

            actions.append({
                "action": "ADD_ITEM",
                "item_id": item["id"],
                "item_name": item["name"],
                "quantity": qty
            })
            response_lines.append(f"Added **{qty}x {item['name']}** (₹{item['price'] * qty}) to your order tray.")

    # 3. Schedule detection
    if "schedule" in text or "slot" in text or "tomorrow" in text or "later" in text:
        today = datetime.now()
        target_date = (today + timedelta(days=1 if "tomorrow" in text else 0)).strftime("%Y-%m-%d")
        slot = "13:00 - 13:30" if "lunch" in text or "1" in text else "19:30 - 20:00"
        actions.append({"action": "SET_SCHEDULE", "date": target_date, "time_slot": slot})
        response_lines.append(f"Order schedule set to **{target_date}** during the **{slot}** booking slot.")

    # 4. FAQ / General queries
    if not response_lines:
        if any(w in text for w in ["hi", "hello", "namaste", "hey"]):
            response_lines.append("Welcome to RasoiLink! I am your digital concierge. I can assist you with dish recommendations, applying promotional codes, or scheduling advance orders. What would you like today?")
        elif "veg" in text or "vegetarian" in text or "jain" in text:
            response_lines.append("Most of our cafe menu is 100% Pure Vegetarian. Recommended selections include Bombay Pav Bhaji, Amritsari Aloo Paratha, Samosa Chaat, or Hyderabadi Veg Dum Biryani.")
        elif "spicy" in text or "spice" in text:
            response_lines.append("Our Batata Vada Pav, Chole Bhature, and Murgh Dum Biryani feature authentic Indian spices. For milder options, we recommend Dal Makhani, Bun Maska, or Shahi Matka Kulfi.")
        elif "timing" in text or "open" in text or "hours" in text:
            response_lines.append("RasoiLink is open 7 days a week from 10:00 AM to 10:30 PM! You can dine in, pick up takeaway, or schedule an order in advance.")
        elif "recommend" in text or "popular" in text or "best" in text:
            response_lines.append("You cannot miss our signature Kulhad Chai with Bun Maska, followed by our butter-loaded Bombay Pav Bhaji and hot Gulab Jamun!")
        else:
            response_lines.append("I'm here to help! Tell me what you'd like to eat (e.g. 'Add 2 Cutting Chai and 1 Pav Bhaji'), ask for recommendations, or apply promo codes like HAPPY20.")

    return {
        "message": " ".join(response_lines),
        "actions": actions
    }
