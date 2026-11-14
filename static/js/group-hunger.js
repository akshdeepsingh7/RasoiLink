// RasoiLink Group Hunger Network Controller
// Enables student hostels, tech park offices, and societies to pool orders and unlock tiered group discounts

let activePoolCode = null;
let poolRefreshTimer = null;

function checkUrlForGroupPool() {
  const urlParams = new URLSearchParams(window.location.search);
  const pool = urlParams.get('pool');
  if (pool) {
    console.log('[Group Hunger Network] Detected pool code in URL:', pool);
    openPoolRoom(pool.toUpperCase());
  }
}

async function openGroupHungerModal() {
  let modal = document.getElementById('groupHungerModal');
  if (!modal) {
    createGroupHungerModalMarkup();
    modal = document.getElementById('groupHungerModal');
    if (window.lucide) lucide.createIcons();
  }

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
  await loadActiveCommunityPools();
}

function closeGroupHungerModal() {
  const modal = document.getElementById('groupHungerModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

function createGroupHungerModalMarkup() {
  const markup = `
    <div id="groupHungerModal" class="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-md flex items-center justify-center p-4 hidden">
      <div class="w-full max-w-lg bg-white border border-stone-200 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <!-- Header -->
        <div class="flex items-center justify-between pb-3 border-b border-stone-100">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md shadow-amber-500/20">
              <i data-lucide="users-round" class="w-5 h-5"></i>
            </div>
            <div>
              <h2 class="text-lg font-black text-stone-900 tracking-tight">Group Hunger Network</h2>
              <p class="text-[11px] text-stone-500 font-semibold">Combine orders with friends & unlock up to 25% OFF!</p>
            </div>
          </div>
          <button onclick="closeGroupHungerModal()" class="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-500 flex items-center justify-center text-sm">✕</button>
        </div>

        <!-- Tier Highlights Banner -->
        <div class="bg-gradient-to-r from-amber-50 to-orange-50 border border-orange-200/80 rounded-2xl p-3.5 space-y-2">
          <span class="text-[10px] font-black text-brand-800 uppercase tracking-widest">Pooled Discount Ladder</span>
          <div class="grid grid-cols-3 gap-2 text-center text-xs">
            <div class="bg-white/90 border border-orange-100 p-2 rounded-xl shadow-xs">
              <span class="block text-brand-600 font-extrabold text-sm">10% OFF</span>
              <span class="text-[10px] text-stone-500 font-medium">₹400+ or 2 diners</span>
            </div>
            <div class="bg-white/90 border border-orange-100 p-2 rounded-xl shadow-xs">
              <span class="block text-brand-600 font-extrabold text-sm">15% OFF</span>
              <span class="text-[10px] text-stone-500 font-medium">₹800+ or 4 diners</span>
            </div>
            <div class="bg-white/90 border border-orange-200 p-2 rounded-xl shadow-xs ring-1 ring-amber-400">
              <span class="block text-emerald-600 font-extrabold text-sm">25% OFF</span>
              <span class="text-[10px] text-emerald-700 font-bold">₹1500+ or 6 diners</span>
            </div>
          </div>
        </div>

        <!-- Options: Join by Code vs Create New Pool -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <!-- Quick Join with Code -->
          <div class="p-3.5 bg-stone-50 border border-stone-200 rounded-2xl space-y-2">
            <span class="text-xs font-bold text-stone-700 block">Have a Pool Code?</span>
            <div class="flex gap-1.5">
              <input type="text" id="inputJoinCode" placeholder="HOSTEL" maxlength="6" class="flex-1 px-3 py-2 bg-white border border-stone-300 rounded-xl text-xs uppercase font-mono font-black text-center focus:outline-none focus:border-brand-500">
              <button onclick="submitJoinPoolCode()" class="px-3.5 py-2 bg-stone-900 hover:bg-brand-600 text-white rounded-xl text-xs font-bold transition-all">Join</button>
            </div>
          </div>

          <!-- Create Pool Trigger -->
          <div class="p-3.5 bg-stone-50 border border-stone-200 rounded-2xl flex flex-col justify-between space-y-2">
            <div>
              <span class="text-xs font-bold text-stone-700 block">Host a New Group Pool</span>
              <span class="text-[11px] text-stone-500">For hostel wings, offices, or societies</span>
            </div>
            <button onclick="showCreatePoolForm()" class="w-full py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-1.5">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i>
              <span>Create New Pool</span>
            </button>
          </div>
        </div>

        <!-- Create Pool Inline Form (Hidden by default) -->
        <form id="createPoolForm" onsubmit="event.preventDefault(); submitCreatePool();" class="hidden p-4 bg-orange-50/60 border border-orange-200 rounded-2xl space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-extrabold text-brand-900 uppercase tracking-wide">New Food Pool Setup</span>
            <button type="button" onclick="hideCreatePoolForm()" class="text-xs text-stone-400 hover:text-stone-700">Cancel</button>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-stone-700 mb-1">Pool Title</label>
            <input type="text" id="poolTitleInput" placeholder="e.g. IIT Delhi Hostel 7 Night Munchies" required class="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-brand-500">
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-[11px] font-bold text-stone-700 mb-1">Community Type</label>
              <select id="poolTypeSelect" class="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-brand-500">
                <option value="STUDENT_HOSTEL">🎓 College Hostel / PG</option>
                <option value="CORPORATE_OFFICE">💼 Office / Tech Park</option>
                <option value="RESIDENTIAL_SOCIETY">🏢 Society / Apartment</option>
                <option value="FRIENDS_COMMUNITY">🍕 Friends Gathering</option>
              </select>
            </div>
            <div>
              <label class="block text-[11px] font-bold text-stone-700 mb-1">Pool Window (Minutes)</label>
              <select id="poolDurationSelect" class="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-brand-500">
                <option value="30">30 Minutes</option>
                <option value="45" selected>45 Minutes</option>
                <option value="60">1 Hour</option>
                <option value="90">1.5 Hours</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-stone-700 mb-1">Delivery Address / Room Number</label>
            <input type="text" id="poolAddressInput" placeholder="e.g. Hostel 7 Common Room, Ground Floor" required class="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-brand-500">
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-[11px] font-bold text-stone-700 mb-1">Your Name (Host)</label>
              <input type="text" id="poolHostNameInput" placeholder="Rahul" required class="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-brand-500">
            </div>
            <div>
              <label class="block text-[11px] font-bold text-stone-700 mb-1">Your WhatsApp Mobile</label>
              <input type="tel" id="poolHostPhoneInput" placeholder="+91 98765 43210" required class="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-brand-500">
            </div>
          </div>
          <button type="submit" class="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-extrabold shadow-md transition-all">Launch Food Pool & Get Share Link</button>
        </form>

        <!-- Live Community Pools List -->
        <div class="space-y-2 pt-2 border-t border-stone-100">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-stone-700 uppercase tracking-wide">Live Active Pools Nearby</span>
            <span class="text-[10px] text-emerald-600 font-extrabold bg-emerald-50 px-2 py-0.5 rounded-full">Real-Time Sync</span>
          </div>
          <div id="activeCommunityPoolsList" class="space-y-2 max-h-56 overflow-y-auto">
            <div class="text-center py-4 text-xs text-stone-400">Loading active pools...</div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', markup);
  if (window.lucide) window.lucide.createIcons();
}

function showCreatePoolForm() {
  const form = document.getElementById('createPoolForm');
  if (form) form.classList.remove('hidden');
}

function hideCreatePoolForm() {
  const form = document.getElementById('createPoolForm');
  if (form) form.classList.add('hidden');
}

async function loadActiveCommunityPools() {
  const container = document.getElementById('activeCommunityPoolsList');
  if (!container) return;

  try {
    const resp = await fetch('/api/group-pools');
    if (!resp.ok) throw new Error('Failed to fetch pools');
    const pools = await resp.json();

    if (!pools || !pools.length) {
      container.innerHTML = `<div class="text-center py-4 text-xs text-stone-400">No active pools nearby. Create one and invite your friends!</div>`;
      return;
    }

    container.innerHTML = pools.map((p) => {
      const minsLeft = Math.ceil((p.seconds_remaining || 0) / 60);
      const tierBadge = p.discount_tier_pct > 0 
        ? `<span class="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded-full">${p.discount_tier_pct}% OFF Active</span>`
        : `<span class="bg-stone-100 text-stone-600 text-[10px] font-bold px-2 py-0.5 rounded-full">Pooling...</span>`;

      return `
        <div class="p-3 bg-white border border-stone-200 rounded-2xl flex items-center justify-between gap-3 hover:border-brand-300 transition-all shadow-xs">
          <div class="space-y-0.5 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-bold text-xs text-stone-900 truncate">${p.title}</span>
              ${tierBadge}
            </div>
            <div class="text-[11px] text-stone-500 flex items-center gap-2">
              <span class="font-mono font-bold text-brand-700 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200">#${p.pool_code}</span>
              <span>•</span>
              <span>${p.members_count} diners</span>
              <span>•</span>
              <span class="text-amber-700 font-bold">⏱ ${minsLeft}m left</span>
            </div>
          </div>
          <button onclick="openPoolRoom('${p.pool_code}')" class="px-3 py-1.5 bg-stone-900 hover:bg-brand-600 text-white rounded-xl text-xs font-bold transition-all flex-shrink-0">
            Join Room
          </button>
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div class="text-center py-3 text-xs text-rose-500">Failed to load pools: ${e.message}</div>`;
  }
}

async function submitCreatePool() {
  const title = document.getElementById('poolTitleInput').value.trim();
  const poolType = document.getElementById('poolTypeSelect').value;
  const duration = parseInt(document.getElementById('poolDurationSelect').value);
  const address = document.getElementById('poolAddressInput').value.trim();
  const hostName = document.getElementById('poolHostNameInput').value.trim();
  const hostPhone = document.getElementById('poolHostPhoneInput').value.trim();

  try {
    const resp = await fetch('/api/group-pools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        pool_type: poolType,
        location_name: "Local Delivery Zone",
        delivery_address: address,
        creator_name: hostName,
        creator_phone: hostPhone,
        duration_minutes: duration
      })
    });

    if (!resp.ok) throw new Error('Failed to create pool');
    const newPool = await resp.json();
    closeGroupHungerModal();
    openPoolRoom(newPool.pool_code);
    if (typeof showToast === 'function') {
      showToast(`🎉 Group Pool #${newPool.pool_code} created! Share the link to unlock discounts!`, 'success');
    }
  } catch (e) {
    alert("Error creating pool: " + e.message);
  }
}

function submitJoinPoolCode() {
  const code = document.getElementById('inputJoinCode').value.trim().toUpperCase();
  if (!code) return;
  closeGroupHungerModal();
  openPoolRoom(code);
}

// ==========================================
// LIVE POOL ROOM DRAWER & PARTICIPANT ACTIONS
// ==========================================
async function openPoolRoom(poolCode) {
  activePoolCode = poolCode;
  let drawer = document.getElementById('groupPoolRoomDrawer');
  if (!drawer) {
    createPoolRoomDrawerMarkup();
    drawer = document.getElementById('groupPoolRoomDrawer');
  }

  drawer.classList.remove('hidden');
  drawer.style.display = 'flex';

  await refreshPoolRoom();

  // Clear any existing poll and start live refresher
  if (poolRefreshTimer) clearInterval(poolRefreshTimer);
  poolRefreshTimer = setInterval(() => refreshPoolRoom(), 6000);
}

function closePoolRoom() {
  if (poolRefreshTimer) clearInterval(poolRefreshTimer);
  const drawer = document.getElementById('groupPoolRoomDrawer');
  if (drawer) {
    drawer.classList.add('hidden');
    drawer.style.display = 'none';
  }
  activePoolCode = null;
}

function createPoolRoomDrawerMarkup() {
  const markup = `
    <div id="groupPoolRoomDrawer" class="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-md flex items-end sm:items-center justify-center p-3 sm:p-4 hidden">
      <div class="w-full max-w-lg bg-white border border-stone-200 rounded-3xl p-5 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
        <!-- Room Header -->
        <div class="flex items-center justify-between pb-3 border-b border-stone-100">
          <div class="space-y-0.5 min-w-0">
            <div class="flex items-center gap-2">
              <span id="roomPoolCodeBadge" class="bg-brand-600 text-white font-mono font-black text-xs px-2.5 py-0.5 rounded-full">#POOL</span>
              <span id="roomCountdownTimer" class="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">⏱ 00:00</span>
            </div>
            <h3 id="roomPoolTitle" class="text-base font-black text-stone-900 truncate">Loading Pool Room...</h3>
          </div>
          <button onclick="closePoolRoom()" class="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-500 flex items-center justify-center text-sm">✕</button>
        </div>

        <!-- Tier Progress Meter -->
        <div class="bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-2">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-stone-700">Pooled Amount: <strong id="roomCurrentAmount" class="font-black text-brand-600">₹0.00</strong></span>
            <span id="roomActiveTierBadge" class="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2.5 py-0.5 rounded-full">0% Unlocked</span>
          </div>

          <!-- Progress Bar -->
          <div class="w-full bg-stone-200 rounded-full h-3 overflow-hidden">
            <div id="roomTierProgressBar" class="bg-gradient-to-r from-amber-500 to-emerald-500 h-full rounded-full transition-all duration-500" style="width: 10%"></div>
          </div>

          <div class="flex items-center justify-between text-[11px] text-stone-500">
            <span id="roomNextTierHint">Add ₹400 more for 10% OFF</span>
            <span class="font-bold text-stone-700">Target: ₹1,500 (25% Mega Saver)</span>
          </div>
        </div>

        <!-- Share Actions -->
        <div class="grid grid-cols-2 gap-2">
          <button onclick="copyPoolShareLink()" class="py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs">
            <i data-lucide="copy" class="w-3.5 h-3.5 text-stone-600"></i>
            <span>Copy Link</span>
          </button>
          <button onclick="sharePoolToWhatsApp()" class="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm">
            <i data-lucide="share-2" class="w-3.5 h-3.5"></i>
            <span>Share on WhatsApp</span>
          </button>
        </div>

        <!-- Participants List -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-stone-700 uppercase tracking-wide">Participants (<span id="roomMemberCount">0</span>)</span>
            <span id="roomPerkNotice" class="text-[10px] text-brand-700 font-bold truncate max-w-[200px]">Free Delivery unlocked</span>
          </div>
          <div id="roomMembersList" class="space-y-2 max-h-48 overflow-y-auto">
            <!-- Populated by JS -->
          </div>
        </div>

        <!-- Tray to Pool Action Buttons -->
        <div class="pt-2 border-t border-stone-100 space-y-2">
          <button id="btnAddTrayToPoolBtn" onclick="addCurrentCartToPool()" class="w-full py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-2xl text-xs font-extrabold shadow-md shadow-brand-500/20 transition-all flex items-center justify-center gap-2">
            <i data-lucide="plus-circle" class="w-4 h-4"></i>
            <span id="btnAddTrayToPoolText">Add My Tray Items to Pool</span>
          </button>

          <button id="btnFinalizePool" onclick="finalizeGroupOrder()" class="w-full py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2">
            <i data-lucide="check-check" class="w-4 h-4 text-emerald-400"></i>
            <span>Lock Pool & Send Batch Order to Kitchen</span>
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', markup);
  if (window.lucide) window.lucide.createIcons();
}

async function refreshPoolRoom() {
  if (!activePoolCode) return;

  try {
    const resp = await fetch(`/api/group-pools/${activePoolCode}`);
    if (!resp.ok) {
      console.warn('Failed to load pool details');
      return;
    }
    const pool = await resp.json();
    renderPoolRoomDetails(pool);
  } catch (e) {
    console.warn('Error refreshing pool room:', e);
  }
}

function renderPoolRoomDetails(pool) {
  document.getElementById('roomPoolCodeBadge').textContent = `#${pool.pool_code}`;
  document.getElementById('roomPoolTitle').textContent = pool.title;
  document.getElementById('roomCurrentAmount').textContent = `₹${pool.current_amount.toFixed(2)}`;
  document.getElementById('roomMemberCount').textContent = pool.members_count;
  document.getElementById('roomActiveTierBadge').textContent = `${pool.discount_tier_pct}% OFF Unlocked`;

  // Countdown timer
  const mins = Math.floor(pool.seconds_remaining / 60);
  const secs = pool.seconds_remaining % 60;
  document.getElementById('roomCountdownTimer').textContent = `⏱ ${mins}:${secs < 10 ? '0' : ''}${secs}`;

  // Progress Bar
  const pct = Math.min(100, Math.max(5, (pool.current_amount / 1500) * 100));
  document.getElementById('roomTierProgressBar').style.width = `${pct}%`;

  // Next tier hint
  const hintEl = document.getElementById('roomNextTierHint');
  if (pool.tier_info.amount_to_next > 0) {
    hintEl.textContent = `Add ₹${pool.tier_info.amount_to_next.toFixed(0)} more for ${pool.tier_info.next_discount_pct}% OFF`;
  } else {
    hintEl.textContent = `🎉 Max 25% Mega Discount Unlocked!`;
  }

  // Perk notice
  document.getElementById('roomPerkNotice').textContent = pool.tier_info.perk;

  // Members list
  const listEl = document.getElementById('roomMembersList');
  if (pool.members && pool.members.length) {
    listEl.innerHTML = pool.members.map((m) => {
      const itemsListStr = (m.items || []).map(i => `${i.name} x${i.quantity}`).join(', ');
      return `
        <div class="p-2.5 bg-stone-50 border border-stone-200/80 rounded-xl flex items-center justify-between gap-2 text-xs">
          <div class="space-y-0.5 min-w-0">
            <span class="font-bold text-stone-900 block truncate">${m.participant_name}</span>
            <span class="text-[11px] text-stone-500 block truncate">${itemsListStr}</span>
          </div>
          <div class="text-right flex-shrink-0">
            <span class="font-extrabold text-stone-900 block">₹${m.final_amount.toFixed(2)}</span>
            <span class="text-[10px] text-emerald-600 font-bold">Saved ₹${m.discount_amount.toFixed(2)}</span>
          </div>
        </div>
      `;
    }).join('');
  } else {
    listEl.innerHTML = `<div class="text-center py-3 text-xs text-stone-400">No diners have joined yet. Be the first!</div>`;
  }

  // Update button state based on cart
  const cart = window.cartItems || [];
  const addBtn = document.getElementById('btnAddTrayToPoolBtn');
  if (addBtn) {
    if (!cart.length) {
      addBtn.classList.add('opacity-70');
      document.getElementById('btnAddTrayToPoolText').textContent = 'Your Tray is Empty (Add food first)';
    } else {
      addBtn.classList.remove('opacity-70');
      document.getElementById('btnAddTrayToPoolText').textContent = `Add My Tray (${cart.length} items) to Pool`;
    }
  }

  // Check if finalized
  if (pool.status === 'FINALIZED') {
    document.getElementById('btnFinalizePool').disabled = true;
    document.getElementById('btnFinalizePool').textContent = `Order Finalized & Sent (Order: ${pool.order_code})`;
    document.getElementById('btnFinalizePool').className = "w-full py-2.5 bg-emerald-700 text-white rounded-2xl text-xs font-bold";
  }
}

async function addCurrentCartToPool() {
  const cart = window.cartItems || [];
  if (!cart.length) {
    alert("Please add some dishes to your tray from the menu first!");
    return;
  }

  const name = prompt("Enter your Name for the pool bill:", "Rohan") || "Friend";
  const phone = prompt("Enter your Mobile Number for order notification:", "+91 98112 34567") || "+91 99999 99999";

  try {
    const resp = await fetch(`/api/group-pools/${activePoolCode}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participant_name: name,
        participant_phone: phone,
        items: cart,
        notes: "Group Hunger order"
      })
    });

    if (!resp.ok) throw new Error('Failed to join pool');
    const updated = await resp.json();

    // Clear local tray since it's merged into the pool!
    if (typeof window.clearCart === 'function') {
      window.clearCart();
    }

    renderPoolRoomDetails(updated);
    if (typeof showToast === 'function') {
      showToast(`🎉 Added your dishes to #${activePoolCode}! Pool discount is now ${updated.discount_tier_pct}%!`, 'success');
    }
  } catch (e) {
    alert("Error adding to pool: " + e.message);
  }
}

function copyPoolShareLink() {
  if (!activePoolCode) return;
  const url = `${window.location.origin}/?pool=${activePoolCode}`;
  navigator.clipboard.writeText(url).then(() => {
    if (typeof showToast === 'function') {
      showToast(`📋 Copied Pool Link: ${url}`, 'success');
    } else {
      alert("Copied link: " + url);
    }
  });
}

function sharePoolToWhatsApp() {
  if (!activePoolCode) return;
  const url = `${window.location.origin}/?pool=${activePoolCode}`;
  const text = encodeURIComponent(`Hey friends! 👋 I just created a food order pool on RasoiLink for our hostel/office. Join in with this link so we unlock 25% OFF group discount together!\n\n👉 Join Pool: ${url}`);
  window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
}

async function finalizeGroupOrder() {
  if (!activePoolCode) return;
  if (!confirm("Are you sure you want to close this pool and submit the consolidated order to the kitchen?")) {
    return;
  }

  try {
    const resp = await fetch(`/api/group-pools/${activePoolCode}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: "Consolidated group batch" })
    });

    if (!resp.ok) throw new Error('Failed to finalize pool');
    const result = await resp.json();
    renderPoolRoomDetails(result);
    if (typeof showToast === 'function') {
      showToast(`🎉 Batch Order ${result.generated_order_code} dispatched to kitchen!`, 'success');
    }
  } catch (e) {
    alert("Error: " + e.message);
  }
}

// Check pool code in query string on page load
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(checkUrlForGroupPool, 600);
});
