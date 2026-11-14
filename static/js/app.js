/**
 * RasoiLink Customer Storefront Logic
 * Mobile-First, Zero-Build Vanilla JavaScript with Tailwind CSS
 */

// Application State
const State = {
  menuCategories: [],
  menuItems: [],
  cart: [], // [{ id, name, price, quantity, notes, veg }]
  orderMode: 'DINE_IN', // 'DINE_IN', 'TAKEAWAY', 'DELIVERY'
  timingMode: 'NOW', // 'NOW', 'SCHEDULED'
  tableNumber: '5',
  partySize: 2,
  deliveryAddress: '',
  deliveryLandmark: '',
  isScheduled: false,
  selectedDate: '',
  selectedSlot: '',
  availableSlots: [],
  appliedCoupon: null, // { code, discount_amount }
  activeCategory: 'all',
  quickFilter: 'all', // 'all', 'bestseller', 'veg', 'budget', 'spicy', 'sweet'
  searchQuery: '',
  tipAmount: 0.0,
  activeOrder: null,
  statusPollTimer: null,
  activeModalDish: null,
  modalDishQty: 1,
  storeSettings: null,
  selectedRestaurantId: localStorage.getItem('rasoi_selected_restaurant') || 'cp-artisan',
  restaurants: [],
  favorites: new Set(JSON.parse(localStorage.getItem('rasoi_favorites') || '[]'))
};

// DOM Ready Initialization
document.addEventListener('DOMContentLoaded', () => {
  initURLParams();
  loadMenuData();
  loadStoreSettings();
  loadRestaurants();
  setupEventListeners();
  initDateOptions();
  checkStorefrontAdminStatus();
  checkSavedProfile();
  initLiveOrderTracker();
});

// Load Dynamic Store Profile & Location Settings
async function loadStoreSettings() {
  try {
    const res = await fetch('/api/store/settings');
    if (!res.ok) return;
    const data = await res.json();
    const st = data.settings;
    if (!st) return;

    State.storeSettings = st;

    const elTitle = document.getElementById('storeTitle');
    const elTagline = document.getElementById('storeTagline');
    const elDesc = document.getElementById('storeDescription');
    const elLocName = document.getElementById('storeLocationName');
    const elHours = document.getElementById('storeHours');
    const elRating = document.getElementById('storeRating');
    const elAnnounce = document.getElementById('storeAnnouncementText');
    const elAnnounceBox = document.getElementById('storeAnnouncementBanner');

    if (elTitle && st.store_name) elTitle.textContent = st.store_name;
    if (elTagline && st.tagline) elTagline.textContent = st.tagline;
    if (elDesc && st.description) elDesc.textContent = st.description;
    if (elLocName && st.location_name) elLocName.textContent = st.location_name;
    if (elHours && st.opening_hours) elHours.textContent = st.opening_hours;
    if (elRating && st.rating) elRating.textContent = `${st.rating} (${st.reviews_count || '1,240'}+ reviews)`;
    if (elAnnounce && st.announcement) {
      elAnnounce.textContent = st.announcement;
      if (elAnnounceBox) elAnnounceBox.classList.remove('hidden');
    } else if (elAnnounceBox) {
      elAnnounceBox.classList.add('hidden');
    }

    if (window.loadSafeKitchenData) {
      window.loadSafeKitchenData(State.selectedRestaurantId || 'cp-artisan');
    }
  } catch (err) {
    console.error('Failed to load store settings:', err);
  }
}

// User Local Location Detection (HTML5 Geolocation)
function detectUserLocation() {
  const quickInput = document.getElementById('quickDeliveryAddress');
  const cartInput = document.getElementById('inputDeliveryAddress');

  if (!navigator.geolocation) {
    const fallback = 'Connaught Place, Inner Circle, New Delhi';
    if (quickInput) quickInput.value = fallback;
    if (cartInput) cartInput.value = fallback;
    State.deliveryAddress = fallback;
    showToast('Location set to local Connaught Place neighborhood');
    return;
  }

  showToast('Detecting your current location...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude.toFixed(4);
      const lng = pos.coords.longitude.toFixed(4);
      const locStr = `Current Location (${lat}, ${lng}) • Connaught Place Sector`;
      if (quickInput) quickInput.value = locStr;
      if (cartInput) cartInput.value = locStr;
      State.deliveryAddress = locStr;
      showToast('Current GPS coordinates detected for delivery');
    },
    (err) => {
      const defaultLoc = 'Connaught Place, Inner Circle, New Delhi';
      if (quickInput) quickInput.value = defaultLoc;
      if (cartInput) cartInput.value = defaultLoc;
      State.deliveryAddress = defaultLoc;
      showToast('Local area set: Connaught Place, New Delhi');
    },
    { timeout: 7000, enableHighAccuracy: true }
  );
}

function setQuickLocalAddress(addr) {
  const quickInput = document.getElementById('quickDeliveryAddress');
  const cartInput = document.getElementById('inputDeliveryAddress');
  if (quickInput) quickInput.value = addr;
  if (cartInput) cartInput.value = addr;
  State.deliveryAddress = addr;
  showToast(`Selected: ${addr}`);
}

// 1. Detect QR Table Parameter (e.g. /?table=5)
function initURLParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const tableParam = urlParams.get('table');
  const modeParam = urlParams.get('mode');

  if (tableParam) {
    State.tableNumber = tableParam.trim();
    State.orderMode = 'DINE_IN';
    const banner = document.getElementById('tableBanner');
    const tableBadge = document.getElementById('tableBannerBadge');
    if (banner && tableBadge) {
      tableBadge.textContent = `Table #${State.tableNumber}`;
      banner.classList.remove('hidden');
      banner.classList.add('flex');
    }
    const inputTable = document.getElementById('inputTableNumber');
    if (inputTable) {
      inputTable.value = State.tableNumber;
    }
    setOrderMode('DINE_IN');
  } else if (modeParam && ['TAKEAWAY', 'DELIVERY'].includes(modeParam.toUpperCase())) {
    setOrderMode(modeParam.toUpperCase());
  } else {
    setOrderMode('DINE_IN');
  }
}

// 2. Fetch Menu & Seed Categories
async function loadMenuData() {
  try {
    const res = await fetch('/api/menu');
    const data = await res.json();
    State.menuCategories = data.categories || [];
    State.menuItems = data.items || [];
    window.menuItemsList = State.menuItems;
    window.allCategoriesList = State.menuCategories;
    window.allMenuItems = State.menuItems;

    renderCategoryPills();
    renderMenuItems();
  } catch (err) {
    console.error('Failed to load menu:', err);
    showToast('Failed to load menu items. Retrying...');
  }
}

// 3. Render Category Tabs with Tailwind
function renderCategoryPills() {
  const nav = document.getElementById('categoriesNav');
  if (!nav) return;

  let html = `<button class="flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm active:scale-95 ${State.activeCategory === 'all' ? 'bg-brand-600 text-white' : 'bg-white border border-stone-200 text-stone-700 hover:border-brand-500'}" onclick="filterCategory('all', this)">All Items</button>`;
  State.menuCategories.forEach(cat => {
    const isActive = State.activeCategory === cat.id;
    html += `<button class="flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm active:scale-95 ${isActive ? 'bg-brand-600 text-white' : 'bg-white border border-stone-200 text-stone-700 hover:border-brand-500'}" onclick="filterCategory(${cat.id}, this)">${cat.name}</button>`;
  });
  nav.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

// 4. Render Menu Items with Tailwind Glassmorphic Cards (Mobile Touch Optimized)
function renderMenuItems() {
  const container = document.getElementById('menuContainer');
  if (!container) return;

  const query = State.searchQuery.toLowerCase().trim();
  let filtered = State.menuItems.filter(item => {
    if (State.activeCategory !== 'all' && item.category_id !== State.activeCategory) return false;

    if (State.quickFilter === 'veg' && !item.veg) return false;
    if (State.quickFilter === 'non-veg' && item.veg) return false;
    if (State.quickFilter === 'mild' && item.spice_level !== 'Mild') return false;
    if (State.quickFilter === 'spicy' && item.spice_level !== 'Spicy') return false;
    if (State.quickFilter === 'budget' && item.price >= 100) return false;
    if (State.quickFilter === 'sweet' && item.category_id !== 5) return false;
    if (State.quickFilter === 'bestseller' && !item.is_bestseller) return false;
    if (State.quickFilter === 'favorites' && !State.favorites.has(item.id)) return false;

    if (query) {
      const matchName = item.name.toLowerCase().includes(query);
      const matchDesc = item.description ? item.description.toLowerCase().includes(query) : false;
      if (!matchName && !matchDesc) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 px-4 bg-white rounded-3xl border border-stone-200/80 shadow-sm space-y-2">
        <div class="w-12 h-12 rounded-full bg-stone-100 text-stone-500 flex items-center justify-center mx-auto mb-2 font-mono text-sm font-bold">404</div>
        <div class="font-extrabold text-stone-900 text-base">No dishes found matching your filter</div>
        <p class="text-xs text-stone-500 font-medium">Try searching for chai, pav bhaji, or parathas</p>
        <button class="mt-3 px-4 py-2 bg-stone-900 text-white text-xs font-bold rounded-full shadow-sm active:scale-95" onclick="applyQuickFilter('all')">Reset Filters</button>
      </div>
    `;
    return;
  }

  const groups = {};
  filtered.forEach(item => {
    if (!groups[item.category_id]) groups[item.category_id] = [];
    groups[item.category_id].push(item);
  });

  let html = '';
  State.menuCategories.forEach(cat => {
    if (!groups[cat.id]) return;
    html += `
      <section class="space-y-3" id="cat-${cat.id}">
        <h3 class="text-base sm:text-lg font-extrabold text-stone-900 flex items-center gap-2">
          <span>${cat.name}</span>
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    `;

    groups[cat.id].forEach(item => {
      const cartItem = State.cart.find(c => c.id === item.id);
      const inCartQty = cartItem ? cartItem.quantity : 0;
      const isAvailable = Boolean(item.is_available);
      const isBestseller = Boolean(item.is_bestseller);

      html += `
        <div class="bg-white rounded-2xl border border-stone-200/90 p-3 sm:p-3.5 flex gap-3 shadow-sm hover:shadow-md hover:border-brand-300 transition-all duration-200 group relative ${!isAvailable ? 'opacity-60 grayscale-[20%]' : ''}">
          <div class="flex-1 flex flex-col cursor-pointer" onclick="openDishModal(${item.id})">
            <div class="flex items-center gap-2 mb-1">
              <span class="diet-icon ${item.veg ? 'veg' : 'non-veg'}"></span>
              <span class="text-[11px] font-semibold text-stone-500">${getSpiceLabel(item.spice_level)}</span>
              ${isBestseller ? '<span class="text-[9px] font-extrabold text-amber-800 bg-amber-100/90 border border-amber-300/60 px-2 py-0.5 rounded-full uppercase tracking-wider">Bestseller</span>' : ''}
              ${!isAvailable ? '<span class="text-[9px] font-extrabold text-red-700 bg-red-100 border border-red-300/60 px-2 py-0.5 rounded-full uppercase tracking-wider">Sold Out</span>' : ''}
            </div>
            <h4 class="text-sm sm:text-base font-extrabold text-stone-900 group-hover:text-brand-600 transition-colors line-clamp-1">${item.name}</h4>
            <p class="text-xs text-stone-500 font-medium line-clamp-2 mt-0.5 leading-relaxed">${item.description || ''}</p>
            <div class="mt-auto pt-2 flex items-center justify-between">
              <span class="text-base font-extrabold text-brand-700">₹${item.price}</span>
              <span class="text-[10px] font-semibold text-stone-400">~${item.prep_time_minutes || 12}m • ${item.calories || 250} kcal</span>
            </div>
          </div>
          <div class="relative w-24 h-24 sm:w-28 sm:h-28 flex-shrink-0">
            <img src="${item.image_url}" alt="${item.name}" class="w-full h-full object-cover rounded-xl bg-stone-100 cursor-pointer shadow-sm" loading="lazy" onclick="openDishModal(${item.id})" onerror="this.src='https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=60'">
            <button onclick="toggleFavorite(${item.id}, event)" class="absolute top-1.5 right-1.5 w-7 h-7 sm:w-6 sm:h-6 rounded-full bg-white/95 backdrop-blur-sm shadow flex items-center justify-center transition-all hover:scale-110 active:scale-90" title="Bookmark favorite">
              <i data-lucide="heart" class="w-3.5 h-3.5 ${State.favorites.has(item.id) ? 'text-rose-500 fill-rose-500' : 'text-stone-400'}"></i>
            </button>
            ${
              !isAvailable
                ? `<button class="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-stone-200 text-stone-500 text-[10px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap shadow cursor-not-allowed" disabled>OUT OF STOCK</button>`
                : inCartQty > 0
                ? `
                  <div class="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-brand-600 text-white font-extrabold text-xs px-2.5 py-1 rounded-full flex items-center gap-2 shadow-md">
                    <button class="w-6 h-6 flex items-center justify-center font-black active:scale-75 text-sm" onclick="updateItemQuantity(${item.id}, -1); event.stopPropagation();" aria-label="Decrease quantity">−</button>
                    <span class="min-w-[16px] text-center font-black text-xs">${inCartQty}</span>
                    <button class="w-6 h-6 flex items-center justify-center font-black active:scale-75 text-sm" onclick="updateItemQuantity(${item.id}, 1); event.stopPropagation();" aria-label="Increase quantity">+</button>
                  </div>
                `
                : `<button class="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-white hover:bg-brand-600 text-brand-600 hover:text-white border-2 border-brand-500 font-extrabold text-xs px-4 py-1 rounded-full shadow-md transition-all whitespace-nowrap active:scale-95" onclick="addItemToCart(${item.id}); event.stopPropagation();">ADD +</button>`
            }
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </section>
    `;
  });

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function getSpiceLabel(level) {
  if (level === 'Spicy') return 'Spicy';
  if (level === 'Medium') return 'Medium';
  return 'Mild';
}

// 5. Category and Quick Filters
function filterCategory(catId, btnEl) {
  State.activeCategory = catId;
  renderCategoryPills();
  renderMenuItems();

  // Smoothly center the active category tab in the horizontal scroll bar on mobile
  setTimeout(() => {
    const activeBtn = document.querySelector('#categoriesNav button.bg-brand-600');
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, 40);
}

function applyQuickFilter(filter) {
  State.quickFilter = filter;
  document.querySelectorAll('.quick-chip-pill').forEach(btn => {
    if (btn.dataset.filter === filter) {
      btn.className = 'quick-chip-pill flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all bg-stone-900 text-white shadow-sm';
    } else {
      btn.className = 'quick-chip-pill flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all bg-white border border-stone-200 text-stone-600 hover:border-brand-500';
    }
  });
  renderMenuItems();
}

function handleSearchInput(val) {
  State.searchQuery = val;
  const clearBtn = document.getElementById('searchClearBtn');
  if (clearBtn) {
    if (val) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }
  renderMenuItems();
}

function clearSearch() {
  State.searchQuery = '';
  const input = document.getElementById('searchInput');
  if (input) input.value = '';
  const clearBtn = document.getElementById('searchClearBtn');
  if (clearBtn) clearBtn.classList.add('hidden');
  renderMenuItems();
}

// 6. Interactive Dish Modal (Quick View)
function openDishModal(itemId) {
  const item = State.menuItems.find(i => i.id === itemId);
  if (!item) return;

  State.activeModalDish = item;
  State.modalDishQty = 1;

  document.getElementById('dishModalImg').src = item.image_url;
  document.getElementById('dishModalTitle').textContent = item.name;
  document.getElementById('dishModalPrice').textContent = `₹${item.price}`;
  document.getElementById('dishModalDesc').textContent = item.description || '';
  document.getElementById('dishModalPrep').textContent = `~${item.prep_time_minutes || 12} min`;
  document.getElementById('dishModalSpice').textContent = getSpiceLabel(item.spice_level);

  const calEl = document.getElementById('dishModalCalories');
  if (calEl) calEl.textContent = `~${item.calories || 250} kcal`;

  const algEl = document.getElementById('dishModalAllergens');
  if (algEl) algEl.textContent = item.allergens || 'None';

  const dietEl = document.getElementById('dishModalDiet');
  if (dietEl) {
    dietEl.className = `diet-icon ${item.veg ? 'veg' : 'non-veg'}`;
  }

  document.getElementById('dishModalQty').textContent = '1';
  document.getElementById('dishModalNote').value = '';
  updateModalPriceButton();

  const backdrop = document.getElementById('modalBackdrop');
  const modal = document.getElementById('dishModal');
  if (backdrop && modal) {
    backdrop.classList.remove('opacity-0', 'pointer-events-none');
    backdrop.classList.add('opacity-100', 'pointer-events-auto');
    modal.classList.remove('translate-y-full');
    modal.classList.add('translate-y-0');
  }
}

function closeDishModal() {
  const backdrop = document.getElementById('modalBackdrop');
  const modal = document.getElementById('dishModal');
  if (modal) {
    modal.classList.add('translate-y-full');
    modal.classList.remove('translate-y-0');
  }
  checkCloseBackdrop();
  State.activeModalDish = null;
}

function adjustModalQty(delta) {
  State.modalDishQty = Math.max(1, State.modalDishQty + delta);
  document.getElementById('dishModalQty').textContent = State.modalDishQty;
  updateModalPriceButton();
}

function updateModalPriceButton() {
  if (!State.activeModalDish) return;
  const total = State.activeModalDish.price * State.modalDishQty;
  document.getElementById('dishModalBtnPrice').textContent = `₹${total}`;
}

function confirmModalAddToCart() {
  if (!State.activeModalDish) return;
  const note = document.getElementById('dishModalNote').value.trim();
  addItemToCart(State.activeModalDish.id, State.modalDishQty, note);
  closeDishModal();
}

// 7. Dedicated Channels (Dine-In, Takeaway, Delivery) & Channel Scheduling
function setOrderMode(mode) {
  State.orderMode = mode;

  // 1. Update Primary Channel Selection Cards
  const btnDine = document.getElementById('channelBtnDineIn');
  const btnTake = document.getElementById('channelBtnTakeaway');
  const btnDeli = document.getElementById('channelBtnDelivery');

  const cards = [
    { el: btnDine, key: 'DINE_IN', activeBorder: 'border-brand-500 ring-2 ring-brand-500/20', dotActive: 'bg-emerald-500' },
    { el: btnTake, key: 'TAKEAWAY', activeBorder: 'border-sky-500 ring-2 ring-sky-500/20', dotActive: 'bg-sky-500' },
    { el: btnDeli, key: 'DELIVERY', activeBorder: 'border-purple-500 ring-2 ring-purple-500/20', dotActive: 'bg-purple-500' }
  ];

  cards.forEach(c => {
    if (!c.el) return;
    const dot = c.el.querySelector('.channel-dot');
    if (c.key === mode) {
      c.el.className = `channel-card p-3 rounded-2xl border-2 bg-white text-left shadow-sm transition-all flex flex-col justify-between active ${c.activeBorder}`;
      if (dot) dot.className = `channel-dot w-2 h-2 rounded-full ${c.dotActive}`;
    } else {
      c.el.className = 'channel-card p-3 rounded-2xl border-2 border-stone-200 bg-white hover:border-stone-300 text-left shadow-sm transition-all flex flex-col justify-between';
      if (dot) dot.className = 'channel-dot w-2 h-2 rounded-full bg-slate-300';
    }
  });

  // 2. Show dedicated channel configuration panel
  const panelDine = document.getElementById('channelPanelDineIn');
  const panelTake = document.getElementById('channelPanelTakeaway');
  const panelDeli = document.getElementById('channelPanelDelivery');

  if (panelDine) panelDine.classList.toggle('hidden', mode !== 'DINE_IN');
  if (panelTake) panelTake.classList.toggle('hidden', mode !== 'TAKEAWAY');
  if (panelDeli) panelDeli.classList.toggle('hidden', mode !== 'DELIVERY');

  // 3. Update Cart Drawer fields
  const dineInFields = document.getElementById('dineInFields');
  const takeawayFields = document.getElementById('takeawayFields');
  const deliveryFields = document.getElementById('deliveryFields');
  if (dineInFields) dineInFields.classList.toggle('hidden', mode !== 'DINE_IN');
  if (takeawayFields) takeawayFields.classList.toggle('hidden', mode !== 'TAKEAWAY');
  if (deliveryFields) deliveryFields.classList.toggle('hidden', mode !== 'DELIVERY');

  // 4. Update Header on Advance Slot Picker
  const slotHeader = document.getElementById('slotPickerHeader');
  if (slotHeader) {
    if (mode === 'DINE_IN') slotHeader.textContent = 'Select Table Reservation Arrival Slot:';
    else if (mode === 'TAKEAWAY') slotHeader.textContent = 'Select Express Counter Pickup Slot:';
    else if (mode === 'DELIVERY') slotHeader.textContent = 'Select Doorstep Delivery Window:';
  }

  // Sync timing view
  syncChannelTimingUI();
  updateCartSummary();
}

function setChannelTiming(timing) {
  State.timingMode = timing;
  State.isScheduled = (timing === 'SCHEDULED');

  syncChannelTimingUI();

  const slotSection = document.getElementById('slotPickerSection');
  if (State.isScheduled) {
    if (slotSection) slotSection.classList.remove('hidden');
    if (!State.selectedDate) {
      selectDate(getTodayDateStr());
    }
    const modeName = State.orderMode === 'DINE_IN' ? 'Table Reservation' : State.orderMode === 'TAKEAWAY' ? 'Takeaway Pickup' : 'Delivery Window';
    showToast(`Scheduling ${modeName}. Please select your date and 30-min slot.`);
  } else {
    if (slotSection) slotSection.classList.add('hidden');
    State.selectedDate = '';
    State.selectedSlot = '';
  }

  updateCartSummary();
}

function syncChannelTimingUI() {
  const isSched = State.timingMode === 'SCHEDULED';

  // Dine-in buttons
  const btnDineNow = document.getElementById('btnDineInNow');
  const btnDineSched = document.getElementById('btnDineInSchedule');
  const dineNowView = document.getElementById('dineInImmediateView');
  const dineSchedView = document.getElementById('dineInScheduledView');

  if (btnDineNow && btnDineSched) {
    if (isSched) {
      btnDineNow.className = 'py-2 px-3 rounded-xl text-xs font-bold transition-all text-stone-600 hover:text-stone-900 flex items-center justify-center gap-1.5';
      btnDineSched.className = 'py-2 px-3 rounded-xl text-xs font-bold transition-all bg-brand-600 text-white shadow-sm flex items-center justify-center gap-1.5';
      if (dineNowView) dineNowView.classList.add('hidden');
      if (dineSchedView) dineSchedView.classList.remove('hidden');
    } else {
      btnDineNow.className = 'py-2 px-3 rounded-xl text-xs font-bold transition-all bg-brand-600 text-white shadow-sm flex items-center justify-center gap-1.5';
      btnDineSched.className = 'py-2 px-3 rounded-xl text-xs font-bold transition-all text-stone-600 hover:text-stone-900 flex items-center justify-center gap-1.5';
      if (dineNowView) dineNowView.classList.remove('hidden');
      if (dineSchedView) dineSchedView.classList.add('hidden');
    }
  }

  // Takeaway buttons
  const btnTakeNow = document.getElementById('btnTakeawayNow');
  const btnTakeSched = document.getElementById('btnTakeawaySchedule');
  const takeNowView = document.getElementById('takeawayImmediateView');
  const takeSchedView = document.getElementById('takeawayScheduledView');

  if (btnTakeNow && btnTakeSched) {
    if (isSched) {
      btnTakeNow.className = 'py-2 px-3 rounded-xl text-xs font-bold transition-all text-stone-600 hover:text-stone-900 flex items-center justify-center gap-1.5';
      btnTakeSched.className = 'py-2 px-3 rounded-xl text-xs font-bold transition-all bg-sky-600 text-white shadow-sm flex items-center justify-center gap-1.5';
      if (takeNowView) takeNowView.classList.add('hidden');
      if (takeSchedView) takeSchedView.classList.remove('hidden');
    } else {
      btnTakeNow.className = 'py-2 px-3 rounded-xl text-xs font-bold transition-all bg-sky-600 text-white shadow-sm flex items-center justify-center gap-1.5';
      btnTakeSched.className = 'py-2 px-3 rounded-xl text-xs font-bold transition-all text-stone-600 hover:text-stone-900 flex items-center justify-center gap-1.5';
      if (takeNowView) takeNowView.classList.remove('hidden');
      if (takeSchedView) takeSchedView.classList.add('hidden');
    }
  }

  // Delivery buttons
  const btnDeliNow = document.getElementById('btnDeliveryNow');
  const btnDeliSched = document.getElementById('btnDeliverySchedule');
  const deliSchedView = document.getElementById('deliveryScheduledView');

  if (btnDeliNow && btnDeliSched) {
    if (isSched) {
      btnDeliNow.className = 'py-2 px-3 rounded-xl text-xs font-bold transition-all text-stone-600 hover:text-stone-900 flex items-center justify-center gap-1.5';
      btnDeliSched.className = 'py-2 px-3 rounded-xl text-xs font-bold transition-all bg-purple-600 text-white shadow-sm flex items-center justify-center gap-1.5';
      if (deliSchedView) deliSchedView.classList.remove('hidden');
    } else {
      btnDeliNow.className = 'py-2 px-3 rounded-xl text-xs font-bold transition-all bg-purple-600 text-white shadow-sm flex items-center justify-center gap-1.5';
      btnDeliSched.className = 'py-2 px-3 rounded-xl text-xs font-bold transition-all text-stone-600 hover:text-stone-900 flex items-center justify-center gap-1.5';
      if (deliSchedView) deliSchedView.classList.add('hidden');
    }
  }
}

function selectTableNumber(num) {
  State.tableNumber = num;
  const input = document.getElementById('inputTableNumber');
  if (input) input.value = num;

  document.querySelectorAll('.table-chip').forEach(btn => {
    if (btn.textContent.trim() === num) {
      btn.className = 'table-chip py-1.5 rounded-xl border-2 border-brand-500 bg-brand-50 text-xs font-black text-brand-700';
    } else {
      btn.className = 'table-chip py-1.5 rounded-xl border border-stone-200 bg-stone-50 text-xs font-bold text-stone-700 hover:border-brand-500';
    }
  });
  updateCartSummary();
}

function setPartySize(size) {
  State.partySize = parseInt(size, 10);
  const sel = document.getElementById('inputPartySize');
  if (sel) sel.value = size.toString();

  document.querySelectorAll('.party-size-chip').forEach(btn => {
    const isThis = (size === 1 && btn.textContent.includes('1')) ||
                   (size === 2 && btn.textContent.includes('2')) ||
                   (size === 4 && btn.textContent.includes('4')) ||
                   (size >= 6 && btn.textContent.includes('6'));
    if (isThis) {
      btn.className = 'party-size-chip py-1.5 rounded-xl border-2 border-brand-500 bg-brand-50 text-xs font-black text-brand-700';
    } else {
      btn.className = 'party-size-chip py-1.5 rounded-xl border border-stone-200 bg-stone-50 text-xs font-bold text-stone-700 hover:border-brand-500';
    }
  });
  updateCartSummary();
}

function syncDeliveryAddress(addr) {
  State.deliveryAddress = addr;
  const input = document.getElementById('inputDeliveryAddress');
  if (input) input.value = addr;
}

function setScheduleMode(isSched) {
  setChannelTiming(isSched ? 'SCHEDULED' : 'NOW');
}

function formatLocalDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getTodayDateStr() {
  return formatLocalDate(new Date());
}

function initDateOptions() {
  const dateList = document.getElementById('slotDatesList');
  if (!dateList) return;

  const today = new Date();
  let html = '';
  for (let i = 0; i < 4; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = formatLocalDate(d);
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    html += `
      <button class="date-pill flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm ${i === 0 ? 'bg-brand-600 text-white' : 'bg-white border border-stone-200 text-stone-700 hover:border-brand-500'}" data-date="${dateStr}" onclick="selectDate('${dateStr}')">
        ${label}
      </button>
    `;
  }
  dateList.innerHTML = html;
}

async function selectDate(dateStr) {
  State.selectedDate = dateStr;
  document.querySelectorAll('.date-pill').forEach(btn => {
    if (btn.dataset.date === dateStr) {
      btn.className = 'date-pill flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm bg-brand-600 text-white';
    } else {
      btn.className = 'date-pill flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm bg-white border border-stone-200 text-stone-700 hover:border-brand-500';
    }
  });

  try {
    const res = await fetch(`/api/slots?date=${dateStr}`);
    const data = await res.json();
    State.availableSlots = data.slots || [];
    renderSlots();
  } catch (err) {
    console.error('Error fetching slots:', err);
  }
}

function renderSlots() {
  const grid = document.getElementById('slotsGrid');
  if (!grid) return;

  let html = '';
  State.availableSlots.forEach(s => {
    const isFull = s.is_full;
    const isSelected = State.selectedSlot === s.slot_time;
    html += `
      <div class="border rounded-xl p-2.5 text-center text-xs font-bold transition-all cursor-pointer flex flex-col gap-0.5 ${
        isFull
          ? 'opacity-40 bg-stone-100 border-dashed border-stone-300 cursor-not-allowed text-stone-400'
          : isSelected
          ? 'bg-orange-50 border-brand-500 text-brand-900 shadow-sm'
          : 'bg-white border-stone-200 text-stone-700 hover:border-brand-400'
      }" onclick="${isFull ? '' : `chooseSlot('${s.slot_time}')`}">
        <span>${s.slot_time}</span>
        <span class="text-[10px] font-black ${isFull ? 'text-red-500' : 'text-emerald-600'}">${isFull ? 'CAPACITY FULL' : `${s.remaining_capacity}/${s.max_capacity} left`}</span>
      </div>
    `;
  });
  grid.innerHTML = html;
}

function chooseSlot(slotTime) {
  State.selectedSlot = slotTime;
  renderSlots();
  updateCartSummary();
  showToast(`Selected scheduled slot: ${slotTime}`);
}

// 8. Cart State & Tray Operations
function addItemToCart(itemId, qty = 1, notes = '', customPrice = null) {
  const item = State.menuItems.find(i => i.id === itemId);
  if (!item) return;
  if (!item.is_available) {
    showToast(`Sorry, ${item.name} is out of stock!`);
    return;
  }

  const finalPrice = (customPrice !== null && customPrice > 0) ? customPrice : item.price;
  const existing = State.cart.find(c => c.id === itemId);
  if (existing) {
    existing.quantity += qty;
    if (notes) existing.notes = notes;
    if (customPrice !== null) existing.price = finalPrice;
  } else {
    State.cart.push({
      id: item.id,
      name: item.name,
      price: finalPrice,
      quantity: qty,
      notes: notes,
      veg: item.veg
    });
  }

  window.cartItems = State.cart;
  renderMenuItems();
  updateCartSummary();
  showToast(`Added ${qty}x ${item.name} to tray`);
}

window.addToCart = (id, q = 1, p = null) => addItemToCart(id, q, '', p);
window.clearCart = () => {
  State.cart = [];
  window.cartItems = [];
  updateCartSummary();
  renderMenuItems();
};

function updateItemQuantity(itemId, change) {
  const idx = State.cart.findIndex(c => c.id === itemId);
  if (idx === -1) return;

  State.cart[idx].quantity += change;
  if (State.cart[idx].quantity <= 0) {
    State.cart.splice(idx, 1);
  }

  renderMenuItems();
  updateCartSummary();
  renderCartDrawerItems();
}

function selectTipAmount(amt) {
  State.tipAmount = parseFloat(amt);
  document.querySelectorAll('.tip-pill').forEach(btn => {
    if (parseFloat(btn.dataset.tip) === State.tipAmount) {
      btn.className = 'tip-pill py-1.5 rounded-xl border border-brand-500 bg-amber-50 text-xs font-bold text-brand-700';
    } else {
      btn.className = 'tip-pill py-1.5 rounded-xl border border-stone-200 bg-white text-xs font-bold text-stone-700';
    }
  });
  updateCartSummary();
}

function updateCartSummary() {
  const totalCount = State.cart.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = State.cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);

  const bottomBar = document.getElementById('bottomCartBar');
  const countBadge = document.getElementById('cartBadgeCount');
  const totalText = document.getElementById('cartBarTotal');
  const mobCartBadge = document.getElementById('mobileNavCartBadge');

  if (mobCartBadge) {
    if (totalCount > 0) {
      mobCartBadge.textContent = totalCount;
      mobCartBadge.classList.remove('hidden');
    } else {
      mobCartBadge.classList.add('hidden');
    }
  }

  if (bottomBar && countBadge && totalText) {
    if (totalCount > 0) {
      bottomBar.classList.remove('translate-y-36', 'translate-y-32');
      bottomBar.classList.add('translate-y-0');
      countBadge.textContent = `${totalCount} item${totalCount > 1 ? 's' : ''}`;
      totalText.textContent = `₹${subtotal + State.tipAmount}`;
    } else {
      bottomBar.classList.add('translate-y-36');
      bottomBar.classList.remove('translate-y-0');
    }
  }

  updateDrawerBillBreakdown(subtotal);
}

function updateDrawerBillBreakdown(subtotal) {
  const elSubtotal = document.getElementById('billSubtotal');
  const elDiscount = document.getElementById('billDiscount');
  const elDiscountRow = document.getElementById('billDiscountRow');
  const elDelivery = document.getElementById('billDelivery');
  const elDeliveryRow = document.getElementById('billDeliveryRow');
  const elTip = document.getElementById('billTip');
  const elTipRow = document.getElementById('billTipRow');
  const elGrandTotal = document.getElementById('billGrandTotal');

  const deliveryFee = State.orderMode === 'DELIVERY' ? 30 : 0;
  let discountAmount = 0;
  if (State.appliedCoupon) {
    discountAmount = State.appliedCoupon.discount_amount || 0;
  }

  const grandTotal = Math.max(0, subtotal - discountAmount) + deliveryFee + State.tipAmount;

  if (elSubtotal) elSubtotal.textContent = `₹${subtotal.toFixed(2)}`;
  if (elDiscountRow && elDiscount) {
    if (discountAmount > 0) {
      elDiscountRow.classList.remove('hidden');
      elDiscountRow.classList.add('flex');
      elDiscount.textContent = `-₹${discountAmount.toFixed(2)}`;
    } else {
      elDiscountRow.classList.add('hidden');
      elDiscountRow.classList.remove('flex');
    }
  }
  if (elDeliveryRow && elDelivery) {
    if (deliveryFee > 0) {
      elDeliveryRow.classList.remove('hidden');
      elDeliveryRow.classList.add('flex');
      elDelivery.textContent = `+₹${deliveryFee.toFixed(2)}`;
    } else {
      elDeliveryRow.classList.add('hidden');
      elDeliveryRow.classList.remove('flex');
    }
  }
  if (elTipRow && elTip) {
    if (State.tipAmount > 0) {
      elTipRow.classList.remove('hidden');
      elTipRow.classList.add('flex');
      elTip.textContent = `+₹${State.tipAmount.toFixed(2)}`;
    } else {
      elTipRow.classList.add('hidden');
      elTipRow.classList.remove('flex');
    }
  }
  if (elGrandTotal) elGrandTotal.textContent = `₹${grandTotal.toFixed(2)}`;

  // Update Cart Channel context
  const chTitle = document.getElementById('cartChannelTitle');
  const chTiming = document.getElementById('cartChannelTiming');
  const chIcon = document.getElementById('cartChannelIcon');

  if (chTitle && chTiming) {
    const isSched = State.timingMode === 'SCHEDULED';
    const schedTime = State.selectedSlot ? ` (${State.selectedSlot})` : '';

    if (State.orderMode === 'DINE_IN') {
      const tableVal = document.getElementById('inputTableNumber') ? document.getElementById('inputTableNumber').value : State.tableNumber;
      const guests = State.partySize || 2;
      chTitle.textContent = isSched 
        ? `Scheduled Dine-In • Table ${tableVal || 5} (${guests} Guests)`
        : `Dine-In • Table ${tableVal || 5} (${guests} Guests)`;
      chTiming.textContent = isSched 
        ? `Table Reservation: ${State.selectedDate || 'Select Date'}${schedTime}`
        : 'Immediate Table Service';
      if (chIcon) chIcon.innerHTML = '<i data-lucide="utensils" class="w-4 h-4"></i>';
    } else if (State.orderMode === 'TAKEAWAY') {
      chTitle.textContent = isSched 
        ? 'Scheduled Takeaway • Counter Pickup'
        : 'Takeaway • Express Counter Pickup';
      chTiming.textContent = isSched 
        ? `Counter Pickup: ${State.selectedDate || 'Select Date'}${schedTime}`
        : 'Immediate Prep (~15-20 Mins)';
      if (chIcon) chIcon.innerHTML = '<i data-lucide="shopping-bag" class="w-4 h-4"></i>';
    } else if (State.orderMode === 'DELIVERY') {
      chTitle.textContent = isSched 
        ? 'Scheduled Delivery • Doorstep'
        : 'Delivery • Direct Doorstep (+₹30)';
      chTiming.textContent = isSched 
        ? `Drop-off Window: ${State.selectedDate || 'Select Date'}${schedTime}`
        : 'Estimated Arrival ~35-45 Mins';
      if (chIcon) chIcon.innerHTML = '<i data-lucide="truck" class="w-4 h-4"></i>';
    }
    if (window.lucide) lucide.createIcons();
  }
}

// 9. Cart Drawer Modal
function openCartDrawer() {
  if (State.cart.length === 0) {
    showToast('Your tray is empty! Add some delicious bites first.');
    return;
  }
  renderCartDrawerItems();
  updateCartSummary();

  const backdrop = document.getElementById('modalBackdrop');
  const drawer = document.getElementById('cartDrawer');
  if (backdrop && drawer) {
    backdrop.classList.remove('opacity-0', 'pointer-events-none');
    backdrop.classList.add('opacity-100', 'pointer-events-auto');
    drawer.classList.remove('translate-y-full');
    drawer.classList.add('translate-y-0');
  }
}

function closeCartDrawer() {
  const drawer = document.getElementById('cartDrawer');
  if (drawer) {
    drawer.classList.add('translate-y-full');
    drawer.classList.remove('translate-y-0');
  }
  checkCloseBackdrop();
}

function renderCartDrawerItems() {
  const list = document.getElementById('cartItemsList');
  if (!list) return;

  if (State.cart.length === 0) {
    list.innerHTML = `<p class="text-center text-stone-400 text-xs py-6 font-medium">Tray is empty.</p>`;
    return;
  }

  let html = '';
  State.cart.forEach(item => {
    html += `
      <div class="flex items-center justify-between gap-3 p-3 bg-stone-50/80 rounded-2xl border border-stone-100">
        <div class="flex items-start gap-2.5 flex-1 min-w-0">
          <span class="diet-icon ${item.veg ? 'veg' : 'non-veg'} mt-1"></span>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-bold text-stone-900 truncate">${item.name}</div>
            <div class="text-[11px] font-semibold text-brand-700">₹${item.price} each</div>
            <input type="text" class="w-full bg-white border border-stone-200 rounded-lg px-2 py-1 text-[11px] font-medium mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500" placeholder="Cooking note (less spicy)..." value="${item.notes || ''}" onchange="updateItemNotes(${item.id}, this.value)">
          </div>
        </div>
        <div class="flex items-center gap-2.5 flex-shrink-0">
          <div class="bg-amber-100/70 border border-amber-300 text-brand-900 font-extrabold text-xs px-2 py-0.5 rounded-full flex items-center gap-2 shadow-sm">
            <button class="w-4 h-4 flex items-center justify-center font-black" onclick="updateItemQuantity(${item.id}, -1)">−</button>
            <span>${item.quantity}</span>
            <button class="w-4 h-4 flex items-center justify-center font-black" onclick="updateItemQuantity(${item.id}, 1)">+</button>
          </div>
          <span class="font-extrabold text-xs text-stone-900 min-w-[40px] text-right">₹${item.price * item.quantity}</span>
        </div>
      </div>
    `;
  });
  list.innerHTML = html;
}

function updateItemNotes(itemId, notes) {
  const item = State.cart.find(c => c.id === itemId);
  if (item) item.notes = notes.trim();
}

// 10. Promo Code Validation with Loyalty Tracking & Margin Protection
async function applyPromoCode(codeOverride = null) {
  const input = document.getElementById('inputCoupon');
  const statusEl = document.getElementById('couponStatus');
  const code = (codeOverride || (input ? input.value : '')).trim().toUpperCase();

  if (!code) {
    if (statusEl) {
      statusEl.className = 'text-xs font-bold text-red-500';
      statusEl.textContent = 'Please enter a coupon code.';
    }
    return;
  }

  const subtotal = State.cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);
  const phone = (document.getElementById('inputCustomerPhone')?.value || '').trim();
  const items = State.cart.map(c => ({ id: c.id, price: c.price, quantity: c.quantity }));

  try {
    const res = await fetch('/api/coupons/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code,
        subtotal: subtotal,
        customer_phone: phone || null,
        items: items
      })
    });
    const data = await res.json();

    if (!res.ok) {
      if (statusEl) {
        statusEl.className = 'text-xs font-bold text-red-500 space-y-1';
        statusEl.innerHTML = `<span>${data.detail || 'Invalid coupon.'}</span>`;
      }
      State.appliedCoupon = null;
      updateCartSummary();
      return;
    }

    State.appliedCoupon = data;
    if (input) input.value = code;
    if (statusEl) {
      statusEl.className = 'text-xs font-bold text-emerald-600 space-y-0.5';
      const tierBadge = data.customer_tier ? `<span class="inline-block text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 mr-1.5">${data.customer_tier.replace('_', ' ')} (${data.customer_visit_count || 0} visits)</span>` : '';
      const marginNotice = data.margin_capped ? `<span class="block text-[10px] text-amber-700 font-medium">Dish Margin Protected Discount: Capped to ₹${data.discount_amount} to guarantee culinary quality.</span>` : '';
      statusEl.innerHTML = `
        <div>${tierBadge}<span>Applied ${code}! Saved ₹${data.discount_amount}</span></div>
        ${marginNotice}
      `;
    }
    updateCartSummary();
    if (data.margin_capped) {
      showToast(`Coupon ${code} applied with dish margin optimization!`);
    } else {
      showToast(`Coupon ${code} applied successfully! Saved ₹${data.discount_amount}`);
    }
  } catch (err) {
    console.error('Coupon validation failed:', err);
  }
}

// 11. Digital Checkout & Payment Modal Flow
function proceedToCheckout() {
  if (State.cart.length === 0) {
    showToast('Your order tray is empty.');
    return;
  }

  const name = document.getElementById('inputCustomerName').value.trim();
  const phone = document.getElementById('inputCustomerPhone').value.trim();

  if (!name || !phone) {
    showToast('Please enter your Name and Mobile Number.');
    return;
  }

  if (State.orderMode === 'DINE_IN') {
    const table = document.getElementById('inputTableNumber').value.trim();
    if (!table) {
      showToast('Please enter or select your Table Number for Dine-In.');
      return;
    }
    State.tableNumber = table;
    const partyEl = document.getElementById('inputPartySize');
    if (partyEl) State.partySize = parseInt(partyEl.value, 10) || 2;
  }

  if (State.orderMode === 'DELIVERY') {
    const address = document.getElementById('inputDeliveryAddress').value.trim();
    if (!address) {
      showToast('Please specify your Delivery Address / Flat / Building.');
      return;
    }
  }

  if (State.isScheduled && !State.selectedSlot) {
    const slotType = State.orderMode === 'DINE_IN' ? 'Table Reservation Window' : State.orderMode === 'TAKEAWAY' ? 'Counter Pickup Slot' : 'Doorstep Delivery Window';
    showToast(`Please select a 30-minute ${slotType}.`);
    return;
  }

  closeCartDrawer();
  const checkoutModal = document.getElementById('checkoutModal');
  const backdrop = document.getElementById('modalBackdrop');
  if (checkoutModal && backdrop) {
    backdrop.classList.remove('opacity-0', 'pointer-events-none');
    backdrop.classList.add('opacity-100', 'pointer-events-auto');
    checkoutModal.classList.remove('opacity-0', 'pointer-events-none');
    checkoutModal.classList.add('opacity-100', 'pointer-events-auto');
  }
}

function closeCheckoutModal() {
  const checkoutModal = document.getElementById('checkoutModal');
  if (checkoutModal) {
    checkoutModal.classList.add('opacity-0', 'pointer-events-none');
    checkoutModal.classList.remove('opacity-100', 'pointer-events-auto');
  }
  checkCloseBackdrop();
}

let selectedPayment = 'UPI';
function selectPaymentMethod(method) {
  selectedPayment = method;
  document.querySelectorAll('.payment-method-card').forEach(c => {
    if (c.dataset.method === method) {
      c.className = 'payment-method-card active border-2 border-brand-500 bg-orange-50/70 p-3 rounded-2xl flex flex-col items-center gap-1 cursor-pointer transition-all';
    } else {
      c.className = 'payment-method-card border-2 border-stone-200 hover:border-stone-300 p-3 rounded-2xl flex flex-col items-center gap-1 cursor-pointer transition-all';
    }
  });
}

async function finalizeOrderPayment() {
  const btn = document.getElementById('btnFinalizePayment');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Processing Payment...';
  }

  const name = document.getElementById('inputCustomerName').value.trim();
  const phone = document.getElementById('inputCustomerPhone').value.trim();
  const table = State.orderMode === 'DINE_IN' ? document.getElementById('inputTableNumber').value.trim() : null;
  const partySize = State.orderMode === 'DINE_IN' ? (parseInt(document.getElementById('inputPartySize')?.value, 10) || State.partySize || 2) : 1;

  let deliveryAddr = null;
  if (State.orderMode === 'DELIVERY') {
    const rawAddr = document.getElementById('inputDeliveryAddress').value.trim();
    const landmark = document.getElementById('inputDeliveryLandmark') ? document.getElementById('inputDeliveryLandmark').value.trim() : '';
    deliveryAddr = landmark ? `${rawAddr} (Landmark: ${landmark})` : rawAddr;
  }

  let orderNotes = '';
  if (State.orderMode === 'TAKEAWAY') {
    orderNotes = document.getElementById('inputTakeawayNotes') ? document.getElementById('inputTakeawayNotes').value.trim() : '';
  }

  const noCutlery = document.getElementById('checkNoCutlery') ? document.getElementById('checkNoCutlery').checked : true;

  const payload = {
    order_type: State.orderMode,
    restaurant_id: State.selectedRestaurantId || 'cp-artisan',
    table_number: table,
    party_size: partySize,
    customer_name: name,
    customer_phone: phone,
    delivery_address: deliveryAddr,
    notes: orderNotes || null,
    items: State.cart.map(c => ({
      id: c.id,
      name: c.name,
      price: c.price,
      quantity: c.quantity,
      notes: c.notes || ''
    })),
    coupon_code: State.appliedCoupon ? State.appliedCoupon.code : null,
    payment_method: selectedPayment,
    scheduled_date: State.isScheduled ? State.selectedDate : null,
    scheduled_slot: State.isScheduled ? State.selectedSlot : null,
    tip_amount: State.tipAmount,
    no_cutlery: noCutlery
  };

  // Save profile for fast 1-tap re-ordering
  saveUserProfile(name, phone, deliveryAddr, table);

  // Bharat Mode Offline Check: If device is offline, queue order locally
  if (!navigator.onLine || (window.bharatSync && !window.bharatSync.isOnline)) {
    console.log('[Bharat Mode] Device is offline. Queueing order locally.');
    const offlineResult = window.bharatSync ? window.bharatSync.queueOrderOffline(payload) : {
      order_code: `OFFLINE-${Date.now()}`,
      total_amount: State.cart.reduce((s, i) => s + (i.price * i.quantity), 0),
      bounce_back_coupon_code: 'BHARAT-SYNC-PENDING',
      created_at: new Date().toISOString()
    };
    launchConfetti();
    State.cart = [];
    State.appliedCoupon = null;
    State.tipAmount = 0.0;
    updateCartSummary();
    renderMenuItems();
    closeCheckoutModal();
    localStorage.setItem('rasoi_active_order', offlineResult.order_code);
    openReceiptModal(offlineResult);
    showToast('📱 Bharat Offline Mode: Order saved locally. Will auto-sync to kitchen once connected!', 'success');
    return;
  }

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || 'Failed to place order.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Pay Now & Confirm';
      }
      return;
    }

    launchConfetti();

    State.cart = [];
    State.appliedCoupon = null;
    State.tipAmount = 0.0;
    updateCartSummary();
    renderMenuItems();

    closeCheckoutModal();
    localStorage.setItem('rasoi_active_order', data.order_code);
    updateLiveOrderTrackerWidget(data.order_code, 'PENDING');
    openReceiptModal(data);
  } catch (err) {
    console.error('Order creation error:', err);
    if (window.bharatSync) {
      console.log('[Bharat Mode] Network failed during order. Saving to offline queue.');
      const offlineResult = window.bharatSync.queueOrderOffline(payload);
      launchConfetti();
      State.cart = [];
      State.appliedCoupon = null;
      State.tipAmount = 0.0;
      updateCartSummary();
      renderMenuItems();
      closeCheckoutModal();
      localStorage.setItem('rasoi_active_order', offlineResult.order_code);
      openReceiptModal(offlineResult);
      showToast('📱 Bharat Offline Mode: Saved locally. Will auto-sync to kitchen once connected!', 'success');
      return;
    }
    showToast('Network error while processing order.');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Pay Now & Confirm';
    }
  }
}

// 12. Post-Order Receipt & Retention Engine
function openReceiptModal(orderData) {
  State.activeOrder = orderData;
  const modal = document.getElementById('receiptModal');
  const backdrop = document.getElementById('modalBackdrop');
  if (modal && backdrop) {
    backdrop.classList.remove('opacity-0', 'pointer-events-none');
    backdrop.classList.add('opacity-100', 'pointer-events-auto');
    modal.classList.remove('opacity-0', 'pointer-events-none');
    modal.classList.add('opacity-100', 'pointer-events-auto');
  }

  document.getElementById('receiptOrderCode').textContent = orderData.order_code;
  document.getElementById('receiptCustomerName').textContent = orderData.customer_name;
  document.getElementById('receiptTotalPaid').textContent = `₹${orderData.total_amount}`;
  let channelDisplay = orderData.order_type.replace('_', ' ');
  let prepTimingText = 'Estimated Prep Time: ~15-20 Mins';

  if (orderData.order_type === 'DINE_IN') {
    const tableStr = orderData.table_number ? `Table #${orderData.table_number}` : 'Table';
    const partyStr = orderData.party_size ? `, ${orderData.party_size} Guests` : '';
    if (orderData.scheduled_slot) {
      channelDisplay = `Scheduled Dine-In (${tableStr}${partyStr})`;
      prepTimingText = `Table Reserved for ${orderData.scheduled_date} (${orderData.scheduled_slot})`;
    } else {
      channelDisplay = `Dine-In (${tableStr})`;
      prepTimingText = 'Immediate Table Service: Cooking on kitchen cookline';
    }
  } else if (orderData.order_type === 'TAKEAWAY') {
    if (orderData.scheduled_slot) {
      channelDisplay = 'Scheduled Express Takeaway Pickup';
      prepTimingText = `Pickup Scheduled for ${orderData.scheduled_date} (${orderData.scheduled_slot}) at Counter #1`;
    } else {
      channelDisplay = 'Takeaway Counter Pickup';
      prepTimingText = 'Estimated Counter Pickup: ~15 Mins at Counter #1';
    }
  } else if (orderData.order_type === 'DELIVERY') {
    const addr = orderData.delivery_address || 'Customer Address';
    if (orderData.scheduled_slot) {
      channelDisplay = `Scheduled Delivery to ${addr}`;
      prepTimingText = `Delivery Scheduled for ${orderData.scheduled_date} (${orderData.scheduled_slot})`;
    } else {
      channelDisplay = `Doorstep Delivery to ${addr}`;
      prepTimingText = 'Direct Rider Dispatch: Estimated ~35-40 Mins';
    }
  }

  document.getElementById('receiptOrderType').textContent = channelDisplay;
  document.getElementById('receiptPrepTime').textContent = prepTimingText;

  const couponBox = document.getElementById('receiptBounceBackCode');
  if (couponBox) {
    couponBox.textContent = orderData.bounce_back_coupon_code;
  }

  // Save to customer order history
  saveOrderToHistory(orderData);

  updateProgressTracker(orderData.order_status || 'PENDING');
  startStatusPolling(orderData.order_code);
}

function shareReceiptWhatsApp() {
  if (!State.activeOrder) return;
  const o = State.activeOrder;
  const itemsText = (o.items || []).map(it => `${it.quantity}x ${it.name}`).join(', ');
  const message = `RasoiLink Order Confirmed!\nOrder Code: ${o.order_code}\nItems: ${itemsText}\nTotal: ₹${o.total_amount}\nStatus: ${o.order_status || 'CONFIRMED'}\nTrack live at: ${window.location.origin}`;
  const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}

function saveOrderToHistory(order) {
  try {
    const history = JSON.parse(localStorage.getItem('rasoilink_order_history') || '[]');
    const existingIdx = history.findIndex(h => h.order_code === order.order_code);
    const orderRecord = {
      order_code: order.order_code,
      created_at: new Date().toISOString(),
      order_type: order.order_type,
      total_amount: order.total_amount,
      order_status: order.order_status || 'PENDING',
      bounce_back_coupon_code: order.bounce_back_coupon_code,
      items: order.items || []
    };
    if (existingIdx >= 0) {
      history[existingIdx] = { ...history[existingIdx], ...orderRecord };
    } else {
      history.unshift(orderRecord);
    }
    localStorage.setItem('rasoilink_order_history', JSON.stringify(history.slice(0, 10)));
  } catch (e) {
    console.error('Failed to save order history:', e);
  }
}

function openOrdersHistoryModal() {
  const modal = document.getElementById('ordersHistoryModal');
  const backdrop = document.getElementById('modalBackdrop');
  const listEl = document.getElementById('ordersHistoryList');
  if (!modal || !listEl) return;

  const history = JSON.parse(localStorage.getItem('rasoilink_order_history') || '[]');
  if (history.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-10 px-4 text-stone-500">
        <div class="w-10 h-10 rounded-full bg-stone-100 text-stone-400 flex items-center justify-center mx-auto mb-2 font-bold">
          <i data-lucide="receipt" class="w-5 h-5"></i>
        </div>
        <p class="font-bold text-stone-700">No past orders yet</p>
        <p class="text-[11px] text-stone-400 mt-1">Browse our menu and place an order to see your meal history here.</p>
      </div>
    `;
  } else {
    listEl.innerHTML = history.map((ord, idx) => {
      const itemsSummary = (ord.items || []).map(it => `${it.quantity}x ${it.name}`).join(', ');
      return `
        <div class="bg-stone-50 border border-stone-200/80 rounded-2xl p-3.5 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-mono font-black text-xs text-stone-900 bg-white border border-stone-200 px-2.5 py-0.5 rounded-full">${ord.order_code}</span>
            <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${ord.order_status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${ord.order_status || 'PENDING'}</span>
          </div>
          <div class="text-xs text-stone-600 line-clamp-2">${itemsSummary || 'Artisanal dishes'}</div>
          <div class="flex items-center justify-between pt-1 border-t border-stone-200/60">
            <div>
              <span class="text-[10px] text-stone-400 font-semibold">Total Paid: </span>
              <strong class="font-bold text-stone-900 text-xs">₹${ord.total_amount}</strong>
            </div>
            <button onclick="reorderPastOrder(${idx})" class="px-3 py-1 bg-stone-900 hover:bg-black text-white text-[11px] font-bold rounded-full transition-all flex items-center gap-1 shadow-sm">
              <i data-lucide="repeat" class="w-3 h-3"></i>
              <span>Re-Order Meal</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.lucide) lucide.createIcons();
  backdrop.classList.remove('opacity-0', 'pointer-events-none');
  backdrop.classList.add('opacity-100', 'pointer-events-auto');
  modal.classList.remove('opacity-0', 'pointer-events-none');
  modal.classList.add('opacity-100', 'pointer-events-auto');
}

function closeOrdersHistoryModal() {
  const modal = document.getElementById('ordersHistoryModal');
  const backdrop = document.getElementById('modalBackdrop');
  if (modal) {
    modal.classList.add('opacity-0', 'pointer-events-none');
    modal.classList.remove('opacity-100', 'pointer-events-auto');
  }
  if (backdrop) {
    backdrop.classList.add('opacity-0', 'pointer-events-none');
    backdrop.classList.remove('opacity-100', 'pointer-events-auto');
  }
}

function reorderPastOrder(historyIndex) {
  try {
    const history = JSON.parse(localStorage.getItem('rasoilink_order_history') || '[]');
    const ord = history[historyIndex];
    if (!ord || !ord.items) return;

    closeOrdersHistoryModal();
    ord.items.forEach(it => {
      addItemToCart(it.id, it.quantity || 1, it.notes || '');
    });
    showToast(`Added dishes from ${ord.order_code} to tray!`);
    openCartDrawer();
  } catch (e) {
    console.error('Re-order error:', e);
  }
}

function updateProgressTracker(status) {
  const steps = ['PENDING', 'PREPARING', 'READY', 'COMPLETED'];
  const statusIdx = steps.indexOf(status);

  steps.forEach((step, idx) => {
    const el = document.getElementById(`step-${step.toLowerCase()}`);
    if (el) {
      const dot = el.querySelector('.step-dot');
      const label = el.querySelector('span');
      if (idx <= statusIdx) {
        if (dot) dot.className = 'step-dot w-7 h-7 rounded-full bg-emerald-500 text-white font-bold text-xs flex items-center justify-center shadow-md shadow-emerald-500/20';
        if (label) label.className = 'text-[10px] font-bold text-emerald-700';
      } else {
        if (dot) dot.className = 'step-dot w-7 h-7 rounded-full bg-white border-2 border-stone-300 text-stone-500 font-bold text-xs flex items-center justify-center';
        if (label) label.className = 'text-[10px] font-bold text-stone-400';
      }
    }
  });

  const bar = document.getElementById('trackerProgressBar');
  if (bar) {
    const percentages = [15, 45, 75, 100];
    bar.style.width = `${percentages[Math.max(0, statusIdx)]}%`;
  }

  const cancelBtn = document.getElementById('btnCancelOrder');
  if (cancelBtn) {
    cancelBtn.style.display = (status === 'PENDING') ? 'block' : 'none';
  }
}

function startStatusPolling(orderCode) {
  if (State.statusPollTimer) clearInterval(State.statusPollTimer);
  State.statusPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/orders/${orderCode}`);
      if (!res.ok) return;
      const order = await res.json();
      updateProgressTracker(order.order_status);
      if (order.order_status === 'COMPLETED' || order.order_status === 'CANCELLED') {
        clearInterval(State.statusPollTimer);
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 3000);
}

function closeReceiptModal() {
  const modal = document.getElementById('receiptModal');
  if (modal) {
    modal.classList.add('opacity-0', 'pointer-events-none');
    modal.classList.remove('opacity-100', 'pointer-events-auto');
  }
  checkCloseBackdrop();
  if (State.statusPollTimer) clearInterval(State.statusPollTimer);
}

async function cancelActiveOrder() {
  if (!State.activeOrder) return;
  if (!confirm('Are you sure you want to cancel this order?')) return;

  try {
    const res = await fetch(`/api/orders/${State.activeOrder.order_code}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Customer cancelled from receipt modal' })
    });
    if (!res.ok) throw new Error('Cancellation failed');

    showToast('Order cancelled successfully.');
    updateProgressTracker('CANCELLED');
    closeReceiptModal();
  } catch (e) {
    showToast('Could not cancel order. Kitchen may already be preparing it.');
  }
}

function copyBounceBackCoupon() {
  const code = document.getElementById('receiptBounceBackCode').textContent.trim();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code);
    showToast(`Copied ${code} to clipboard`);
  } else {
    showToast(`Code: ${code}`);
  }
}

// 13. Confetti Shower
function launchConfetti() {
  const container = document.getElementById('confettiContainer');
  if (!container) return;
  container.innerHTML = '';

  const colors = ['#ea580c', '#f97316', '#f59e0b', '#10b981', '#ef4444', '#38bdf8'];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 0.8}s`;
    piece.style.animationDuration = `${1.8 + Math.random() * 1.2}s`;
    container.appendChild(piece);
  }

  setTimeout(() => { container.innerHTML = ''; }, 3500);
}

// 14. Toast Feedback
function showToast(msg) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-emerald-400"></span><span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}

function checkCloseBackdrop() {
  const backdrop = document.getElementById('modalBackdrop');
  const dishModal = document.getElementById('dishModal');
  const cartDrawer = document.getElementById('cartDrawer');
  const checkoutModal = document.getElementById('checkoutModal');
  const receiptModal = document.getElementById('receiptModal');
  const ordersHistoryModal = document.getElementById('ordersHistoryModal');
  const adminLoginModal = document.getElementById('adminLoginModal');
  const restaurantModal = document.getElementById('restaurantSelectorModal');

  const isDishOpen = dishModal && dishModal.classList.contains('translate-y-0');
  const isCartOpen = cartDrawer && cartDrawer.classList.contains('translate-y-0');
  const isCheckoutOpen = checkoutModal && checkoutModal.classList.contains('opacity-100');
  const isReceiptOpen = receiptModal && receiptModal.classList.contains('opacity-100');
  const isOrdersOpen = ordersHistoryModal && ordersHistoryModal.classList.contains('opacity-100');
  const isAdminOpen = adminLoginModal && adminLoginModal.classList.contains('opacity-100');
  const isRestaurantOpen = restaurantModal && restaurantModal.classList.contains('opacity-100');

  const anyOpen = isDishOpen || isCartOpen || isCheckoutOpen || isReceiptOpen || isOrdersOpen || isAdminOpen || isRestaurantOpen;

  if (!anyOpen) {
    if (backdrop) {
      backdrop.classList.add('opacity-0', 'pointer-events-none');
      backdrop.classList.remove('opacity-100', 'pointer-events-auto');
    }
    document.body.classList.remove('overflow-hidden');
  } else {
    document.body.classList.add('overflow-hidden');
  }
}

// Mobile Bottom Navigation Helpers (Thumb Friendly UI)
function scrollToMenuCatalog() {
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active', 'text-brand-600'));
  const btn = document.getElementById('mobNavBtnMenu');
  if (btn) btn.classList.add('active', 'text-brand-600');

  const catNav = document.getElementById('categoriesNav');
  if (catNav) {
    const yOffset = -70;
    const y = catNav.getBoundingClientRect().top + window.pageYOffset + yOffset;
    window.scrollTo({ top: y, behavior: 'smooth' });
  } else {
    window.scrollTo({ top: 350, behavior: 'smooth' });
  }
}

function focusSearchField() {
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active', 'text-brand-600'));
  const btn = document.getElementById('mobNavBtnSearch');
  if (btn) btn.classList.add('active', 'text-brand-600');

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => searchInput.focus(), 320);
  }
}

function triggerAIChat() {
  if (typeof window.toggleChatWindow === 'function') {
    window.toggleChatWindow();
  } else {
    const trigger = document.getElementById('chatTriggerBtn');
    if (trigger) trigger.click();
  }
}

// 15. Event Listeners Setup
function setupEventListeners() {
  const backdrop = document.getElementById('modalBackdrop');
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeCartDrawer();
      closeCheckoutModal();
      closeReceiptModal();
      closeDishModal();
      if (typeof closeOrdersHistoryModal === 'function') closeOrdersHistoryModal();
      if (typeof closeAdminLoginModal === 'function') closeAdminLoginModal();
      if (typeof closeRestaurantSelectorModal === 'function') closeRestaurantSelectorModal();
    });
  }
}

// Global API Object for Chatbot Integration
window.RasoiCart = {
  addItem: (id, qty = 1, notes = '') => addItemToCart(id, qty, notes),
  removeItem: (id) => updateItemQuantity(id, -99),
  applyCoupon: (code) => applyPromoCode(code),
  setSchedule: (date, slot) => {
    setScheduleMode(true);
    selectDate(date);
    setTimeout(() => chooseSlot(slot), 300);
  },
  getCartSummary: () => State.cart,
  openCart: () => openCartDrawer()
};

// ==========================================
// STOREFRONT ADMIN AUTHENTICATION
// ==========================================

async function checkStorefrontAdminStatus() {
  const token = localStorage.getItem('rasoilink_admin_token');
  const label = document.getElementById('headerAdminLabel');
  const btn = document.getElementById('btnHeaderAdminLogin');
  if (!token) {
    if (label) label.textContent = 'Admin Login';
    if (btn) {
      btn.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 hover:bg-stone-900 text-stone-700 hover:text-white border border-stone-200 rounded-full text-xs font-bold transition-all duration-200';
    }
    return;
  }

  try {
    const res = await fetch(`/api/admin/verify?token=${encodeURIComponent(token)}`);
    if (res.ok) {
      const data = await res.json();
      const user = data.session;
      if (label && user) {
        label.textContent = `Admin: ${user.full_name ? user.full_name.split(' ')[0] : 'Manager'}`;
      }
      if (btn) {
        btn.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-full text-xs font-bold transition-all duration-200 shadow-sm';
      }
    } else {
      localStorage.removeItem('rasoilink_admin_token');
      localStorage.removeItem('rasoilink_admin_user');
      if (label) label.textContent = 'Admin Login';
      if (btn) {
        btn.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 hover:bg-stone-900 text-stone-700 hover:text-white border border-stone-200 rounded-full text-xs font-bold transition-all duration-200';
      }
    }
  } catch (e) {}
}

function openAdminModal() {
  const backdrop = document.getElementById('adminModalBackdrop');
  const modal = document.getElementById('adminLoginModal');
  const loggedOutView = document.getElementById('adminModalLoggedOut');
  const loggedInView = document.getElementById('adminModalLoggedIn');
  const token = localStorage.getItem('rasoilink_admin_token');
  const userStr = localStorage.getItem('rasoilink_admin_user');

  if (token && userStr) {
    try {
      const user = JSON.parse(userStr);
      const nameEl = document.getElementById('storefrontAdminName');
      const roleEl = document.getElementById('storefrontAdminRole');
      if (nameEl) nameEl.textContent = user.full_name || 'Admin';
      if (roleEl) roleEl.textContent = `${user.role || 'Staff'} • Active Session`;
      if (loggedOutView) loggedOutView.classList.add('hidden');
      if (loggedInView) loggedInView.classList.remove('hidden');
    } catch (e) {
      if (loggedOutView) loggedOutView.classList.remove('hidden');
      if (loggedInView) loggedInView.classList.add('hidden');
    }
  } else {
    if (loggedOutView) loggedOutView.classList.remove('hidden');
    if (loggedInView) loggedInView.classList.add('hidden');
  }

  if (backdrop && modal) {
    backdrop.classList.remove('opacity-0', 'pointer-events-none');
    backdrop.classList.add('opacity-100', 'pointer-events-auto');
    modal.classList.remove('opacity-0', 'pointer-events-none');
    modal.classList.add('opacity-100', 'pointer-events-auto');
    if (window.lucide) lucide.createIcons();
    const pinInput = document.getElementById('storefrontAuthPin');
    if (pinInput && !token) pinInput.focus();
  }
}

function closeAdminModal() {
  const backdrop = document.getElementById('adminModalBackdrop');
  const modal = document.getElementById('adminLoginModal');
  if (backdrop && modal) {
    backdrop.classList.add('opacity-0', 'pointer-events-none');
    backdrop.classList.remove('opacity-100', 'pointer-events-auto');
    modal.classList.add('opacity-0', 'pointer-events-none');
    modal.classList.remove('opacity-100', 'pointer-events-auto');
  }
  hideStorefrontAuthError();
}

function switchStorefrontAuthTab(type) {
  const tabPin = document.getElementById('adminTabPin');
  const tabCreds = document.getElementById('adminTabCreds');
  const formPin = document.getElementById('storefrontAuthPinForm');
  const formCreds = document.getElementById('storefrontAuthCredsForm');
  hideStorefrontAuthError();

  if (type === 'PIN') {
    tabPin.className = 'flex-1 py-2 text-xs font-bold rounded-xl transition-all bg-white text-stone-900 shadow-sm flex items-center justify-center gap-1.5';
    tabCreds.className = 'flex-1 py-2 text-xs font-bold rounded-xl transition-all text-stone-500 hover:text-stone-900 flex items-center justify-center gap-1.5';
    formPin.classList.remove('hidden');
    formCreds.classList.add('hidden');
    document.getElementById('storefrontAuthPin').focus();
  } else {
    tabCreds.className = 'flex-1 py-2 text-xs font-bold rounded-xl transition-all bg-white text-stone-900 shadow-sm flex items-center justify-center gap-1.5';
    tabPin.className = 'flex-1 py-2 text-xs font-bold rounded-xl transition-all text-stone-500 hover:text-stone-900 flex items-center justify-center gap-1.5';
    formCreds.classList.remove('hidden');
    formPin.classList.add('hidden');
    document.getElementById('storefrontAuthUser').focus();
  }
}

function showStorefrontAuthError(msg) {
  const errBox = document.getElementById('adminModalError');
  const errMsg = document.getElementById('adminModalErrorMsg');
  if (errMsg) errMsg.textContent = msg;
  if (errBox) errBox.classList.remove('hidden');
}

function hideStorefrontAuthError() {
  const errBox = document.getElementById('adminModalError');
  if (errBox) errBox.classList.add('hidden');
}

async function submitStorefrontPin() {
  const input = document.getElementById('storefrontAuthPin');
  const pin = input ? input.value.trim() : '';
  if (pin.length !== 4) {
    showStorefrontAuthError('Please enter a 4-digit PIN.');
    return;
  }

  const btn = document.getElementById('btnStorefrontSubmitPin');
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying PIN...'; }

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      localStorage.setItem('rasoilink_admin_token', data.token);
      localStorage.setItem('rasoilink_admin_user', JSON.stringify(data));
      checkStorefrontAdminStatus();
      openAdminModal();
    } else {
      showStorefrontAuthError(data.detail || 'Incorrect PIN. Try 1234.');
      if (input) input.value = '';
    }
  } catch (err) {
    showStorefrontAuthError('Authentication server error. Please try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

async function submitStorefrontCreds() {
  const userEl = document.getElementById('storefrontAuthUser');
  const passEl = document.getElementById('storefrontAuthPass');
  const username = userEl ? userEl.value.trim() : '';
  const password = passEl ? passEl.value.trim() : '';

  if (!username || !password) {
    showStorefrontAuthError('Please enter both username and password.');
    return;
  }

  const btn = document.getElementById('btnStorefrontSubmitCreds');
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Authenticating...'; }

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      localStorage.setItem('rasoilink_admin_token', data.token);
      localStorage.setItem('rasoilink_admin_user', JSON.stringify(data));
      checkStorefrontAdminStatus();
      openAdminModal();
    } else {
      showStorefrontAuthError(data.detail || 'Invalid manager credentials.');
    }
  } catch (err) {
    showStorefrontAuthError('Authentication server error. Please try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

function autoFillStorefrontPin(pin) {
  const input = document.getElementById('storefrontAuthPin');
  if (input) {
    input.value = pin;
    submitStorefrontPin();
  }
}

function autoFillStorefrontCreds(u, p) {
  const userEl = document.getElementById('storefrontAuthUser');
  const passEl = document.getElementById('storefrontAuthPass');
  if (userEl) userEl.value = u;
  if (passEl) passEl.value = p;
  submitStorefrontCreds();
}

async function logoutStorefrontAdmin() {
  const token = localStorage.getItem('rasoilink_admin_token');
  if (token) {
    try {
      await fetch(`/api/admin/logout?token=${encodeURIComponent(token)}`, { method: 'POST' });
    } catch (e) {}
  }
  localStorage.removeItem('rasoilink_admin_token');
  localStorage.removeItem('rasoilink_admin_user');
  checkStorefrontAdminStatus();
  closeAdminModal();
}

// -------------------------------------------------------------
// 12. Multi-Restaurant Franchise & Customer Features
// -------------------------------------------------------------

async function loadRestaurants() {
  try {
    const res = await fetch('/api/restaurants');
    if (!res.ok) return;
    const data = await res.json();
    State.restaurants = data.restaurants || [];

    if (State.restaurants.length > 0) {
      let current = State.restaurants.find(r => r.id === State.selectedRestaurantId);
      if (!current) {
        current = State.restaurants[0];
        State.selectedRestaurantId = current.id;
        localStorage.setItem('rasoi_selected_restaurant', current.id);
      }
      updateCurrentRestaurantUI(current);
    }
  } catch (err) {
    console.error('Error loading restaurants:', err);
  }
}

function updateCurrentRestaurantUI(rest) {
  if (!rest) return;
  const headerOutlet = document.getElementById('headerOutletName');
  if (headerOutlet) headerOutlet.textContent = rest.location_name || rest.name;

  const storeLocation = document.getElementById('storeLocationName');
  if (storeLocation) storeLocation.textContent = `${rest.location_name}, ${rest.city}`;

  const storeTitle = document.getElementById('storeTitle');
  if (storeTitle && rest.name) storeTitle.textContent = rest.name;

  const storeTagline = document.getElementById('storeTagline');
  if (storeTagline && rest.tagline) storeTagline.textContent = rest.tagline;

  const storeDesc = document.getElementById('storeDescription');
  if (storeDesc && rest.description) storeDesc.textContent = rest.description;

  const storeHours = document.getElementById('storeHours');
  if (storeHours && rest.opening_hours) storeHours.textContent = rest.opening_hours;

  const storeRating = document.getElementById('storeRating');
  if (storeRating && rest.rating) storeRating.textContent = `${rest.rating} (${rest.reviews_count || 120}+ reviews)`;

  if (window.loadSafeKitchenData) {
    window.loadSafeKitchenData(rest.id);
  }
}

function openRestaurantSelectorModal() {
  const modal = document.getElementById('restaurantSelectorModal');
  const backdrop = document.getElementById('modalBackdrop');
  if (modal) {
    modal.classList.remove('opacity-0', 'pointer-events-none');
    modal.classList.add('opacity-100', 'pointer-events-auto');
  }
  if (backdrop) {
    backdrop.classList.remove('opacity-0', 'pointer-events-none');
    backdrop.classList.add('opacity-100', 'pointer-events-auto');
  }
  renderRestaurantSelectorList();
}

function closeRestaurantSelectorModal() {
  const modal = document.getElementById('restaurantSelectorModal');
  if (modal) {
    modal.classList.add('opacity-0', 'pointer-events-none');
    modal.classList.remove('opacity-100', 'pointer-events-auto');
  }
  checkCloseBackdrop();
}

function renderRestaurantSelectorList() {
  const listEl = document.getElementById('restaurantSelectorList');
  if (!listEl) return;

  if (!State.restaurants || State.restaurants.length === 0) {
    listEl.innerHTML = `
      <div class="p-6 text-center text-stone-400">
        <p class="font-bold">No restaurant outlets found.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = State.restaurants.map(rest => {
    const isSelected = rest.id === State.selectedRestaurantId;
    return `
      <div class="p-4 rounded-2xl border transition-all ${isSelected ? 'border-brand-500 bg-brand-50/40 ring-1 ring-brand-500/20' : 'border-stone-200 bg-white hover:border-brand-200 hover:shadow-sm'} flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="font-bold text-sm text-stone-900">${rest.name}</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isSelected ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-600'}">
              ${rest.location_name}
            </span>
          </div>
          <p class="text-[11px] text-stone-500 font-medium">${rest.full_address}</p>
          <div class="flex items-center gap-3 text-[10px] text-stone-500 pt-1 font-semibold">
            <span class="flex items-center gap-1 text-amber-600 font-bold">
              <i data-lucide="star" class="w-3 h-3 fill-amber-500 text-amber-500"></i>
              ${rest.rating} (${rest.reviews_count || 100}+)
            </span>
            <span>•</span>
            <span class="flex items-center gap-1">
              <i data-lucide="clock" class="w-3 h-3 text-stone-400"></i>
              ~${rest.delivery_time_mins || 30} mins
            </span>
            <span>•</span>
            <span>₹${rest.price_for_two || 500} for two</span>
          </div>
        </div>
        <div class="flex items-center sm:self-center">
          ${isSelected ? `
            <span class="inline-flex items-center gap-1 text-xs font-black text-brand-700 bg-brand-100/70 px-3 py-1.5 rounded-xl">
              <i data-lucide="check" class="w-3.5 h-3.5"></i>
              Current Outlet
            </span>
          ` : `
            <button onclick="selectRestaurantOutlet('${rest.id}')" class="px-3.5 py-1.5 rounded-xl bg-stone-900 hover:bg-brand-600 text-white text-xs font-bold transition-all shadow-sm">
              Select Outlet
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function selectRestaurantOutlet(outletId) {
  State.selectedRestaurantId = outletId;
  localStorage.setItem('rasoi_selected_restaurant', outletId);
  const rest = State.restaurants.find(r => r.id === outletId);
  if (rest) {
    updateCurrentRestaurantUI(rest);
    showToast(`Switched to ${rest.name} (${rest.location_name})`);
  }
  closeRestaurantSelectorModal();
}

function toggleFavorite(dishId, event) {
  if (event) event.stopPropagation();
  if (State.favorites.has(dishId)) {
    State.favorites.delete(dishId);
    showToast('Removed from favorites');
  } else {
    State.favorites.add(dishId);
    showToast('Saved to favorites');
  }
  localStorage.setItem('rasoi_favorites', JSON.stringify(Array.from(State.favorites)));
  renderMenuItems();
}

function saveUserProfile(name, phone, deliveryAddr, table) {
  if (!name && !phone) return;
  const current = JSON.parse(localStorage.getItem('rasoi_user_profile') || '{}');
  const updated = {
    name: name || current.name || '',
    phone: phone || current.phone || '',
    deliveryAddress: deliveryAddr || current.deliveryAddress || '',
    tableNumber: table || current.tableNumber || ''
  };
  localStorage.setItem('rasoi_user_profile', JSON.stringify(updated));
  checkSavedProfile();
}

function checkSavedProfile() {
  const saved = localStorage.getItem('rasoi_user_profile');
  const btn = document.getElementById('btnAutofillProfile');
  if (!btn) return;

  if (saved) {
    try {
      const prof = JSON.parse(saved);
      if (prof.name || prof.phone) {
        btn.classList.remove('hidden');
        return;
      }
    } catch (e) {}
  }
  btn.classList.add('hidden');
}

function autoFillSavedProfile() {
  const saved = localStorage.getItem('rasoi_user_profile');
  if (!saved) return;
  try {
    const prof = JSON.parse(saved);
    const nameInput = document.getElementById('inputCustomerName');
    const phoneInput = document.getElementById('inputCustomerPhone');
    const addrInput = document.getElementById('inputDeliveryAddress');
    const tableInput = document.getElementById('inputTableNumber');

    if (nameInput && prof.name) nameInput.value = prof.name;
    if (phoneInput && prof.phone) phoneInput.value = prof.phone;
    if (addrInput && prof.deliveryAddress && State.orderMode === 'DELIVERY') addrInput.value = prof.deliveryAddress;
    if (tableInput && prof.tableNumber && State.orderMode === 'DINE_IN') tableInput.value = prof.tableNumber;

    showToast('Saved customer details filled!');
  } catch (e) {
    console.error('Error autofilling profile:', e);
  }
}

let activeOrderPollingTimer = null;

function initLiveOrderTracker() {
  const activeOrderCode = localStorage.getItem('rasoi_active_order');
  if (!activeOrderCode) return;

  checkLiveOrderStatus(activeOrderCode);

  if (activeOrderPollingTimer) clearInterval(activeOrderPollingTimer);
  activeOrderPollingTimer = setInterval(() => {
    const code = localStorage.getItem('rasoi_active_order');
    if (code) {
      checkLiveOrderStatus(code);
    } else {
      clearInterval(activeOrderPollingTimer);
    }
  }, 10000);
}

async function checkLiveOrderStatus(orderCode) {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderCode)}`);
    if (!res.ok) return;
    const order = await res.json();
    const status = order.order_status || order.status;
    if (!order || !status) return;

    updateLiveOrderTrackerWidget(order.order_code, status);

    if (status === 'COMPLETED' || status === 'CANCELLED') {
      localStorage.removeItem('rasoi_active_order');
      if (activeOrderPollingTimer) {
        clearInterval(activeOrderPollingTimer);
        activeOrderPollingTimer = null;
      }
    }
  } catch (err) {
    // Ignore network glitch during polling
  }
}

function updateLiveOrderTrackerWidget(orderCode, status) {
  const widget = document.getElementById('liveOrderTrackerWidget');
  const codeEl = document.getElementById('trackerOrderCode');
  const statusEl = document.getElementById('trackerOrderStatus');

  if (!widget || !codeEl || !statusEl) return;

  codeEl.textContent = orderCode;

  const statusMap = {
    'PENDING': 'Received',
    'IN_KITCHEN': 'In Kitchen',
    'PREPARING': 'Preparing',
    'READY': 'Ready for Pickup',
    'COMPLETED': 'Completed',
    'CANCELLED': 'Cancelled'
  };

  statusEl.textContent = statusMap[status] || status;
  widget.classList.remove('hidden');
}

async function viewActiveOrderReceipt() {
  const orderCode = localStorage.getItem('rasoi_active_order');
  if (!orderCode) return;

  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderCode)}`);
    if (res.ok) {
      const order = await res.json();
      openReceiptModal(order);
    }
  } catch (e) {
    showToast('Could not load order receipt.');
  }
}
