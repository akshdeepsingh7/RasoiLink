"""RasoiLink End-to-End Verification Test Suite"""
import random
from fastapi import HTTPException
from models import (
    OrderCreateRequest,
    OrderItem,
    CouponValidateRequest,
    StockToggleRequest,
    SlotCapacityUpdate,
    OrderStatusUpdate,
    CancelOrderRequest,
    ChatMessageRequest,
    AdminLoginRequest,
    PromoCreateRequest,
    MenuItemUpdateRequest,
    StoreSettingsUpdateRequest,
    RestaurantCreateRequest,
    WasteDiscountApplyRequest,
    MarketingCampaignCreateRequest,
    GroupPoolCreateRequest,
    GroupPoolJoinRequest,
    GroupPoolFinalizeRequest,
    OfflineSyncBatchRequest,
    OfflineSyncItem
)
import main
from database import init_db, get_db_connection

def run_tests():
    print("=" * 60)
    print("Running RasoiLink End-to-End Verification Test Suite")
    print("=" * 60)

    # 1. Initialize DB & WAL mode
    init_db()
    with get_db_connection() as conn:
        conn.execute("DELETE FROM orders WHERE customer_name IN ('Vikramaditya', 'Karan Malhotra', 'Aarav Gupta', 'Sneha Kapoor', 'Rohan Sharma') OR scheduled_date = '2026-11-15'")
        conn.commit()

    # 2. Health check
    h = main.health_check()
    assert h["status"] == "healthy"
    print("[OK] Health Check Passed:", h)

    # 3. Menu & Seeding
    menu = main.get_menu()
    assert len(menu["categories"]) == 5
    assert len(menu["items"]) >= 22
    first_item = menu["items"][0]
    assert "calories" in first_item
    assert "allergens" in first_item
    print(f"[OK] Menu Verified: {len(menu['categories'])} categories, {len(menu['items'])} items (with nutritional metadata)")

    # 4. Admin Authentication (PIN and Password flows)
    admin_pin_auth = main.admin_login(AdminLoginRequest(pin="1234"))
    assert admin_pin_auth["success"] is True
    assert admin_pin_auth["username"] == "admin"
    token = admin_pin_auth["token"]
    print(f"[OK] Admin Quick PIN Auth Passed: User {admin_pin_auth['full_name']} ({admin_pin_auth['role']})")

    admin_cred_auth = main.admin_login(AdminLoginRequest(username="admin", password="rasoi2026"))
    assert admin_cred_auth["success"] is True
    print("[OK] Admin Manager Credentials Auth Passed: admin / rasoi2026")

    # Verify session token
    verify_res = main.admin_verify(token=token)
    assert verify_res["valid"] is True
    print("[OK] Admin Session Token Verified Successfully")

    # 5. Admin Analytics & Promo Manager
    analytics = main.get_admin_analytics()
    assert "total_gross_revenue" in analytics
    assert "retention_coupons" in analytics
    print(f"[OK] Admin Analytics Verified: Total Gross Revenue ₹{analytics['total_gross_revenue']}, AOV ₹{analytics['average_order_value']}")

    # Create custom promo
    promo_res = main.create_custom_promo(PromoCreateRequest(
        code="CHAI50",
        discount_type="PERCENT",
        discount_value=50.0,
        min_order_value=100.0,
        max_discount=50.0
    ))
    assert promo_res["success"] is True
    assert promo_res["code"] == "CHAI50"
    print("[OK] Admin Custom Promo Created: CHAI50 (50% OFF)")

    # 6. Out of stock toggle
    item_id = menu["items"][0]["id"]
    t1 = main.toggle_stock(item_id, StockToggleRequest(is_available=False))
    assert t1["is_available"] is False
    t2 = main.toggle_stock(item_id, StockToggleRequest(is_available=True))
    assert t2["is_available"] is True
    print(f"[OK] 1-Tap Out-of-Stock Toggle Verified for Item #{item_id}")

    # 7. Slots & Capacity
    slots_res = main.get_slots(None)
    assert len(slots_res["slots"]) > 0
    first_slot = slots_res["slots"][0]
    print(f"[OK] Time Slots: {len(slots_res['slots'])} slots retrieved for {slots_res['date']}")

    cap_res = main.update_slot_capacity(SlotCapacityUpdate(
        slot_date=slots_res["date"],
        slot_time=first_slot["slot_time"],
        max_capacity=12
    ))
    assert cap_res["max_capacity"] == 12
    print(f"[OK] Slot Capacity Updated for {first_slot['slot_time']} -> 12")

    # 8. Coupon validation
    c_res = main.validate_coupon(CouponValidateRequest(code="HAPPY20", subtotal=250.0))
    assert c_res["discount_amount"] == 50.0
    print(f"[OK] Coupon HAPPY20 Validated: Saved ₹{c_res['discount_amount']} on ₹250 subtotal")

    # 9. Create Dine-In Order (with table #5, staff tip, no_cutlery)
    first_time_phone = f"98765{random.randint(10000, 99999)}"
    order_req = OrderCreateRequest(
        order_type="DINE_IN",
        table_number="5",
        customer_name="Rohan Sharma",
        customer_phone=first_time_phone,
        items=[
            OrderItem(id=1, name="Masala Cutting Chai", price=30.0, quantity=2, notes="Extra ginger"),
            OrderItem(id=6, name="Bombay Pav Bhaji", price=150.0, quantity=1, notes="Extra butter")
        ],
        coupon_code="WELCOME50",
        payment_method="UPI",
        tip_amount=20.0,
        no_cutlery=True
    )
    o_res = main.create_order(order_req)
    assert o_res["success"] is True
    assert o_res["order_code"].startswith("RL-")
    assert o_res["bounce_back_coupon_code"].startswith("BACK50-")
    assert o_res["tip_amount"] == 20.0
    assert o_res["no_cutlery"] is True
    assert o_res["discount_amount"] == 50.0
    assert o_res["total_amount"] == (o_res["subtotal"] - 50.0 + 20.0)
    print(f"[OK] Dine-In Order Placed: Code {o_res['order_code']}, Table #5, Tip ₹20, Total ₹{o_res['total_amount']}")
    print(f"[OK] Retention Engine: Issued Bounce-Back Voucher {o_res['bounce_back_coupon_code']}")

    # 10. Verify Bounce-Back Coupon is redeemable
    bounce_code = o_res["bounce_back_coupon_code"]
    bounce_validate = main.validate_coupon(CouponValidateRequest(code=bounce_code, subtotal=220.0))
    assert bounce_validate["discount_amount"] == 50.0
    print(f"[OK] Bounce-Back Voucher {bounce_code} Verified and Validated for Next Order!")

    # 11. Order Status Progression
    for s in ["PREPARING", "READY", "COMPLETED"]:
        st_res = main.update_order_status(o_res["order_code"], OrderStatusUpdate(status=s))
        assert st_res["new_status"] == s
        print(f"[OK] Order {o_res['order_code']} Status Transition: {s}")

    # 12. Kitchen Operations Stats
    stats = main.get_kitchen_stats()
    assert "active_tickets" in stats
    assert "today_revenue" in stats
    print("[OK] Kitchen Operations Metrics Verified:", stats)

    # 13. Test Order Cancellation
    cancel_order_req = OrderCreateRequest(
        order_type="TAKEAWAY",
        customer_name="Test Customer",
        customer_phone="9999999999",
        items=[OrderItem(id=1, name="Masala Cutting Chai", price=30.0, quantity=1)],
        payment_method="CASH"
    )
    cancel_order = main.create_order(cancel_order_req)
    cancel_res = main.cancel_order(cancel_order["order_code"], CancelOrderRequest(reason="Customer changed mind"))
    assert cancel_res["success"] is True
    assert cancel_res["order_status"] == "CANCELLED"
    print(f"[OK] Order Cancellation Flow Verified: Order {cancel_order['order_code']} -> CANCELLED")

    # 14. AI Chatbot endpoint
    chat_res = main.chat_endpoint(ChatMessageRequest(
        message="Add 2 cutting chai and a pav bhaji, also apply happy20"
    ))
    assert "message" in chat_res
    assert len(chat_res["actions"]) >= 2
    print(f"[OK] Chatbot Sync Endpoint Verified: {len(chat_res['actions'])} actions returned")
    for act in chat_res["actions"]:
        print(f"   • Action: {act}")

    # 15. Admin Logout
    logout_res = main.admin_logout(token=token)
    assert logout_res["success"] is True
    print("[OK] Admin Logout Verified")

    # 16. Accounting CSV Export Verification
    csv_orders = main.export_orders_csv()
    assert "Order Code,Created At,Channel" in csv_orders.body.decode("utf-8")
    assert csv_orders.media_type == "text/csv"
    csv_closing = main.export_daily_closing_csv()
    assert "Date,Total Orders,Completed" in csv_closing.body.decode("utf-8")
    assert csv_closing.media_type == "text/csv"
    print("[OK] Financial & Accounting CSV Export Pipelines Verified")

    # 17. 3-Channel Segregation & Channel-Specific Scheduling Verification
    # A. Immediate Dine-In (Table #4, Party 2)
    imm_dine = main.create_order(OrderCreateRequest(
        order_type="DINE_IN",
        table_number="4",
        party_size=2,
        customer_name="Pooja Sharma",
        customer_phone="9811122233",
        items=[OrderItem(id=1, name="Masala Cutting Chai", price=30.0, quantity=2)]
    ))
    assert imm_dine["party_size"] == 2
    assert imm_dine["order_type"] == "DINE_IN"
    assert imm_dine["scheduled_slot"] is None
    print(f"[OK] Immediate Dine-In: Order {imm_dine['order_code']}, Table #4, Party of {imm_dine['party_size']}")

    # B. Scheduled Dine-In (Advance Table Reservation for Table #8, Party 4)
    sched_dine = main.create_order(OrderCreateRequest(
        order_type="DINE_IN",
        table_number="8",
        party_size=4,
        customer_name="Vikramaditya",
        customer_phone="9822233344",
        items=[OrderItem(id=6, name="Bombay Pav Bhaji", price=150.0, quantity=2)],
        scheduled_date="2026-11-15",
        scheduled_slot="13:00 - 13:30"
    ))
    assert sched_dine["party_size"] == 4
    assert sched_dine["scheduled_date"] == "2026-11-15"
    assert sched_dine["scheduled_slot"] == "13:00 - 13:30"
    print(f"[OK] Scheduled Dine-In: Order {sched_dine['order_code']}, Table #8, Party 4, Reserved for {sched_dine['scheduled_date']} ({sched_dine['scheduled_slot']})")

    # C. Immediate Takeaway (Counter Pickup)
    imm_take = main.create_order(OrderCreateRequest(
        order_type="TAKEAWAY",
        customer_name="Karan Malhotra",
        customer_phone="9833344455",
        notes="Counter Pickup - please pack fast",
        items=[OrderItem(id=2, name="Irani Chai with Bun Maska", price=75.0, quantity=1)]
    ))
    assert imm_take["order_type"] == "TAKEAWAY"
    assert imm_take["scheduled_slot"] is None
    print(f"[OK] Immediate Takeaway: Order {imm_take['order_code']}, Notes: {imm_take['notes']}")

    # D. Scheduled Takeaway (Express Pickup Window)
    sched_take = main.create_order(OrderCreateRequest(
        order_type="TAKEAWAY",
        customer_name="Ananya Roy",
        customer_phone="9844455566",
        items=[OrderItem(id=10, name="Paneer Tikka Roll", price=160.0, quantity=2)],
        scheduled_date="2026-11-15",
        scheduled_slot="14:00 - 14:30"
    ))
    assert sched_take["order_type"] == "TAKEAWAY"
    assert sched_take["scheduled_slot"] == "14:00 - 14:30"
    print(f"[OK] Scheduled Takeaway: Order {sched_take['order_code']}, Pickup Window: {sched_take['scheduled_slot']}")

    # E. Immediate Delivery (Direct Doorstep)
    imm_deli = main.create_order(OrderCreateRequest(
        order_type="DELIVERY",
        customer_name="Deepak Verma",
        customer_phone="9855566677",
        delivery_address="Flat 402, Barakhamba Road, Connaught Place",
        items=[OrderItem(id=15, name="Dal Makhani with Jeera Rice", price=220.0, quantity=1)]
    ))
    assert imm_deli["order_type"] == "DELIVERY"
    assert imm_deli["delivery_fee"] == 30.0
    assert imm_deli["scheduled_slot"] is None
    print(f"[OK] Immediate Delivery: Order {imm_deli['order_code']}, Address: {imm_deli['delivery_address']}")

    # F. Scheduled Delivery (Preferred Drop-off Window)
    sched_deli = main.create_order(OrderCreateRequest(
        order_type="DELIVERY",
        customer_name="Meera Kapoor",
        customer_phone="9866677788",
        delivery_address="Penthouse 12B, Kasturba Gandhi Marg",
        items=[OrderItem(id=18, name="Gulab Jamun", price=60.0, quantity=4)],
        scheduled_date="2026-11-15",
        scheduled_slot="19:30 - 20:00"
    ))
    assert sched_deli["order_type"] == "DELIVERY"
    assert sched_deli["delivery_fee"] == 30.0
    assert sched_deli["scheduled_slot"] == "19:30 - 20:00"
    print(f"[OK] Scheduled Delivery: Order {sched_deli['order_code']}, Drop-off Window: {sched_deli['scheduled_slot']}")

    # G. Verify Order List contains all channels & attributes
    all_orders = main.list_orders()["orders"]
    codes = [o["order_code"] for o in all_orders]
    assert imm_dine["order_code"] in codes
    assert sched_dine["order_code"] in codes
    assert imm_take["order_code"] in codes
    assert sched_take["order_code"] in codes
    assert imm_deli["order_code"] in codes
    assert sched_deli["order_code"] in codes
    print("[OK] All 6 Channel Order permutations verified in active queue")

    # 18. Customer Frequency & Repeat Order Coupons Verification
    # A. First-Time Diner (0 prior visits) - WELCOME50 succeeds
    first_timer_phone = "9111122222"
    welcome_res = main.validate_coupon(CouponValidateRequest(
        code="WELCOME50",
        subtotal=200.0,
        customer_phone=first_timer_phone
    ))
    assert welcome_res["valid"] is True
    assert welcome_res["customer_tier"] == "FIRST_TIME"
    assert welcome_res["customer_visit_count"] == 0
    print(f"[OK] First-Timer Welcome Coupon: {welcome_res['code']} verified for new customer ({welcome_res['customer_tier']})")

    # B. Regular Diner Club Coupon (REGULAR20 requires 3+ visits) - Fails for new customer
    try:
        main.validate_coupon(CouponValidateRequest(
            code="REGULAR20",
            subtotal=250.0,
            customer_phone=first_timer_phone
        ))
        assert False, "REGULAR20 should have been rejected for a customer with 0 visits"
    except HTTPException as e:
        assert e.status_code == 400
        assert "regular patrons" in e.detail.lower() or "3+" in e.detail
        print(f"[OK] Customer Frequency Protection: REGULAR20 correctly blocked for new visitor ({e.detail})")

    # 19. Margin-Aware Dynamic Discounting & Loss Prevention Verification
    # 2x Bombay Pav Bhaji (Subtotal ₹300, Food Cost ₹110 -> Gross Profit Margin ₹190)
    # Nominal 20% discount on ₹300 is ₹60.0. Margin Cap (50% of ₹190) is ₹95.0 -> allows full safe discount ₹60.0 without loss!
    pav_items = [{"id": 6, "price": 150.0, "quantity": 2}]
    margin_res = main.validate_coupon(CouponValidateRequest(
        code="HAPPY20",
        subtotal=300.0,
        items=pav_items
    ))
    assert margin_res["valid"] is True
    assert margin_res["gross_margin"] == 190.0
    assert margin_res["discount_amount"] <= margin_res["margin_cap"]
    print(f"[OK] Margin-Aware Discount Engine: Validated cart margin ₹{margin_res['gross_margin']}, safe cap ₹{margin_res['margin_cap']}, applied ₹{margin_res['discount_amount']} (No loss guaranteed)")

    # 20. Store Profile, Branding & Local Location Settings Verification
    settings_res = main.get_store_settings()["settings"]
    assert "store_name" in settings_res
    assert "location_name" in settings_res
    print(f"[OK] Store Profile Verified: '{settings_res['store_name']}' at {settings_res['location_name']}")

    # Admin updates store title, description and local location
    update_store = main.update_store_settings(StoreSettingsUpdateRequest(
        store_name="RasoiLink Artisan Cafe",
        tagline="Brewing Fresh Chai & Handcrafted Tapri Bites",
        description="Fresh culinary craft in the heart of Connaught Place.",
        location_name="Connaught Place, Inner Circle",
        full_address="Block M, Shop 14, Connaught Place, New Delhi",
        opening_hours="10:00 AM – 10:30 PM Daily",
        phone="+91 98765 43210",
        announcement="Order direct from your table or schedule for pickup!"
    ))
    assert update_store["success"] is True
    updated_st = main.get_store_settings()["settings"]
    assert updated_st["store_name"] == "RasoiLink Artisan Cafe"
    assert updated_st["location_name"] == "Connaught Place, Inner Circle"
    print(f"[OK] Admin Store Settings Update Verified: '{updated_st['store_name']}' at {updated_st['location_name']}")

    # 21. Admin Menu Item Details Update Verification (Title, Description, Price, Cost Price)
    update_item = main.update_menu_item(1, MenuItemUpdateRequest(
        name="Masala Special Tapri Chai",
        description="Double-brewed adrak and elaichi cutting chai prepared with full-cream milk.",
        price=35.0,
        cost_price=9.5
    ))
    assert update_item["success"] is True
    menu_verify = main.get_menu()["items"]
    first_updated = [i for i in menu_verify if i["id"] == 1][0]
    assert first_updated["name"] == "Masala Special Tapri Chai"
    assert first_updated["price"] == 35.0
    assert first_updated["cost_price"] == 9.5
    print(f"[OK] Admin Dish Details Update Verified: '{first_updated['name']}', Price ₹{first_updated['price']}, Cost ₹{first_updated['cost_price']} (Margin ₹{first_updated['price'] - first_updated['cost_price']})")

    # 22. Multi-Restaurant Franchise & Outlet Isolation Verification
    rests = main.list_restaurants()["restaurants"]
    assert len(rests) >= 4
    rest_ids = [r["id"] for r in rests]
    assert "cp-artisan" in rest_ids
    assert "cyberhub-bistro" in rest_ids
    assert "khan-market" in rest_ids
    assert "indiranagar" in rest_ids
    print(f"[OK] Multi-Restaurant Network Verified: {len(rests)} active outlets registered")

    # Place an order specifically assigned to Cyber Hub Bistro
    cyber_order = main.create_order(OrderCreateRequest(
        restaurant_id="cyberhub-bistro",
        order_type="DINE_IN",
        customer_name="Rohan Sharma",
        customer_phone="9877788899",
        table_number="T12",
        items=[OrderItem(id=6, name="Bombay Pav Bhaji", price=140.0, quantity=2)]
    ))
    assert cyber_order["restaurant_id"] == "cyberhub-bistro"
    print(f"[OK] Outlet Specific Order Placed: {cyber_order['order_code']} at outlet {cyber_order['restaurant_id']}")

    # Verify filtering tickets by outlet
    cyber_orders = main.list_orders(restaurant_id="cyberhub-bistro")["orders"]
    cyber_codes = [o["order_code"] for o in cyber_orders]
    assert cyber_order["order_code"] in cyber_codes
    print(f"[OK] Kitchen Outlet Isolation Verified: Cyber Hub ticket filter retrieved {len(cyber_orders)} tickets")

    # Verify kitchen metrics isolation for outlet
    cyber_stats = main.get_kitchen_stats(restaurant_id="cyberhub-bistro")
    assert cyber_stats["active_tickets"] >= 1
    print(f"[OK] Kitchen Stats Outlet Isolation Verified: {cyber_stats['active_tickets']} active tickets at Cyber Hub")

    # 23. AI Waste-to-Profit Engine Verification
    waste_pred = main.get_waste_predictions(restaurant_id="cp-artisan")
    assert len(waste_pred["items"]) >= 22
    assert "shift_progress_pct" in waste_pred
    assert "total_surplus_cost_at_risk" in waste_pred
    deal_created = main.apply_waste_flash_discount(WasteDiscountApplyRequest(
        item_id=10, # Paneer Kathi Roll
        discount_pct=35.0,
        duration_hours=4.0,
        quantity_available=6,
        reason="Verification Flash Deal"
    ))
    assert deal_created["discount_pct"] == 35.0
    assert deal_created["status"] == "ACTIVE"
    active_deals = main.get_active_waste_flash_deals(restaurant_id="cp-artisan")
    assert len(active_deals) >= 1
    waste_impact = main.get_waste_profit_impact(restaurant_id="cp-artisan")
    assert waste_impact["meals_rescued_count"] >= 1
    print(f"[OK] AI Waste-to-Profit Engine Verified: {len(waste_pred['items'])} items forecasted, deal activated at {deal_created['discount_pct']}% OFF, {waste_impact['meals_rescued_count']} meals rescued (saved ₹{waste_impact['revenue_recovered_inr']})")

    # 24. AI Marketing Autopilot Verification
    rfm = main.get_marketing_rfm_segments(restaurant_id="cp-artisan")
    assert "segments_summary" in rfm
    assert "all_customers" in rfm
    preview_wa = main.preview_personalized_offer(
        name="Aman",
        phone="+91 98112 88888",
        segment="CHURN_RISK",
        tone="TAPRI_HINGLISH",
        discount_pct=25.0,
        promo_code="MISSYOU25",
        favorite_dish="Bombay Pav Bhaji"
    )
    assert "https://wa.me/" in preview_wa["whatsapp_url"]
    assert "MISSYOU25" in preview_wa["message_text"]
    campaign = main.trigger_marketing_campaign(MarketingCampaignCreateRequest(
        campaign_name="Chai & Samosa Weekend Winback",
        target_segment="CHAI_SQUAD",
        tone="TAPRI_HINGLISH",
        discount_pct=20.0,
        promo_code="CHAI20"
    ))
    assert campaign["status"] == "DISPATCHED"
    assert campaign["promo_code"] == "CHAI20"
    all_campaigns = main.get_campaigns_history()
    assert len(all_campaigns) >= 1
    print(f"[OK] AI Marketing Autopilot Verified: RFM segmented {len(rfm['all_customers'])} patrons, WhatsApp click-to-chat generated, campaign '{campaign['campaign_name']}' dispatched")

    # 25. Group Hunger Network Verification
    new_pool = main.create_new_group_pool(GroupPoolCreateRequest(
        title="IIT Delhi Hostel 4 Dinner Squad",
        pool_type="STUDENT_HOSTEL",
        location_name="Hauz Khas IIT Campus",
        delivery_address="Hostel 4 Wing B Common Room",
        creator_name="Arjun Mehta",
        creator_phone="+91 98765 11223",
        target_amount=1200.0,
        duration_minutes=45
    ))
    p_code = new_pool["pool_code"]
    assert len(p_code) == 6
    assert new_pool["status"] == "ACTIVE"
    # Join pool with 2 diners
    updated_p1 = main.join_existing_group_pool(p_code, GroupPoolJoinRequest(
        participant_name="Arjun Mehta",
        participant_phone="+91 98765 11223",
        items=[OrderItem(id=6, name="Bombay Pav Bhaji", price=150.0, quantity=2)],
        notes="Extra pav please"
    ))
    updated_p2 = main.join_existing_group_pool(p_code, GroupPoolJoinRequest(
        participant_name="Kabir Roy",
        participant_phone="+91 98765 44556",
        items=[OrderItem(id=17, name="Hyderabadi Veg Dum Biryani", price=210.0, quantity=1), OrderItem(id=1, name="Masala Cutting Chai", price=30.0, quantity=2)],
        notes="Spicy salan"
    ))
    assert updated_p2["members_count"] == 2
    assert updated_p2["discount_tier_pct"] >= 10.0 # Unlocks Tier 1 (10% OFF for 2+ members / ₹400+)
    # Finalize pool order to kitchen
    finalized_p = main.finalize_group_pool(p_code, GroupPoolFinalizeRequest(notes="Campus Delivery Gate 2"))
    assert finalized_p["status"] == "FINALIZED"
    assert finalized_p["generated_order_code"].startswith("GP-")
    print(f"[OK] Group Hunger Network Verified: Pool #{p_code} created, 2 diners pooled, unlocked {updated_p2['discount_tier_pct']}% OFF, batch order {finalized_p['generated_order_code']} sent to kitchen")

    # 26. Offline-First Bharat Mode & Auto-Sync Verification
    offline_ref = f"OFFLINE-VERIFY-{random.randint(1000, 9999)}"
    mock_offline_order = {
        "offline_ref": offline_ref,
        "offline_created_at": "2026-11-14T05:00:00",
        "order_data": {
            "order_type": "DINE_IN",
            "table_number": "7",
            "party_size": 2,
            "customer_name": "Bharat Offline Visitor",
            "customer_phone": "+91 99000 11223",
            "items": [{"id": 1, "name": "Masala Cutting Chai", "price": 30.0, "quantity": 3}],
            "payment_method": "CASH_ON_DELIVERY",
            "notes": "Offline ticket test"
        }
    }
    sync_res = main.sync_single_order_offline(mock_offline_order)
    assert sync_res["status"] == "SYNCED"
    assert sync_res["order_code"].startswith("RL-")
    # Test idempotency (syncing duplicate offline_ref should not duplicate order)
    sync_dup = main.sync_single_order_offline(mock_offline_order)
    assert sync_dup["status"] == "ALREADY_SYNCED"
    assert sync_dup["order_code"] == sync_res["order_code"]
    # Test batch sync
    batch_res = main.sync_batch_orders_offline(OfflineSyncBatchRequest(orders=[
        OfflineSyncItem(
            offline_ref=f"OFFLINE-BATCH-{random.randint(1000, 9999)}",
            offline_created_at="2026-11-14T05:10:00",
            order_data=OrderCreateRequest(
                order_type="TAKEAWAY",
                customer_name="Batch Offline Guest",
                customer_phone="+91 99000 44556",
                items=[OrderItem(id=7, name="Batata Vada Pav", price=80.0, quantity=2)],
                payment_method="UPI"
            )
        )
    ]))
    assert batch_res["synced_count"] == 1
    offline_stats = main.get_offline_sync_status()
    assert offline_stats["total_offline_synced"] >= 2
    assert offline_stats["status"] == "ONLINE"
    print(f"[OK] Offline-First Bharat Mode Verified: Single order synced (Code: {sync_res['order_code']}), Idempotency verified, Batch sync committed, Total offline synced: {offline_stats['total_offline_synced']}")

    # 27. SafeKitchen Verified Checklist & Trust Score Audit Suite
    sk_cp = main.get_safekitchen_status("cp-artisan")
    assert sk_cp["success"] is True
    assert sk_cp["trust_score"] == 98
    assert sk_cp["is_verified"] is True
    assert len(sk_cp["checks"]) == 9
    expected_order = [
        "Handwashing completed",
        "Gloves and apron changed",
        "Veg/Non-veg separated",
        "Fresh ingredients logged",
        "Oil-change log updated",
        "Fridge temperature checked",
        "Cleaning schedule completed",
        "Allergy-safe handling available",
        "Packaging hygiene verified"
    ]
    actual_order = [c["title"] for c in sk_cp["checks"]]
    assert actual_order == expected_order, f"SafeKitchen check order mismatch: {actual_order}"
    for check in sk_cp["checks"]:
        assert check["verified"] is True

    # Multi-outlet test
    sk_cyber = main.get_safekitchen_status("cyberhub-bistro")
    assert sk_cyber["trust_score"] == 97
    sk_khan = main.get_safekitchen_status("khan-market")
    assert sk_khan["trust_score"] == 99
    sk_blr = main.get_safekitchen_status("indiranagar")
    assert sk_blr["trust_score"] == 96

    # Graceful handling for non-existent outlet
    try:
        main.get_safekitchen_status("nonexistent-outlet")
        assert False, "Should have raised 404 HTTPException"
    except main.HTTPException as he:
        assert he.status_code == 404

    print(f"[OK] SafeKitchen Verified Engine: 9/9 checks verified in order, Trust Score {sk_cp['trust_score']}/100, FSSAI License {sk_cp['fssai_license']}, Multi-outlet & 404 graceful error handling validated")

    print("=" * 60)
    print("ALL 27 TESTS PASSED CLEANLY WITH ZERO ERRORS!")
    print("=" * 60)

if __name__ == "__main__":
    run_tests()
