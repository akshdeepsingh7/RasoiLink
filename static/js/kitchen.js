/**
 * RasoiLink Operations & Kitchen Display System (KDS)
 * Integrated with Admin Authentication, Real-Time KDS, Menu Control, Promo Engine & Analytics
 * Team TrueAddams
 */

const KDS = {
  adminToken: null,
  adminUser: null,
  currentTab: 'TICKETS',
  selectedOutlet: 'ALL',
  outlets: [],
  orders: [],
  menuItems: [],
  categories: [],
  promos: [],
  slots: [],
  selectedDate: '',
  soundEnabled: true,
  soundVolume: parseFloat(localStorage.getItem('rasoilink_kds_volume') || '0.5'),
  soundTone: localStorage.getItem('rasoilink_kds_tone') || 'chime',
  searchQuery: '',
  statusFilter: 'ALL',
  channelFilter: 'ALL',
  timingFilter: 'ALL',
  isInitialLoad: true,
  knownOrderCodes: new Set(),
  pollTimer: null,
  timerInterval: null,
  audioCtx: null
};

document.addEventListener('DOMContentLoaded', async () => {
  initClock();
  initSound();
  setupModals();
  updateOutletDropdownOptions();
  await checkAdminSession();
});

// ==========================================
// 1. ADMIN AUTHENTICATION
// ==========================================

async function checkAdminSession() {
  const token = localStorage.getItem('rasoilink_admin_token');
  if (!token) {
    showAuthOverlay();
    return;
  }

  try {
    const res = await fetch(`/api/admin/verify?token=${encodeURIComponent(token)}`);
    if (res.ok) {
      const data = await res.json();
      KDS.adminToken = token;
      KDS.adminUser = data.session;
      unlockDashboard(data.session);
    } else {
      localStorage.removeItem('rasoilink_admin_token');
      localStorage.removeItem('rasoilink_admin_user');
      showAuthOverlay();
    }
  } catch (e) {
    console.error('Session verify error:', e);
    showAuthOverlay();
  }
}

function showAuthOverlay() {
  const overlay = document.getElementById('adminAuthOverlay');
  const app = document.getElementById('dashboardApp');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    overlay.style.display = 'flex';
  }
  if (app) {
    app.classList.add('opacity-0', 'pointer-events-none');
    app.classList.remove('opacity-100', 'pointer-events-auto');
    app.style.opacity = '0';
    app.style.pointerEvents = 'none';
  }
}

function unlockDashboard(session) {
  const overlay = document.getElementById('adminAuthOverlay');
  const app = document.getElementById('dashboardApp');
  const nameEl = document.getElementById('adminUserName');

  if (overlay) {
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
    overlay.style.display = 'none';
  }
  if (app) {
    app.classList.remove('opacity-0', 'pointer-events-none');
    app.classList.add('opacity-100', 'pointer-events-auto');
    app.style.opacity = '1';
    app.style.pointerEvents = 'auto';
  }
  if (nameEl && session) {
    nameEl.textContent = `${session.full_name || 'Admin'} (${session.role || 'Staff'})`;
  }

  // Load dashboard data
  loadInitialData();
  setupPolling();
  setupLiveTimers();

  const targetTab = localStorage.getItem('kds_target_tab');
  if (targetTab) {
    localStorage.removeItem('kds_target_tab');
    switchDashboardTab(targetTab);
  }
}

function switchAuthTab(type) {
  const tabPin = document.getElementById('authTabPin');
  const tabCreds = document.getElementById('authTabCreds');
  const viewPin = document.getElementById('authViewPin');
  const viewCreds = document.getElementById('authViewCreds');
  hideAuthError();

  if (type === 'PIN') {
    tabPin.className = 'flex-1 py-2 text-xs font-bold rounded-xl transition-all bg-white text-slate-900 shadow-sm flex items-center justify-center gap-1.5 border border-slate-200/60';
    tabCreds.className = 'flex-1 py-2 text-xs font-bold rounded-xl transition-all text-slate-500 hover:text-slate-800 flex items-center justify-center gap-1.5';
    viewPin.classList.remove('hidden');
    viewCreds.classList.add('hidden');
    document.getElementById('inputAuthPin').focus();
  } else {
    tabCreds.className = 'flex-1 py-2 text-xs font-bold rounded-xl transition-all bg-white text-slate-900 shadow-sm flex items-center justify-center gap-1.5 border border-slate-200/60';
    tabPin.className = 'flex-1 py-2 text-xs font-bold rounded-xl transition-all text-slate-500 hover:text-slate-800 flex items-center justify-center gap-1.5';
    viewCreds.classList.remove('hidden');
    viewPin.classList.add('hidden');
    document.getElementById('inputAuthUser').focus();
  }
}

function pressPin(digit) {
  const input = document.getElementById('inputAuthPin');
  if (input && input.value.length < 4) {
    input.value += digit;
    if (input.value.length === 4) {
      submitPinAuth();
    }
  }
}

function clearPin() {
  const input = document.getElementById('inputAuthPin');
  if (input) input.value = '';
  hideAuthError();
}

function autoFillPin(pin) {
  const input = document.getElementById('inputAuthPin');
  if (input) {
    input.value = pin;
    submitPinAuth();
  }
}

function autoFillCreds(u, p) {
  const userEl = document.getElementById('inputAuthUser');
  const passEl = document.getElementById('inputAuthPass');
  if (userEl) userEl.value = u;
  if (passEl) passEl.value = p;
  submitCredsAuth();
}

async function submitPinAuth() {
  const pinInput = document.getElementById('inputAuthPin');
  const pin = pinInput ? pinInput.value.trim() : '';
  if (pin.length !== 4) {
    showAuthError('Please enter a 4-digit PIN.');
    return;
  }

  const btn = document.getElementById('btnSubmitPin');
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Verifying PIN...';
  }

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
      KDS.adminToken = data.token;
      KDS.adminUser = data;
      unlockDashboard(data);
    } else {
      showAuthError(data.detail || 'Incorrect PIN. Try 1234.');
      clearPin();
    }
  } catch (err) {
    showAuthError('Authentication server error. Please try again.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

async function submitCredsAuth() {
  const userEl = document.getElementById('inputAuthUser');
  const passEl = document.getElementById('inputAuthPass');
  const username = userEl ? userEl.value.trim() : '';
  const password = passEl ? passEl.value.trim() : '';

  if (!username || !password) {
    showAuthError('Please enter both username and password.');
    return;
  }

  const btn = document.getElementById('btnSubmitCreds');
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Authenticating...';
  }

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
      KDS.adminToken = data.token;
      KDS.adminUser = data;
      unlockDashboard(data);
    } else {
      showAuthError(data.detail || 'Invalid manager credentials.');
    }
  } catch (err) {
    showAuthError('Authentication server error. Please try again.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

function showAuthError(msg) {
  const alertEl = document.getElementById('authErrorAlert');
  const msgEl = document.getElementById('authErrorMsg');
  if (msgEl) msgEl.textContent = msg;
  if (alertEl) alertEl.classList.remove('hidden');
}

function hideAuthError() {
  const alertEl = document.getElementById('authErrorAlert');
  if (alertEl) alertEl.classList.add('hidden');
}

async function logoutAdmin() {
  if (confirm('Sign out of RasoiLink Operations Dashboard?')) {
    try {
      if (KDS.adminToken) {
        await fetch(`/api/admin/logout?token=${encodeURIComponent(KDS.adminToken)}`, { method: 'POST' });
      }
    } catch (e) {}
    localStorage.removeItem('rasoilink_admin_token');
    localStorage.removeItem('rasoilink_admin_user');
    KDS.adminToken = null;
    KDS.adminUser = null;
    if (KDS.pollTimer) clearInterval(KDS.pollTimer);
    if (KDS.timerInterval) clearInterval(KDS.timerInterval);
    showAuthOverlay();
    clearPin();
  }
}

// ==========================================
// 2. DASHBOARD TABS MANAGEMENT
// ==========================================

function switchDashboardTab(tabId) {
  KDS.currentTab = tabId;
  const tabs = ['TICKETS', 'MENU', 'PROMOS', 'SLOTS', 'ANALYTICS', 'SETTINGS', 'OUTLETS', 'WASTE', 'MARKETING', 'GROUPPOOLS', 'BHARAT'];

  tabs.forEach(t => {
    const btn = document.getElementById(`tabBtn${capitalize(t)}`);
    const view = document.getElementById(`tabView${capitalize(t)}`);
    if (t === tabId) {
      if (btn) btn.className = 'dash-tab-btn px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all bg-brand-600 text-white shadow-sm';
      if (view) view.classList.remove('hidden');
    } else {
      if (btn) btn.className = 'dash-tab-btn px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50';
      if (view) view.classList.add('hidden');
    }
  });

  if (tabId === 'MENU') loadAdminMenu();
  else if (tabId === 'PROMOS') loadAdminPromos();
  else if (tabId === 'SLOTS') {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('adminSlotDatePicker');
    if (dateInput) dateInput.value = today;
    loadDateCapacity(today);
  } else if (tabId === 'ANALYTICS') loadAdminAnalytics();
  else if (tabId === 'SETTINGS') loadAdminSettings();
  else if (tabId === 'OUTLETS') loadAdminOutlets();
  else if (tabId === 'WASTE') {
    if (window.renderKitchenWasteEngine) window.renderKitchenWasteEngine();
  } else if (tabId === 'MARKETING') loadAdminMarketing();
  else if (tabId === 'GROUPPOOLS') loadAdminGroupPools();
  else if (tabId === 'BHARAT') loadAdminBharatOffline();
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ==========================================
// 3. LIVE KITCHEN BOARD (KDS)
// ==========================================

function initClock() {
  const clock = document.getElementById('kdsClock');
  if (!clock) return;
  const update = () => {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  update();
  setInterval(update, 1000);
}

function initSound() {
  const btn = document.getElementById('btnToggleSound');
  if (btn) {
    btn.addEventListener('click', () => {
      KDS.soundEnabled = !KDS.soundEnabled;
      btn.className = KDS.soundEnabled 
        ? 'btn-kds-tool px-3 py-1.5 bg-emerald-950/80 border border-emerald-600/60 text-emerald-300 hover:bg-emerald-900 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5'
        : 'btn-kds-tool px-3 py-1.5 bg-slate-800 border border-slate-700 text-slate-400 hover:bg-slate-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5';
      btn.innerHTML = KDS.soundEnabled 
        ? '<i data-lucide="bell" class="w-3.5 h-3.5"></i><span>Sound ON</span>' 
        : '<i data-lucide="bell-off" class="w-3.5 h-3.5"></i><span>Sound OFF</span>';
      if (window.lucide) lucide.createIcons();
      if (KDS.soundEnabled) playChime(660, 0.12);
    });
  }

  // Restore saved volume and tone UI
  const volRange = document.getElementById('audioVolumeRange');
  const volLabel = document.getElementById('audioVolumeLabel');
  if (volRange && volLabel) {
    const pct = Math.round(KDS.soundVolume * 100);
    volRange.value = pct;
    volLabel.textContent = `${pct}%`;
  }
  updateAudioToneUI(KDS.soundTone);
}

function openAudioSettingsModal() {
  openModal('audioSettingsModal');
}

function updateAudioVolume(val) {
  const vol = parseInt(val, 10) / 100.0;
  KDS.soundVolume = vol;
  localStorage.setItem('rasoilink_kds_volume', vol.toString());
  const label = document.getElementById('audioVolumeLabel');
  if (label) label.textContent = `${val}%`;
}

function setAudioTone(tone) {
  KDS.soundTone = tone;
  localStorage.setItem('rasoilink_kds_tone', tone);
  updateAudioToneUI(tone);
  testAudioChime();
}

function updateAudioToneUI(selectedTone) {
  document.querySelectorAll('.audio-tone-btn').forEach(b => {
    if (b.dataset.tone === selectedTone) {
      b.className = 'audio-tone-btn py-2 px-3 rounded-xl border border-brand-500 text-left font-bold transition-all bg-brand-600 text-white shadow-md';
    } else {
      b.className = 'audio-tone-btn py-2 px-3 rounded-xl border border-kds-border text-left font-bold transition-all bg-kds-card text-slate-300 hover:text-white';
    }
  });
}

function playChime(freq = 587.33, duration = 0.25, waveType = 'sine') {
  if (!KDS.soundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!KDS.audioCtx) KDS.audioCtx = new AudioContext();
    if (KDS.audioCtx.state === 'suspended') KDS.audioCtx.resume();

    const osc = KDS.audioCtx.createOscillator();
    const gain = KDS.audioCtx.createGain();
    osc.type = waveType;
    osc.frequency.setValueAtTime(freq, KDS.audioCtx.currentTime);

    const baseVol = Math.max(0.02, Math.min(1.0, KDS.soundVolume || 0.5)) * 0.35;
    gain.gain.setValueAtTime(baseVol, KDS.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, KDS.audioCtx.currentTime + duration);

    osc.connect(gain);
    gain.connect(KDS.audioCtx.destination);
    osc.start();
    osc.stop(KDS.audioCtx.currentTime + duration);
  } catch (e) {
    console.error('Audio playback error:', e);
  }
}

function testAudioChime() {
  const tone = KDS.soundTone || 'chime';
  if (tone === 'bell') {
    // High-pitched Counter Bell (triangle wave)
    playChime(1046.5, 0.45, 'triangle');
  } else if (tone === 'buzzer') {
    // Kitchen Prep Buzzer (sawtooth pulse)
    playChime(320, 0.25, 'sawtooth');
    setTimeout(() => playChime(320, 0.25, 'sawtooth'), 180);
  } else if (tone === 'marimba') {
    // Soft Melodic Marimba Arpeggio
    playChime(523.25, 0.18, 'sine');
    setTimeout(() => playChime(659.25, 0.18, 'sine'), 110);
    setTimeout(() => playChime(783.99, 0.32, 'sine'), 220);
  } else {
    // Default Dual Chime
    playChime(784, 0.22, 'sine');
    setTimeout(() => playChime(880, 0.28, 'sine'), 140);
  }
}

async function loadInitialData() {
  await Promise.all([fetchOrders(), fetchMenu(), fetchStats()]);
}

function setupPolling() {
  if (KDS.pollTimer) clearInterval(KDS.pollTimer);
  KDS.pollTimer = setInterval(() => {
    fetchOrders();
    fetchStats();
    if (KDS.currentTab === 'ANALYTICS') loadAdminAnalytics();
  }, 3000);
}

function setupLiveTimers() {
  if (KDS.timerInterval) clearInterval(KDS.timerInterval);
  KDS.timerInterval = setInterval(() => {
    document.querySelectorAll('.ticket-live-timer').forEach(el => {
      const createdStr = el.dataset.created;
      if (!createdStr) return;
      const created = new Date(createdStr);
      const now = new Date();
      const elapsedSec = Math.max(0, Math.floor((now - created) / 1000));
      const m = Math.floor(elapsedSec / 60);
      const s = elapsedSec % 60;
      el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

      if (m >= 18) {
        el.className = 'ticket-live-timer font-mono text-[11px] font-bold px-2 py-0.5 rounded text-rose-700 bg-rose-50 border border-rose-300 animate-pulse';
      } else if (m >= 10) {
        el.className = 'ticket-live-timer font-mono text-[11px] font-bold px-2 py-0.5 rounded text-amber-800 bg-amber-50 border border-amber-300';
      } else {
        el.className = 'ticket-live-timer font-mono text-[11px] font-bold px-2 py-0.5 rounded text-slate-600 bg-slate-100 border border-slate-200';
      }
    });
  }, 1000);
}

async function fetchOrders() {
  try {
    let url = '/api/orders';
    if (KDS.selectedOutlet && KDS.selectedOutlet !== 'ALL') {
      url += `?restaurant_id=${encodeURIComponent(KDS.selectedOutlet)}`;
    }
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const fetched = data.orders || [];

    let hasNewOrder = false;
    fetched.forEach(ord => {
      if (!KDS.knownOrderCodes.has(ord.order_code)) {
        KDS.knownOrderCodes.add(ord.order_code);
        if (ord.order_status === 'PENDING') hasNewOrder = true;
      }
    });

    if (hasNewOrder && !KDS.isInitialLoad) {
      testAudioChime();
    }
    KDS.isInitialLoad = false;

    KDS.orders = fetched;
    renderBoard();
  } catch (err) {
    console.error('Failed to fetch orders:', err);
  }
}

async function fetchStats() {
  try {
    let url = '/api/kitchen/stats';
    if (KDS.selectedOutlet && KDS.selectedOutlet !== 'ALL') {
      url += `?restaurant_id=${encodeURIComponent(KDS.selectedOutlet)}`;
    }
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();

    const elActive = document.getElementById('statActive');
    const elPending = document.getElementById('statPending');
    const elPreparing = document.getElementById('statPreparing');
    const elReady = document.getElementById('statReady');
    const elCompleted = document.getElementById('statCompletedToday');
    const elRev = document.getElementById('statRevenue');

    if (elActive) elActive.textContent = data.active_tickets;
    if (elPending) elPending.textContent = data.pending_count;
    if (elPreparing) elPreparing.textContent = data.preparing_count;
    if (elReady) elReady.textContent = data.ready_count;
    if (elCompleted) elCompleted.textContent = data.completed_today;
    if (elRev) elRev.textContent = `₹${data.today_revenue}`;
  } catch (err) {}
}

function renderBoard() {
  const colDineIn = document.getElementById('colDineIn');
  const colTakeaway = document.getElementById('colTakeaway');
  const colDelivery = document.getElementById('colDelivery');

  const countDineIn = document.getElementById('countDineIn');
  const countTakeaway = document.getElementById('countTakeaway');
  const countDelivery = document.getElementById('countDelivery');

  let active;
  if (KDS.statusFilter === 'COMPLETED') {
    active = KDS.orders.filter(o => o.order_status === 'COMPLETED');
  } else {
    active = KDS.orders.filter(o => o.order_status !== 'COMPLETED' && o.order_status !== 'CANCELLED');
    if (KDS.statusFilter !== 'ALL') {
      active = active.filter(o => o.order_status === KDS.statusFilter);
    }
  }

  if (KDS.channelFilter && KDS.channelFilter !== 'ALL') {
    active = active.filter(o => o.order_type === KDS.channelFilter);
  }

  if (KDS.timingFilter === 'NOW') {
    active = active.filter(o => !o.scheduled_slot);
  } else if (KDS.timingFilter === 'SCHEDULED') {
    active = active.filter(o => Boolean(o.scheduled_slot));
  }

  if (KDS.searchQuery) {
    const q = KDS.searchQuery.toLowerCase();
    active = active.filter(o => {
      const matchCode = o.order_code.toLowerCase().includes(q);
      const matchName = o.customer_name ? o.customer_name.toLowerCase().includes(q) : false;
      const matchTable = o.table_number ? o.table_number.toLowerCase().includes(q) : false;
      const matchPhone = o.customer_phone ? o.customer_phone.includes(q) : false;
      const matchItems = o.items && Array.isArray(o.items)
        ? o.items.some(it => it.name && it.name.toLowerCase().includes(q))
        : false;
      return matchCode || matchName || matchTable || matchPhone || matchItems;
    });
  }

  const dineInOrders = active.filter(o => o.order_type === 'DINE_IN');
  const takeawayOrders = active.filter(o => o.order_type === 'TAKEAWAY');
  const deliveryOrders = active.filter(o => o.order_type === 'DELIVERY');

  const dineLive = dineInOrders.filter(o => !o.scheduled_slot).length;
  const dineSched = dineInOrders.filter(o => Boolean(o.scheduled_slot)).length;

  const takeLive = takeawayOrders.filter(o => !o.scheduled_slot).length;
  const takeSched = takeawayOrders.filter(o => Boolean(o.scheduled_slot)).length;

  const deliLive = deliveryOrders.filter(o => !o.scheduled_slot).length;
  const deliSched = deliveryOrders.filter(o => Boolean(o.scheduled_slot)).length;

  if (countDineIn) countDineIn.textContent = dineInOrders.length;
  if (countTakeaway) countTakeaway.textContent = takeawayOrders.length;
  if (countDelivery) countDelivery.textContent = deliveryOrders.length;

  const mobDine = document.getElementById('mobCountDineIn');
  const mobTake = document.getElementById('mobCountTakeaway');
  const mobDeli = document.getElementById('mobCountDelivery');
  if (mobDine) mobDine.textContent = dineInOrders.length;
  if (mobTake) mobTake.textContent = takeawayOrders.length;
  if (mobDeli) mobDeli.textContent = deliveryOrders.length;

  const subDine = document.getElementById('subDineIn');
  const subTake = document.getElementById('subTakeaway');
  const subDeli = document.getElementById('subDelivery');

  if (subDine) subDine.textContent = `${dineLive} Live • ${dineSched} Sched`;
  if (subTake) subTake.textContent = `${takeLive} Live • ${takeSched} Sched`;
  if (subDeli) subDeli.textContent = `${deliLive} Live • ${deliSched} Sched`;

  if (colDineIn) colDineIn.innerHTML = renderTicketList(dineInOrders);
  if (colTakeaway) colTakeaway.innerHTML = renderTicketList(takeawayOrders);
  if (colDelivery) colDelivery.innerHTML = renderTicketList(deliveryOrders);
  if (window.lucide) lucide.createIcons();
}

// Mobile KDS Channel Filter
let currentMobileKdsChannel = 'ALL';
function setMobileKdsChannel(channel) {
  currentMobileKdsChannel = channel;
  document.querySelectorAll('.mob-kds-channel-btn').forEach(btn => {
    btn.className = 'mob-kds-channel-btn px-3 py-1.5 rounded-xl text-xs font-bold transition-all bg-white border border-slate-200 text-slate-700 flex items-center gap-1 active:scale-95';
  });
  const activeBtn = document.getElementById(`btnMobKds${channel}`);
  if (activeBtn) {
    activeBtn.className = 'mob-kds-channel-btn px-3 py-1.5 rounded-xl text-xs font-bold transition-all bg-brand-600 text-white shadow-sm flex items-center gap-1 active:scale-95';
  }

  const wrapDine = document.getElementById('wrapColDineIn');
  const wrapTake = document.getElementById('wrapColTakeaway');
  const wrapDeli = document.getElementById('wrapColDelivery');

  if (wrapDine && wrapTake && wrapDeli) {
    if (channel === 'ALL') {
      wrapDine.classList.remove('hidden');
      wrapTake.classList.remove('hidden');
      wrapDeli.classList.remove('hidden');
    } else if (channel === 'DINE_IN') {
      wrapDine.classList.remove('hidden');
      wrapTake.classList.add('hidden');
      wrapDeli.classList.add('hidden');
    } else if (channel === 'TAKEAWAY') {
      wrapDine.classList.add('hidden');
      wrapTake.classList.remove('hidden');
      wrapDeli.classList.add('hidden');
    } else if (channel === 'DELIVERY') {
      wrapDine.classList.add('hidden');
      wrapTake.classList.add('hidden');
      wrapDeli.classList.remove('hidden');
    }
  }
}

function renderTicketList(list) {
  if (list.length === 0) {
    return `
      <div class="text-center py-10 px-4 text-slate-400 text-xs">
        <div class="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-2 font-mono text-xs font-bold border border-slate-200">0</div>
        No active tickets in this queue.
      </div>
    `;
  }
  return list.map(order => createTicketHTML(order)).join('');
}

function createTicketHTML(order) {
  const alertInfo = calculatePrepAlert(order);
  const isUrgent = alertInfo.level === 'urgent';

  const typeBadgeClass = order.order_type === 'DINE_IN' 
    ? 'bg-amber-50 text-amber-900 border border-amber-200' 
    : order.order_type === 'TAKEAWAY' 
      ? 'bg-sky-50 text-sky-900 border border-sky-200' 
      : 'bg-purple-50 text-purple-900 border border-purple-200';

  let channelLabel = '';
  if (order.order_type === 'DINE_IN') {
    const guests = order.party_size ? ` (${order.party_size} Guests)` : '';
    channelLabel = `TABLE #${order.table_number || '?'}${guests}`;
  } else if (order.order_type === 'TAKEAWAY') {
    channelLabel = 'TAKEAWAY PICKUP';
  } else if (order.order_type === 'DELIVERY') {
    channelLabel = 'DOORSTEP DELIVERY';
  }

  // Restaurant outlet tag if order has restaurant_id
  const outletTag = order.restaurant_id && order.restaurant_id !== 'cp-artisan'
    ? `<span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase">${order.restaurant_id}</span>`
    : '';

  // Scheduled Banner
  let scheduledBanner = '';
  if (order.scheduled_slot) {
    if (order.order_type === 'DINE_IN') {
      scheduledBanner = `
        <div class="text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-xl flex items-center justify-between">
          <span>Table Reservation</span>
          <span class="font-mono font-black">${order.scheduled_date} (${order.scheduled_slot})</span>
        </div>
      `;
    } else if (order.order_type === 'TAKEAWAY') {
      scheduledBanner = `
        <div class="text-[11px] font-bold text-sky-900 bg-sky-50 border border-sky-200 px-2.5 py-1 rounded-xl flex items-center justify-between">
          <span>Counter Pickup Slot</span>
          <span class="font-mono font-black">${order.scheduled_date} (${order.scheduled_slot})</span>
        </div>
      `;
    } else if (order.order_type === 'DELIVERY') {
      scheduledBanner = `
        <div class="text-[11px] font-bold text-purple-900 bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-xl flex items-center justify-between">
          <span>Drop-off Window</span>
          <span class="font-mono font-black">${order.scheduled_date} (${order.scheduled_slot})</span>
        </div>
      `;
    }
  }

  // Delivery Address Banner
  let addressBanner = '';
  if (order.order_type === 'DELIVERY' && order.delivery_address) {
    addressBanner = `
      <div class="text-[11px] font-semibold text-purple-900 bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-xl flex items-start gap-1.5">
        <i data-lucide="map-pin" class="w-3.5 h-3.5 text-purple-600 flex-shrink-0 mt-0.5"></i>
        <span>${order.delivery_address}</span>
      </div>
    `;
  }

  // Group Hunger Pool Banner
  let groupPoolBanner = '';
  if (order.pool_code) {
    groupPoolBanner = `
      <div class="text-[11px] font-black text-amber-950 bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-300 px-2.5 py-1 rounded-xl flex items-center justify-between shadow-2xs">
        <span class="flex items-center gap-1.5"><i data-lucide="users" class="w-3.5 h-3.5 text-amber-700"></i><span>GROUP POOL #${order.pool_code}</span></span>
        <span class="bg-amber-600 text-white text-[9px] px-2 py-0.5 rounded-full uppercase font-bold">Consolidated Batch</span>
      </div>
    `;
  }

  // Bharat Offline Mode Synced Banner
  let offlineSyncedBanner = '';
  if (order.offline_synced) {
    offlineSyncedBanner = `
      <div class="text-[10px] font-extrabold text-emerald-900 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        <span>Bharat Offline Mode Synced</span>
      </div>
    `;
  }

  let itemsHTML = '';
  if (order.items && Array.isArray(order.items)) {
    order.items.forEach(it => {
      itemsHTML += `
        <div class="flex items-start justify-between text-xs py-1 border-b border-slate-100 last:border-0">
          <div>
            <span class="font-black text-slate-900 mr-1.5 font-mono">${it.quantity}x</span>
            <span class="text-slate-800 font-semibold">${it.name}</span>
            ${it.notes ? `<div class="text-[11px] text-amber-800 italic font-medium pl-5">"${it.notes}"</div>` : ''}
          </div>
        </div>
      `;
    });
  }

  let actionButtons = '';
  if (order.order_status === 'PENDING') {
    actionButtons = `
      <button class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-3 rounded-xl text-xs transition-all shadow-sm active:scale-95" onclick="updateOrderStatus('${order.order_code}', 'PREPARING')">
        Start Prep
      </button>
      <button class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-3 rounded-xl text-xs transition-all shadow-sm active:scale-95" onclick="updateOrderStatus('${order.order_code}', 'READY')">
        Mark Ready
      </button>
    `;
  } else if (order.order_status === 'PREPARING') {
    actionButtons = `
      <button class="col-span-2 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-3 rounded-xl text-xs transition-all shadow-sm active:scale-95 flex items-center justify-center gap-1.5" onclick="updateOrderStatus('${order.order_code}', 'READY')">
        Order Ready for Dispatch
      </button>
    `;
  } else if (order.order_status === 'READY') {
    actionButtons = `
      <button class="col-span-2 w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 px-3 rounded-xl text-xs transition-all shadow-sm active:scale-95 flex items-center justify-center gap-1.5" onclick="updateOrderStatus('${order.order_code}', 'COMPLETED')">
        Complete & Clear Ticket
      </button>
    `;
  }

  return `
    <div class="bg-white border ${isUrgent ? 'border-rose-400 shadow-md shadow-rose-100 ring-2 ring-rose-200' : 'border-slate-200/90 shadow-sm hover:shadow-md'} rounded-2xl p-3.5 space-y-2.5 transition-all" id="ticket-${order.order_code}">
      <div class="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
        <div class="flex items-center gap-1.5">
          <span class="font-mono text-xs font-black text-slate-800 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">#${order.order_code}</span>
          <button onclick="printKOT('${order.order_code}')" class="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold border border-slate-200 transition-all" title="Print KOT Thermal Slip">KOT Print</button>
          ${outletTag}
        </div>
        <span class="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full ${typeBadgeClass}">
          ${channelLabel}
        </span>
      </div>

      <div class="flex items-center justify-between text-xs">
        <span class="font-bold text-slate-800 truncate max-w-[150px]">${order.customer_name}</span>
        <span class="ticket-live-timer font-mono text-[11px] font-bold px-2 py-0.5 rounded text-slate-600 bg-slate-100 border border-slate-200" data-created="${order.created_at}">00:00</span>
      </div>

      ${scheduledBanner}
      ${addressBanner}
      ${groupPoolBanner}
      ${offlineSyncedBanner}

      ${order.notes ? `
        <div class="text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-xl">
          Note: ${order.notes}
        </div>
      ` : ''}

      <div class="space-y-0.5 py-1 bg-slate-50 rounded-xl px-2.5 border border-slate-100">
        ${itemsHTML}
      </div>

      <div class="grid grid-cols-2 gap-2 pt-1">
        ${actionButtons}
      </div>
    </div>
  `;
}

function calculatePrepAlert(order) {
  const now = new Date();
  if (order.scheduled_date && order.scheduled_slot) {
    const startTimeStr = order.scheduled_slot.split('-')[0].trim();
    const slotDateTime = new Date(`${order.scheduled_date}T${startTimeStr}:00`);
    const diffMin = Math.round((slotDateTime - now) / 60000);

    if (diffMin < 0) return { level: 'urgent', text: `OVERDUE ${Math.abs(diffMin)}m` };
    else if (diffMin <= 20) return { level: 'urgent', text: `DUE IN ${diffMin}m` };
    else if (diffMin <= 45) return { level: 'warning', text: `Prep soon (${diffMin}m)` };
    else return { level: 'normal', text: `Due: ${startTimeStr}` };
  }

  const created = new Date(order.created_at);
  const elapsedMin = Math.round((now - created) / 60000);
  if (elapsedMin >= 18) return { level: 'urgent', text: `WAITING ${elapsedMin}m` };
  else if (elapsedMin >= 10) return { level: 'warning', text: `${elapsedMin}m elapsed` };
  else return { level: 'normal', text: `${elapsedMin}m ago` };
}

async function updateOrderStatus(orderCode, newStatus) {
  try {
    const res = await fetch(`/api/orders/${orderCode}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) throw new Error('Status update failed');

    if (newStatus === 'READY') playChime(880, 0.2);
    else playChime(523.25, 0.15);

    await Promise.all([fetchOrders(), fetchStats()]);
  } catch (err) {
    alert('Failed to update order status.');
  }
}

function handleKDSSearch(val) {
  KDS.searchQuery = val.trim();
  renderBoard();
}

function filterKDSStatus(status) {
  KDS.statusFilter = status;
  document.querySelectorAll('.kds-filter-pill').forEach(btn => {
    if (btn.dataset.status === status) {
      btn.className = 'kds-filter-pill px-3 py-1 rounded-xl text-xs font-bold transition-all bg-white text-slate-900 shadow-sm border border-slate-200/60';
    } else {
      btn.className = 'kds-filter-pill px-3 py-1 rounded-xl text-xs font-bold transition-all text-slate-600 hover:text-slate-900';
    }
  });
  renderBoard();
}

function filterKDSChannel(channel) {
  KDS.channelFilter = channel;
  document.querySelectorAll('.kds-channel-pill').forEach(btn => {
    if (btn.dataset.channel === channel) {
      btn.className = 'kds-channel-pill px-3 py-1 rounded-xl text-xs font-bold transition-all bg-brand-600 text-white shadow-sm';
    } else {
      btn.className = 'kds-channel-pill px-3 py-1 rounded-xl text-xs font-bold transition-all text-slate-600 hover:text-slate-900';
    }
  });
  renderBoard();
}

function filterKDSTiming(timing) {
  KDS.timingFilter = timing;
  document.querySelectorAll('.kds-timing-pill').forEach(btn => {
    if (btn.dataset.timing === timing) {
      btn.className = 'kds-timing-pill px-3 py-1 rounded-xl text-xs font-bold transition-all bg-emerald-600 text-white shadow-sm';
    } else {
      btn.className = 'kds-timing-pill px-3 py-1 rounded-xl text-xs font-bold transition-all text-slate-600 hover:text-slate-900';
    }
  });
  renderBoard();
}

function printKOT(orderCode) {
  const order = KDS.orders.find(o => o.order_code === orderCode);
  if (!order) return;

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Popup window blocked. Please allow popups to print tickets.');
    return;
  }
  let itemsRows = '';
  if (order.items && Array.isArray(order.items)) {
    order.items.forEach(it => {
      itemsRows += `
        <tr>
          <td style="padding:4px 0; font-weight:800; font-size:16px;">${it.quantity}x</td>
          <td style="padding:4px 0; font-size:15px;">
            ${it.name}
            ${it.notes ? `<div style="font-size:12px; font-weight:700;">* ${it.notes}</div>` : ''}
          </td>
        </tr>
      `;
    });
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>KOT - ${order.order_code}</title>
        <style>
          body { font-family: monospace; width: 72mm; margin: 0 auto; padding: 6px; color: black; }
          .header { text-align: center; border-bottom: 2px dashed black; padding-bottom: 6px; margin-bottom: 8px; }
          .title { font-size: 20px; font-weight: 900; }
          .meta { font-size: 13px; font-weight: 700; margin: 3px 0; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
          .footer { text-align: center; border-top: 1px dashed black; padding-top: 6px; font-size: 11px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">KITCHEN ORDER TICKET</div>
          <div class="meta">#${order.order_code} • ${order.order_type}</div>
          ${order.table_number ? `<div class="meta" style="font-size:18px;">TABLE: ${order.table_number}</div>` : ''}
          <div style="font-size:11px;">Time: ${new Date(order.created_at).toLocaleTimeString()}</div>
        </div>
        <table><tbody>${itemsRows}</tbody></table>
        ${order.notes ? `<div style="font-weight:bold; font-size:12px; margin-bottom:6px;">SPECIAL NOTES: ${order.notes}</div>` : ''}
        <div class="footer">RasoiLink Direct POS Sync • Team TrueAddams</div>
        <script>window.onload = function() { window.print(); window.close(); }</script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

// ==========================================
// 4. MENU & INVENTORY MANAGER
// ==========================================

async function fetchMenu() {
  try {
    const res = await fetch('/api/menu');
    const data = await res.json();
    KDS.categories = data.categories || [];
    KDS.menuItems = data.items || [];
  } catch (err) {
    console.error('Error fetching menu:', err);
  }
}

async function loadAdminMenu() {
  await fetchMenu();
  const tbody = document.getElementById('adminMenuTableBody');
  if (!tbody) return;

  const catMap = {};
  KDS.categories.forEach(c => { catMap[c.id] = c.name; });

  tbody.innerHTML = KDS.menuItems.map(item => {
    const cost = item.cost_price || (item.price * 0.35);
    const profit = Math.max(0, item.price - cost);
    const marginPct = Math.round((profit / Math.max(1, item.price)) * 100);

    return `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3.5 px-4 flex items-center gap-2.5">
          <img src="${item.image_url}" alt="${item.name}" class="w-10 h-10 rounded-xl object-cover border border-slate-200 shadow-sm">
          <div>
            <div class="font-bold text-slate-900 flex items-center gap-1.5">
              <span class="diet-icon ${item.veg ? 'veg' : 'non-veg'}"></span>
              <span>${item.name}</span>
            </div>
            <div class="text-[10px] text-slate-500 font-medium truncate max-w-xs">${item.description || 'No description'}</div>
          </div>
        </td>
        <td class="py-3.5 px-4 text-slate-600 font-semibold">${catMap[item.category_id] || 'General'}</td>
        <td class="py-3.5 px-4">
          <div class="flex items-center gap-1">
            <span class="text-slate-400 font-bold">₹</span>
            <input type="number" step="0.5" value="${item.price}" onchange="handlePriceUpdate(${item.id}, this.value)" class="w-20 bg-slate-50 border border-slate-200 text-slate-900 px-2 py-1 rounded-xl text-xs font-bold text-center focus:outline-none focus:border-brand-500 focus:bg-white shadow-sm">
          </div>
        </td>
        <td class="py-3.5 px-4">
          <div class="font-mono text-xs text-slate-600">Cost: ₹${cost.toFixed(1)}</div>
          <div class="text-[10px] font-bold text-emerald-700 font-mono">${marginPct}% margin (+₹${profit.toFixed(1)})</div>
        </td>
        <td class="py-3.5 px-4 text-slate-600">
          <div>${item.calories || 250} kcal • ~${item.prep_time_minutes}m</div>
          <div class="text-[10px] text-slate-400">Allergens: ${item.allergens || 'None'}</div>
        </td>
        <td class="py-3.5 px-4">
          <button onclick="handleBestsellerToggle(${item.id}, ${!item.is_bestseller})" class="px-2.5 py-1 rounded-xl text-[10px] font-extrabold border transition-all ${item.is_bestseller ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-800'}">
            ${item.is_bestseller ? 'Bestseller' : 'Standard'}
          </button>
        </td>
        <td class="py-3.5 px-4 text-center">
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" class="sr-only peer" ${item.is_available ? 'checked' : ''} onchange="toggleItemStock(${item.id}, this.checked)">
            <div class="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500 shadow-inner"></div>
          </label>
        </td>
        <td class="py-3.5 px-4 text-right">
          <button onclick="openEditDishModal(${item.id})" class="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all shadow-sm">
            Edit
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function openEditDishModal(itemId) {
  const item = KDS.menuItems.find(i => i.id === itemId);
  if (!item) return;

  document.getElementById('editDishId').value = item.id;
  document.getElementById('editDishName').value = item.name || '';
  document.getElementById('editDishDesc').value = item.description || '';
  document.getElementById('editDishCategory').value = item.category_id || 1;
  document.getElementById('editDishPrice').value = item.price;
  document.getElementById('editDishCost').value = item.cost_price || (item.price * 0.35);
  document.getElementById('editDishSpice').value = item.spice_level || 'Medium';
  document.getElementById('editDishCalories').value = item.calories || 250;
  document.getElementById('editDishAllergens').value = item.allergens || 'None';
  document.getElementById('editDishBestseller').checked = Boolean(item.is_bestseller);
  document.getElementById('editDishAvailable').checked = Boolean(item.is_available);

  calculateMarginPreview();
  openModal('editDishModal');
}

function calculateMarginPreview() {
  const price = parseFloat(document.getElementById('editDishPrice')?.value || 0);
  const cost = parseFloat(document.getElementById('editDishCost')?.value || 0);
  const notice = document.getElementById('editDishMarginNotice');
  if (!notice) return;

  const profit = Math.max(0, price - cost);
  const pct = price > 0 ? Math.round((profit / price) * 100) : 0;
  notice.innerHTML = `
    <span>Profit Margin: ₹${profit.toFixed(2)}</span>
    <span class="font-bold ${pct >= 50 ? 'text-emerald-400' : 'text-amber-400'}">${pct}% Margin</span>
  `;
}

async function handleSaveEditDish(e) {
  e.preventDefault();
  const itemId = parseInt(document.getElementById('editDishId').value, 10);
  const name = document.getElementById('editDishName').value.trim();
  const description = document.getElementById('editDishDesc').value.trim();
  const category_id = parseInt(document.getElementById('editDishCategory').value, 10);
  const price = parseFloat(document.getElementById('editDishPrice').value);
  const cost_price = parseFloat(document.getElementById('editDishCost').value);
  const spice_level = document.getElementById('editDishSpice').value;
  const calories = parseInt(document.getElementById('editDishCalories').value, 10) || 250;
  const allergens = document.getElementById('editDishAllergens').value.trim();
  const is_bestseller = document.getElementById('editDishBestseller').checked;
  const is_available = document.getElementById('editDishAvailable').checked;

  try {
    const res = await fetch(`/api/admin/menu/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, description, category_id, price, cost_price, spice_level, calories, allergens, is_bestseller, is_available
      })
    });
    if (!res.ok) throw new Error('Update failed');
    closeAllModals();
    await loadAdminMenu();
    alert(`Dish '${name}' updated successfully!`);
  } catch (err) {
    alert('Failed to update dish details.');
  }
}

async function handlePriceUpdate(itemId, newPrice) {
  try {
    await fetch(`/api/admin/menu/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: parseFloat(newPrice) })
    });
    const item = KDS.menuItems.find(i => i.id === itemId);
    if (item) item.price = parseFloat(newPrice);
  } catch (err) {
    alert('Failed to update price');
  }
}

async function handleBestsellerToggle(itemId, isBestseller) {
  try {
    await fetch(`/api/admin/menu/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_bestseller: isBestseller })
    });
    const item = KDS.menuItems.find(i => i.id === itemId);
    if (item) item.is_bestseller = isBestseller ? 1 : 0;
    loadAdminMenu();
  } catch (err) {
    alert('Failed to toggle bestseller status');
  }
}

async function toggleItemStock(itemId, isAvailable) {
  try {
    const res = await fetch(`/api/menu/${itemId}/toggle-stock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_available: isAvailable })
    });
    if (!res.ok) throw new Error('Toggle failed');
    const item = KDS.menuItems.find(i => i.id === itemId);
    if (item) item.is_available = isAvailable ? 1 : 0;
  } catch (err) {
    alert('Failed to update item availability.');
  }
}

async function handleCreateDish(e) {
  e.preventDefault();
  const name = document.getElementById('newDishName').value.trim();
  const category_id = parseInt(document.getElementById('newDishCategory').value, 10);
  const price = parseFloat(document.getElementById('newDishPrice').value);
  const cost_price = parseFloat(document.getElementById('newDishCost')?.value || (price * 0.35));
  const description = document.getElementById('newDishDesc').value.trim();
  const veg = parseInt(document.getElementById('newDishVeg').value, 10);
  const spice_level = document.getElementById('newDishSpice').value;
  const prep_time_minutes = parseInt(document.getElementById('newDishPrepTime').value, 10) || 15;
  const calories = parseInt(document.getElementById('newDishCalories').value, 10) || 300;
  const allergens = document.getElementById('newDishAllergens').value.trim() || 'None';
  const image_url = document.getElementById('newDishImage').value.trim() || 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=60';

  try {
    const res = await fetch('/api/admin/menu/item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id, name, description, price, cost_price, veg, spice_level, prep_time_minutes, calories, allergens, image_url
      })
    });
    if (res.ok) {
      closeAllModals();
      loadAdminMenu();
      alert(`'${name}' added to live menu!`);
    } else {
      alert('Failed to add dish.');
    }
  } catch (err) {
    alert('Failed to add dish.');
  }
}

// ==========================================
// 5. PROMOS & RETENTION ENGINE
// ==========================================

async function loadAdminPromos() {
  try {
    const res = await fetch('/api/admin/promos');
    const data = await res.json();
    KDS.promos = data.promos || [];
    renderAdminPromos();
  } catch (e) {}
}

function syncPromoTierVisits(tier) {
  const input = document.getElementById('newPromoMinVisits');
  if (!input) return;
  if (tier === 'FIRST_TIME' || tier === 'ALL') input.value = 0;
  else if (tier === 'REPEAT') input.value = 1;
  else if (tier === 'REGULAR') input.value = 3;
  else if (tier === 'VIP') input.value = 5;
}

function renderAdminPromos() {
  const container = document.getElementById('adminPromosList');
  if (!container) return;

  container.innerHTML = KDS.promos.map(p => {
    const isBounceBack = p.code.startsWith('BACK50-');
    const isUsed = Boolean(p.is_used);
    const tier = p.customer_tier || 'ALL';
    const tierLabel = tier === 'FIRST_TIME' ? '1st Order Only' : tier === 'REPEAT' ? 'Repeat 1+ Visits' : tier === 'REGULAR' ? 'Regular 3+ Visits' : tier === 'VIP' ? 'VIP 5+ Visits' : 'All Diners';
    const marginShare = p.max_margin_share_pct || 50;

    return `
      <div class="bg-white border border-slate-200/90 rounded-2xl p-4 space-y-3 relative overflow-hidden shadow-sm hover:shadow-md transition-all">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-mono font-black text-sm text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-xl">
              ${p.code}
            </span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              ${tierLabel}
            </span>
          </div>
          <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${isUsed ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}">
            ${isUsed ? 'Redeemed' : 'Active'}
          </span>
        </div>
        <div class="text-xs space-y-1">
          <div class="font-bold text-slate-900 text-sm">
            ${p.title || (p.discount_type === 'PERCENT' ? `${p.discount_value}% OFF` : `₹${p.discount_value} FLAT OFF`)}
          </div>
          <div class="text-xs text-slate-600 font-semibold">
            ${p.discount_type === 'PERCENT' ? `${p.discount_value}% Discount` : `₹${p.discount_value} Flat Discount`}
            <span class="text-slate-400 font-normal"> (Min order ₹${p.min_order_value})</span>
          </div>
          <div class="text-[11px] text-slate-500">
            ${p.description || (isBounceBack ? '7-Day Customer Bounce-Back Voucher' : 'Loyalty Reward Voucher')}
          </div>
          <div class="flex items-center justify-between text-[10px] pt-1.5 border-t border-slate-100 font-mono">
            <span class="text-emerald-700 font-bold">Margin Cap: ${marginShare}%</span>
            <span class="text-slate-400">Exp: ${p.expires_at || 'Never'}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function handleCreatePromo(e) {
  e.preventDefault();
  const code = document.getElementById('newPromoCode').value.trim();
  const title = (document.getElementById('newPromoTitle')?.value || '').trim();
  const description = (document.getElementById('newPromoDesc')?.value || '').trim();
  const customer_tier = (document.getElementById('newPromoTier')?.value || 'ALL').toUpperCase();
  const min_visits = parseInt(document.getElementById('newPromoMinVisits')?.value || 0, 10);
  const max_margin_share_pct = parseFloat(document.getElementById('newPromoMarginShare')?.value || 50.0);
  const discount_type = document.getElementById('newPromoType').value;
  const discount_value = parseFloat(document.getElementById('newPromoVal').value);
  const min_order_value = parseFloat(document.getElementById('newPromoMinOrder').value);
  const max_discount = parseFloat(document.getElementById('newPromoMaxDisc').value);
  const expires_in_days = parseInt(document.getElementById('newPromoDays').value, 10);

  try {
    const res = await fetch('/api/admin/promos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        title,
        description,
        customer_tier,
        min_visits,
        max_margin_share_pct,
        discount_type,
        discount_value,
        min_order_value,
        max_discount,
        expires_in_days
      })
    });
    if (res.ok) {
      closeAllModals();
      loadAdminPromos();
      alert(`Loyalty promo code '${code}' is now live with margin protection!`);
    } else {
      const data = await res.json();
      alert(data.detail || 'Failed to create promo code.');
    }
  } catch (err) {
    alert('Failed to create promo code.');
  }
}

// ==========================================
// 6. STORE PROFILE & LOCAL SETTINGS
// ==========================================

async function loadAdminSettings() {
  try {
    const res = await fetch('/api/store/settings');
    if (!res.ok) return;
    const data = await res.json();
    const st = data.settings;
    if (!st) return;

    if (document.getElementById('settingStoreName')) document.getElementById('settingStoreName').value = st.store_name || '';
    if (document.getElementById('settingTagline')) document.getElementById('settingTagline').value = st.tagline || '';
    if (document.getElementById('settingDescription')) document.getElementById('settingDescription').value = st.description || '';
    if (document.getElementById('settingLocationName')) document.getElementById('settingLocationName').value = st.location_name || '';
    if (document.getElementById('settingFullAddress')) document.getElementById('settingFullAddress').value = st.full_address || '';
    if (document.getElementById('settingOpeningHours')) document.getElementById('settingOpeningHours').value = st.opening_hours || '';
    if (document.getElementById('settingPhone')) document.getElementById('settingPhone').value = st.phone || '';
    if (document.getElementById('settingAnnouncement')) document.getElementById('settingAnnouncement').value = st.announcement || '';
  } catch (err) {
    console.error('Failed to load store settings:', err);
  }
}

async function saveStoreSettings(e) {
  if (e) e.preventDefault();
  const payload = {
    store_name: document.getElementById('settingStoreName').value.trim(),
    tagline: document.getElementById('settingTagline').value.trim(),
    description: document.getElementById('settingDescription').value.trim(),
    location_name: document.getElementById('settingLocationName').value.trim(),
    full_address: document.getElementById('settingFullAddress').value.trim(),
    opening_hours: document.getElementById('settingOpeningHours').value.trim(),
    phone: document.getElementById('settingPhone').value.trim(),
    announcement: document.getElementById('settingAnnouncement').value.trim()
  };

  try {
    const res = await fetch('/api/admin/store/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      alert('Store Profile, Branding & Local Location saved successfully!');
    } else {
      alert('Failed to save store settings.');
    }
  } catch (err) {
    alert('Error saving store settings.');
  }
}

// ==========================================
// 7. ADVANCE CAPACITY PLANNER
// ==========================================

async function loadDateCapacity(dateStr) {
  KDS.selectedDate = dateStr;
  try {
    const res = await fetch(`/api/slots?date=${dateStr}`);
    const data = await res.json();
    KDS.slots = data.slots || [];
    renderCapacityList();
  } catch (err) {}
}

function renderCapacityList() {
  const container = document.getElementById('capacitySlotsList');
  if (!container) return;

  container.innerHTML = KDS.slots.map(slot => `
    <div class="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200 hover:bg-slate-100/60 transition-all">
      <div>
        <strong class="text-xs text-slate-800 font-extrabold">${slot.slot_time}</strong>
        <span class="text-[11px] text-slate-500 ml-2 font-mono">
          Booked: <strong class="${slot.is_full ? 'text-rose-600' : 'text-emerald-600'}">${slot.current_orders_count}</strong> / ${slot.max_capacity}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-slate-500 font-medium">Max Orders:</span>
        <input type="number" min="0" max="50" value="${slot.max_capacity}" onchange="saveSlotCapacity('${slot.slot_date}', '${slot.slot_time}', this.value)" class="w-16 bg-white border border-slate-200 text-slate-800 text-xs rounded-xl px-2 py-1 text-center font-bold focus:outline-none focus:border-brand-500 shadow-sm">
      </div>
    </div>
  `).join('');
}

async function saveSlotCapacity(date, time, newCap) {
  try {
    await fetch('/api/slots/capacity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot_date: date, slot_time: time, max_capacity: parseInt(newCap, 10) })
    });
  } catch (err) {}
}

// ==========================================
// 8. BUSINESS ANALYTICS
// ==========================================

async function loadAdminAnalytics() {
  try {
    const res = await fetch('/api/admin/analytics');
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('metricGrossRev').textContent = `₹${data.total_gross_revenue}`;
    document.getElementById('metricTotalOrders').textContent = data.total_orders;
    document.getElementById('metricAOV').textContent = `₹${data.average_order_value}`;
    document.getElementById('metricRetentionRate').textContent = data.retention_coupons.redemption_rate;
    document.getElementById('metricRetentionSub').textContent = `${data.retention_coupons.redeemed} redeemed of ${data.retention_coupons.issued} issued`;

    // Order Channels
    const channelsEl = document.getElementById('orderChannelBreakdown');
    if (channelsEl && data.type_breakdown) {
      const types = [
        { key: 'DINE_IN', label: 'Dine-In (Table QR)', color: 'bg-amber-500' },
        { key: 'TAKEAWAY', label: 'Express Takeaway', color: 'bg-sky-500' },
        { key: 'DELIVERY', label: 'Local Delivery', color: 'bg-purple-500' }
      ];

      channelsEl.innerHTML = types.map(t => {
        const item = data.type_breakdown[t.key] || { count: 0, revenue: 0 };
        const pct = data.total_orders ? Math.round((item.count / data.total_orders) * 100) : 0;
        return `
          <div class="space-y-1">
            <div class="flex justify-between text-xs font-bold">
              <span class="text-slate-600">${t.label}</span>
              <span class="text-slate-900 font-extrabold">${item.count} orders (₹${item.revenue})</span>
            </div>
            <div class="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div class="h-full ${t.color}" style="width: ${pct}%;"></div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Top Dishes
    const topDishesEl = document.getElementById('topDishesList');
    if (topDishesEl && data.top_dishes) {
      topDishesEl.innerHTML = data.top_dishes.map((d, idx) => `
        <div class="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs">
          <div class="flex items-center gap-2 font-bold text-slate-800">
            <span class="w-5 h-5 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center text-[10px] font-mono border border-brand-200 font-bold">${idx + 1}</span>
            <span>${d.name}</span>
          </div>
          <span class="font-mono text-emerald-700 font-extrabold">${d.sold_count} sold</span>
        </div>
      `).join('');
    }
  } catch (err) {}
}

// ==========================================
// 9. TABLE QR GENERATOR & MODAL UTILITIES
// ==========================================

function openQRModal() {
  updateQRPreview();
  openModal('qrModal');
}

function updateQRPreview() {
  const type = document.getElementById('qrTypeSelect').value;
  const tableNum = document.getElementById('qrTableInput').value.trim() || '1';
  const holder = document.getElementById('qrSvgHolder');
  const labelEl = document.getElementById('qrCardLabel');

  const origin = window.location.origin;
  let targetUrl = `${origin}/`;

  if (type === 'TABLE') {
    targetUrl += `?table=${tableNum}`;
    if (labelEl) labelEl.textContent = `TABLE #${tableNum}`;
  } else if (type === 'TAKEAWAY') {
    targetUrl += `?mode=TAKEAWAY`;
    if (labelEl) labelEl.textContent = `TAKEAWAY COUNTER`;
  } else {
    if (labelEl) labelEl.textContent = `SCAN FOR MENU`;
  }

  if (window.QRCodeGenerator && holder) {
    holder.innerHTML = window.QRCodeGenerator.generateSVG(targetUrl, 160);
  }
}

function printQRCodeCard() {
  const card = document.getElementById('qrPrintableCard');
  if (!card) return;

  const cardLabelEl = document.getElementById('qrCardLabel');
  const svgHolderEl = document.getElementById('qrSvgHolder');
  if (!cardLabelEl || !svgHolderEl) {
    alert('Please preview the QR code before printing.');
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Popup window blocked. Please allow popups to print table QR cards.');
    return;
  }
  printWindow.document.write(`
    <html>
      <head>
        <title>RasoiLink Table QR Code</title>
        <style>
          body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 90vh; margin: 0; }
          .card { border: 3px solid #E65100; border-radius: 12px; padding: 24px; text-align: center; width: 280px; }
          .title { font-size: 22px; font-weight: 800; color: #E65100; margin-bottom: 6px; }
          .label { font-size: 26px; font-weight: 900; margin-bottom: 14px; }
          .sub { font-size: 13px; color: #555; margin-top: 10px; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="title">RasoiLink</div>
          <div class="label">${cardLabelEl.textContent || 'Table'}</div>
          ${svgHolderEl.innerHTML}
          <div class="sub">Scan with phone camera to browse menu & order directly!</div>
        </div>
        <script>window.onload = function() { window.print(); window.close(); }</script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function setupModals() {
  const backdrop = document.getElementById('kdsModalBackdrop');
  if (backdrop) backdrop.addEventListener('click', closeAllModals);
}

function openModal(id) {
  const backdrop = document.getElementById('kdsModalBackdrop');
  const modal = document.getElementById(id);
  if (backdrop && modal) {
    backdrop.classList.remove('opacity-0', 'pointer-events-none');
    backdrop.classList.add('opacity-100', 'pointer-events-auto');
    modal.classList.remove('opacity-0', 'pointer-events-none');
    modal.classList.add('opacity-100', 'pointer-events-auto');
  }
}

function closeAllModals() {
  const backdrop = document.getElementById('kdsModalBackdrop');
  if (backdrop) {
    backdrop.classList.add('opacity-0', 'pointer-events-none');
    backdrop.classList.remove('opacity-100', 'pointer-events-auto');
  }
  document.querySelectorAll('#addDishModal, #editDishModal, #createPromoModal, #qrModal, #audioSettingsModal, #addOutletModal').forEach(m => {
    m.classList.add('opacity-0', 'pointer-events-none');
    m.classList.remove('opacity-100', 'pointer-events-auto');
  });
}

// ==========================================
// 10. MULTI-RESTAURANT OUTLET MANAGEMENT
// ==========================================

async function loadAdminOutlets() {
  try {
    const res = await fetch('/api/restaurants?active_only=false');
    if (!res.ok) return;
    const data = await res.json();
    KDS.outlets = data.restaurants || [];
    renderAdminOutlets();
  } catch (err) {
    console.error('Failed to load outlets:', err);
  }
}

function renderAdminOutlets() {
  const container = document.getElementById('adminOutletsGrid');
  if (!container) return;

  if (!KDS.outlets || KDS.outlets.length === 0) {
    container.innerHTML = `
      <div class="col-span-2 text-center py-12 text-slate-500">
        <p class="text-sm font-semibold">No outlets found.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = KDS.outlets.map(o => {
    const isActive = Boolean(o.is_active);
    return `
      <div class="bg-white border border-slate-200/90 rounded-3xl p-5 space-y-4 shadow-sm hover:shadow-md transition-all">
        <div class="flex items-start gap-4">
          <img src="${o.image_url || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&auto=format&fit=crop&q=60'}" alt="${o.name}" class="w-24 h-24 rounded-2xl object-cover border border-slate-200 shadow-sm flex-shrink-0">
          <div class="space-y-1 flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-base font-extrabold text-slate-900 truncate">${o.name}</h3>
              <span class="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full ${isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}">
                ${isActive ? 'Active' : 'Offline'}
              </span>
            </div>
            <p class="text-xs text-brand-700 font-semibold truncate">${o.tagline || o.cuisine_type || ''}</p>
            <div class="flex items-center gap-2 text-[11px] text-slate-500 pt-0.5">
              <span class="inline-flex items-center gap-1 font-bold text-slate-700">
                <i data-lucide="star" class="w-3.5 h-3.5 text-amber-500 fill-amber-500"></i>
                ${o.rating || 4.9} (${o.reviews_count || 1200})
              </span>
              <span>•</span>
              <span>${o.delivery_time_mins || '25-35m'}</span>
              <span>•</span>
              <span>${o.price_for_two || '₹350 for two'}</span>
            </div>
            <div class="text-[11px] text-slate-500 flex items-center gap-1 truncate pt-0.5">
              <i data-lucide="map-pin" class="w-3 h-3 text-brand-600 flex-shrink-0"></i>
              <span class="truncate">${o.location_name} • ${o.city}</span>
            </div>
          </div>
        </div>

        <div class="bg-slate-50 rounded-2xl p-3 border border-slate-100 text-xs space-y-1 text-slate-600">
          <div class="flex items-center justify-between">
            <span class="font-semibold">Full Address:</span>
            <span class="text-slate-800 text-right truncate max-w-[280px]">${o.full_address}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="font-semibold">Phone:</span>
            <span class="text-slate-800 font-mono">${o.phone}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="font-semibold">Hours:</span>
            <span class="text-slate-800">${o.opening_hours}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="font-semibold">Tables:</span>
            <span class="text-slate-800 font-mono font-bold">${o.table_count || 20} Tables</span>
          </div>
        </div>

        <div class="flex items-center justify-between pt-1">
          <button onclick="switchOutletKDS('${o.id}')" class="px-3.5 py-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm">
            <i data-lucide="layout-grid" class="w-3.5 h-3.5"></i>
            <span>View KDS for Outlet</span>
          </button>
          <button onclick="toggleOutletActive('${o.id}', ${!isActive})" class="px-3.5 py-1.5 ${isActive ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-emerald-600 hover:bg-emerald-700 text-white'} rounded-xl text-xs font-bold transition-all shadow-sm">
            ${isActive ? 'Set Offline' : 'Set Active'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

async function handleCreateOutlet(e) {
  e.preventDefault();
  const name = document.getElementById('newOutletName').value.trim();
  const id = document.getElementById('newOutletId').value.trim() || name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 18);
  const location_name = document.getElementById('newOutletLocation').value.trim();
  const full_address = document.getElementById('newOutletAddress').value.trim();
  const city = document.getElementById('newOutletCity').value.trim() || 'New Delhi';
  const phone = document.getElementById('newOutletPhone').value.trim();
  const cuisine_type = document.getElementById('newOutletCuisine').value.trim();
  const opening_hours = document.getElementById('newOutletHours').value.trim();
  const table_count = parseInt(document.getElementById('newOutletTables').value || 20, 10);
  const delivery_time_mins = document.getElementById('newOutletDeliveryTime').value.trim() || '25-35 mins';
  const image_url = document.getElementById('newOutletImage').value.trim();

  try {
    const res = await fetch('/api/admin/restaurants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name,
        location_name,
        full_address,
        city,
        phone,
        cuisine_type,
        opening_hours,
        table_count,
        delivery_time_mins,
        image_url: image_url || undefined
      })
    });
    if (res.ok) {
      alert('Restaurant outlet registered successfully!');
      closeAllModals();
      await loadAdminOutlets();
      updateOutletDropdownOptions();
    } else {
      const err = await res.json();
      alert(`Failed to add outlet: ${err.detail || 'Unknown error'}`);
    }
  } catch (err) {
    alert('Failed to register restaurant outlet.');
  }
}

async function toggleOutletActive(outletId, newActive) {
  try {
    const res = await fetch(`/api/admin/restaurants/${outletId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: newActive })
    });
    if (res.ok) {
      await loadAdminOutlets();
    }
  } catch (err) {}
}

function changeOutletFilter(outletId) {
  KDS.selectedOutlet = outletId;
  fetchOrders();
  fetchStats();
}

function switchOutletKDS(outletId) {
  KDS.selectedOutlet = outletId;
  const sel = document.getElementById('outletFilterSelect');
  if (sel) sel.value = outletId;
  switchDashboardTab('TICKETS');
  fetchOrders();
  fetchStats();
}

async function updateOutletDropdownOptions() {
  try {
    const res = await fetch('/api/restaurants?active_only=false');
    if (!res.ok) return;
    const data = await res.json();
    const sel = document.getElementById('outletFilterSelect');
    if (!sel) return;
    const currentVal = sel.value;
    let html = '<option value="ALL">All Outlets (Network-wide)</option>';
    (data.restaurants || []).forEach(o => {
      html += `<option value="${o.id}">${o.name}</option>`;
    });
    sel.innerHTML = html;
    if (currentVal) sel.value = currentVal;
  } catch (e) {}
}

// ==========================================
// 4. AI MARKETING AUTOPILOT
// ==========================================
async function loadAdminMarketing() {
  const container = document.getElementById('marketingTabContent');
  if (!container) return;

  container.innerHTML = `
    <div class="text-center py-12 text-sm text-slate-500">
      <div class="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
      Analyzing customer purchase frequency, recency, and generating WhatsApp campaigns...
    </div>
  `;

  try {
    const [segResp, campResp] = await Promise.all([
      fetch('/api/marketing/segments'),
      fetch('/api/marketing/campaigns')
    ]);

    if (!segResp.ok || !campResp.ok) throw new Error('Failed to load marketing data');
    const segData = await segResp.json();
    const campData = await campResp.json();

    const sum = segData.segments_summary || {};

    container.innerHTML = `
      <div class="space-y-6">
        <!-- RFM Segment Summary Cards -->
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div class="bg-white border border-rose-200 rounded-2xl p-3.5 shadow-xs space-y-1">
            <span class="text-[10px] font-black text-rose-700 uppercase tracking-wider block">Churn Risk</span>
            <div class="text-2xl font-black text-rose-900">${sum.CHURN_RISK || 0}</div>
            <span class="text-[10px] text-slate-400 font-medium">Inactive 7+ days</span>
          </div>

          <div class="bg-white border border-purple-200 rounded-2xl p-3.5 shadow-xs space-y-1">
            <span class="text-[10px] font-black text-purple-700 uppercase tracking-wider block">VIP Loyalists</span>
            <div class="text-2xl font-black text-purple-900">${sum.VIP_LOYALISTS || 0}</div>
            <span class="text-[10px] text-slate-400 font-medium">Top lifetime spend</span>
          </div>

          <div class="bg-white border border-orange-200 rounded-2xl p-3.5 shadow-xs space-y-1">
            <span class="text-[10px] font-black text-orange-700 uppercase tracking-wider block">Biryani Squad</span>
            <div class="text-2xl font-black text-orange-900">${sum.BIRYANI_LOVERS || 0}</div>
            <span class="text-[10px] text-slate-400 font-medium">Dum Biryani lovers</span>
          </div>

          <div class="bg-white border border-amber-200 rounded-2xl p-3.5 shadow-xs space-y-1">
            <span class="text-[10px] font-black text-amber-700 uppercase tracking-wider block">Chai Regulars</span>
            <div class="text-2xl font-black text-amber-900">${sum.CHAI_SQUAD || 0}</div>
            <span class="text-[10px] text-slate-400 font-medium">Daily tapri patrons</span>
          </div>

          <div class="bg-white border border-blue-200 rounded-2xl p-3.5 shadow-xs space-y-1">
            <span class="text-[10px] font-black text-blue-700 uppercase tracking-wider block">Weekend Club</span>
            <div class="text-2xl font-black text-blue-900">${sum.WEEKEND_REGULARS || 0}</div>
            <span class="text-[10px] text-slate-400 font-medium">Fri–Sun diners</span>
          </div>

          <div class="bg-white border border-emerald-200 rounded-2xl p-3.5 shadow-xs space-y-1">
            <span class="text-[10px] font-black text-emerald-700 uppercase tracking-wider block">1st-Timer Wins</span>
            <div class="text-2xl font-black text-emerald-900">${sum.FIRST_TIMER_WINBACK || 0}</div>
            <span class="text-[10px] text-slate-400 font-medium">1st visit convert</span>
          </div>
        </div>

        <!-- 2 Column Campaign Launcher & Live WhatsApp Mockup -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <!-- Campaign Setup Form (7 Cols) -->
          <div class="lg:col-span-7 bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 class="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <i data-lucide="sparkles" class="w-4 h-4 text-emerald-600"></i>
                <span>AI WhatsApp Campaign Generator</span>
              </h3>
              <span class="text-[11px] font-extrabold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                100% Commission-Free
              </span>
            </div>

            <form onsubmit="event.preventDefault(); deployMarketingCampaign();" class="space-y-3.5 text-xs">
              <div>
                <label class="block font-bold text-slate-700 mb-1">Campaign Name</label>
                <input type="text" id="mktCampaignName" required value="Weekend Chai & Biryani Win-Back" class="w-full bg-slate-50 border border-slate-200 text-slate-900 px-3.5 py-2.5 rounded-2xl focus:outline-none focus:border-brand-500 font-medium">
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block font-bold text-slate-700 mb-1">Target Customer Segment</label>
                  <select id="mktTargetSegment" onchange="updateLiveWhatsAppPreview()" class="w-full bg-slate-50 border border-slate-200 text-slate-900 px-3 py-2.5 rounded-2xl focus:outline-none focus:border-brand-500 font-semibold">
                    <option value="CHURN_RISK">⚠️ Churn Risk (Inactive patrons)</option>
                    <option value="VIP_LOYALISTS">👑 VIP Loyalists (Top spenders)</option>
                    <option value="BIRYANI_LOVERS">🍛 Biryani Lovers</option>
                    <option value="CHAI_SQUAD" selected>☕ Chai Squad Regulars</option>
                    <option value="WEEKEND_REGULARS">🥳 Weekend Regulars</option>
                    <option value="FIRST_TIMER_WINBACK">🎁 First-Timer 2nd Visit Offer</option>
                    <option value="ALL">🌐 Broadcast All Customers</option>
                  </select>
                </div>
                <div>
                  <label class="block font-bold text-slate-700 mb-1">AI Tone of Voice</label>
                  <select id="mktTone" onchange="updateLiveWhatsAppPreview()" class="w-full bg-slate-50 border border-slate-200 text-slate-900 px-3 py-2.5 rounded-2xl focus:outline-none focus:border-brand-500 font-semibold">
                    <option value="TAPRI_HINGLISH" selected>🔥 Tapri Hinglish (High Desi Conversion)</option>
                    <option value="FRIENDLY">😊 Warm & Welcoming Cafe</option>
                    <option value="URGENT_FOMO">⚡ Flash FOMO (Expires Tonight)</option>
                    <option value="FESTIVE">🎉 Festive Special Greetings</option>
                  </select>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block font-bold text-slate-700 mb-1">Offer Discount (%)</label>
                  <input type="number" id="mktDiscountPct" min="5" max="60" value="25" oninput="updateLiveWhatsAppPreview()" class="w-full bg-slate-50 border border-slate-200 text-slate-900 px-3.5 py-2.5 rounded-2xl focus:outline-none focus:border-brand-500 font-mono font-bold">
                </div>
                <div>
                  <label class="block font-bold text-slate-700 mb-1">Promo Voucher Code</label>
                  <input type="text" id="mktPromoCode" value="CHAI25" oninput="updateLiveWhatsAppPreview()" class="w-full bg-slate-50 border border-slate-200 text-slate-900 px-3.5 py-2.5 rounded-2xl focus:outline-none focus:border-brand-500 font-mono font-black uppercase">
                </div>
              </div>

              <div class="pt-2">
                <button type="submit" class="w-full py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold text-xs rounded-2xl shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-2">
                  <i data-lucide="send" class="w-4 h-4"></i>
                  <span>Deploy Campaign & Generate WhatsApp Dispatches</span>
                </button>
              </div>
            </form>
          </div>

          <!-- Live WhatsApp Preview Card (5 Cols) -->
          <div class="lg:col-span-5 bg-slate-900 text-white rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col justify-between space-y-4 relative overflow-hidden">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3">
              <div class="flex items-center gap-2">
                <div class="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs">
                  <i data-lucide="message-circle" class="w-4 h-4"></i>
                </div>
                <div>
                  <span class="text-xs font-bold block text-slate-200">Live WhatsApp Preview</span>
                  <span class="text-[10px] text-emerald-400">Patron: Rahul Sharma (+91 98112...)</span>
                </div>
              </div>
              <span class="text-[10px] font-mono text-slate-400">10:32 AM</span>
            </div>

            <!-- Chat Bubble -->
            <div class="bg-[#0b141a] border border-[#222d34] rounded-2xl p-4 space-y-2 shadow-inner">
              <div id="mktWhatsAppBubble" class="text-xs text-slate-100 whitespace-pre-wrap leading-relaxed font-sans">
                <!-- Injected via updateLiveWhatsAppPreview -->
              </div>
              <div class="text-[10px] text-slate-400 text-right flex items-center justify-end gap-1">
                <span>10:32 AM</span>
                <span class="text-cyan-400 font-bold">✓✓</span>
              </div>
            </div>

            <!-- Actions -->
            <div class="space-y-2">
              <a id="btnTestWhatsAppLink" href="#" target="_blank" class="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm">
                <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
                <span>Test Click-to-Chat in WhatsApp Web / App</span>
              </a>
              <p class="text-[10px] text-slate-400 text-center">Simulates 1-to-1 personalized WhatsApp dispatch without third-party API costs.</p>
            </div>
          </div>
        </div>

        <!-- Past Campaigns History Grid -->
        <div class="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
          <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 class="text-sm font-extrabold text-slate-900 tracking-tight">Autopilot Campaign Performance & ROI</h3>
            <span class="text-xs text-slate-400 font-semibold">${campData.length} campaigns logged</span>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <thead>
                <tr class="bg-slate-50 border-b border-slate-200 text-[11px] font-black uppercase text-slate-500 tracking-wider">
                  <th class="py-3 px-4">Campaign Name</th>
                  <th class="py-3 px-3">Segment</th>
                  <th class="py-3 px-3 text-center">Promo Code</th>
                  <th class="py-3 px-3 text-right">Recipients</th>
                  <th class="py-3 px-3 text-right">Clicks</th>
                  <th class="py-3 px-3 text-right">Conversions</th>
                  <th class="py-3 px-4 text-right">Revenue Generated</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${campData.map((c) => {
                  return `
                    <tr class="hover:bg-slate-50/60 transition-colors">
                      <td class="py-3 px-4 font-bold text-slate-900">
                        <span>${c.campaign_name}</span>
                        <span class="block text-[10px] text-slate-400 font-normal truncate max-w-xs">${c.template_text.slice(0, 60)}...</span>
                      </td>
                      <td class="py-3 px-3 text-slate-600 font-semibold">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 border border-slate-200">${c.target_segment}</span>
                      </td>
                      <td class="py-3 px-3 text-center">
                        <span class="font-mono font-black text-brand-700 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">${c.promo_code}</span>
                      </td>
                      <td class="py-3 px-3 text-right font-mono font-bold text-slate-700">${c.total_recipients}</td>
                      <td class="py-3 px-3 text-right font-mono font-bold text-slate-700">${c.clicks_count}</td>
                      <td class="py-3 px-3 text-right font-mono font-black text-emerald-600">${c.conversions_count}</td>
                      <td class="py-3 px-4 text-right font-mono font-black text-slate-900">₹${c.revenue_generated.toLocaleString()}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    updateLiveWhatsAppPreview();
  } catch (e) {
    container.innerHTML = `<div class="p-6 bg-rose-50 text-rose-700 border border-rose-200 rounded-3xl text-xs font-bold">Failed to load Marketing Autopilot: ${e.message}</div>`;
  }
}

async function updateLiveWhatsAppPreview() {
  const segment = document.getElementById('mktTargetSegment') ? document.getElementById('mktTargetSegment').value : 'CHURN_RISK';
  const tone = document.getElementById('mktTone') ? document.getElementById('mktTone').value : 'TAPRI_HINGLISH';
  const discountPct = document.getElementById('mktDiscountPct') ? parseFloat(document.getElementById('mktDiscountPct').value || 20) : 20;
  const promoCode = document.getElementById('mktPromoCode') ? document.getElementById('mktPromoCode').value : 'CHAI20';

  try {
    const resp = await fetch(`/api/marketing/preview-offer?name=Rahul&phone=%2B919811234567&segment=${segment}&tone=${tone}&discount_pct=${discountPct}&promo_code=${promoCode}&favorite_dish=Masala%20Tapri%20Chai`, { method: 'POST' });
    if (!resp.ok) return;
    const data = await resp.json();

    const bubble = document.getElementById('mktWhatsAppBubble');
    const linkBtn = document.getElementById('btnTestWhatsAppLink');
    if (bubble) bubble.textContent = data.message_text;
    if (linkBtn) linkBtn.href = data.whatsapp_url;
  } catch (e) {}
}

async function deployMarketingCampaign() {
  const name = document.getElementById('mktCampaignName').value.trim();
  const segment = document.getElementById('mktTargetSegment').value;
  const tone = document.getElementById('mktTone').value;
  const discountPct = parseFloat(document.getElementById('mktDiscountPct').value || 20);
  const promoCode = document.getElementById('mktPromoCode').value.trim();

  try {
    const resp = await fetch('/api/marketing/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaign_name: name,
        target_segment: segment,
        tone: tone,
        discount_pct: discountPct,
        promo_code: promoCode
      })
    });

    if (!resp.ok) throw new Error('Failed to deploy campaign');
    const result = await resp.json();

    alert(`🎉 Campaign "${result.campaign_name}" Deployed!\n\nTarget Recipients: ${result.total_recipients}\nPromo Code Created: ${result.promo_code}\nEstimated Incremental Revenue: ₹${result.estimated_revenue_inr}`);
    loadAdminMarketing();
  } catch (e) {
    alert("Error deploying campaign: " + e.message);
  }
}

// ==========================================
// 5. GROUP HUNGER NETWORK MONITOR (KITCHEN)
// ==========================================
async function loadAdminGroupPools() {
  const container = document.getElementById('groupPoolsTabContent');
  if (!container) return;

  container.innerHTML = `
    <div class="text-center py-12 text-sm text-slate-500">
      <div class="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
      Loading active hostel, office, and society order pools...
    </div>
  `;

  try {
    const resp = await fetch('/api/group-pools');
    if (!resp.ok) throw new Error('Failed to load group pools');
    const pools = await resp.json();

    if (!pools.length) {
      container.innerHTML = `
        <div class="bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-3">
          <div class="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
            <i data-lucide="users" class="w-6 h-6"></i>
          </div>
          <h3 class="text-base font-extrabold text-slate-900">No Active Group Hunger Pools</h3>
          <p class="text-xs text-slate-500 max-w-md mx-auto">When college students or office teams combine food orders on the storefront, their live batch rooms will appear here.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    container.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        ${pools.map((p) => {
          const mins = Math.floor(p.seconds_remaining / 60);
          const secs = p.seconds_remaining % 60;
          const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

          return `
            <div class="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-4 hover:border-amber-400 transition-all">
              <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                <div class="space-y-0.5">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-xs font-black text-amber-900 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-300">#${p.pool_code}</span>
                    <span class="text-xs font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full">⏱ ${timeStr} left</span>
                  </div>
                  <h4 class="text-base font-black text-slate-900 pt-1">${p.title}</h4>
                </div>
                <span class="text-xs font-black bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full border border-emerald-200">${p.discount_tier_pct}% Tier Unlocked</span>
              </div>

              <div class="grid grid-cols-3 gap-2 text-center text-xs">
                <div class="bg-slate-50 p-2.5 rounded-2xl border border-slate-200/80">
                  <span class="text-[10px] text-slate-400 font-bold block uppercase">Pooled Amount</span>
                  <span class="font-black text-slate-900 text-sm">₹${p.current_amount.toFixed(0)}</span>
                </div>
                <div class="bg-slate-50 p-2.5 rounded-2xl border border-slate-200/80">
                  <span class="text-[10px] text-slate-400 font-bold block uppercase">Group Discount</span>
                  <span class="font-black text-emerald-600 text-sm">-₹${p.total_discount_amount.toFixed(0)}</span>
                </div>
                <div class="bg-slate-50 p-2.5 rounded-2xl border border-slate-200/80">
                  <span class="text-[10px] text-slate-400 font-bold block uppercase">Final Batch Bill</span>
                  <span class="font-black text-brand-600 text-sm">₹${p.total_final_amount.toFixed(0)}</span>
                </div>
              </div>

              <div class="text-xs text-slate-600 space-y-1 bg-amber-50/50 p-3 rounded-2xl border border-amber-200/60">
                <div class="flex items-center gap-1.5 font-bold text-slate-800">
                  <i data-lucide="map-pin" class="w-3.5 h-3.5 text-amber-600"></i>
                  <span>Delivery Drop-Off:</span>
                </div>
                <p class="text-[11px] text-slate-700 pl-5">${p.delivery_address}</p>
                <p class="text-[10px] text-slate-500 pl-5 font-medium">Host: ${p.creator_name} (${p.creator_phone})</p>
              </div>

              <!-- Participant Breakdown -->
              <div class="space-y-2">
                <span class="text-xs font-bold text-slate-700 uppercase tracking-wide block">Diners in Pool (${p.members_count})</span>
                <div class="space-y-1.5 max-h-40 overflow-y-auto">
                  ${(p.members || []).map((m) => `
                    <div class="p-2 bg-slate-50 border border-slate-200/70 rounded-xl flex items-center justify-between text-xs">
                      <div class="min-w-0 pr-2">
                        <span class="font-bold text-slate-900 block truncate">${m.participant_name}</span>
                        <span class="text-[10px] text-slate-500 block truncate">${(m.items || []).map(i => `${i.name} x${i.quantity}`).join(', ')}</span>
                      </div>
                      <span class="font-bold text-slate-900 flex-shrink-0">₹${m.final_amount.toFixed(0)}</span>
                    </div>
                  `).join('')}
                </div>
              </div>

              ${p.status === 'ACTIVE' ? `
                <button onclick="kitchenFinalizePool('${p.pool_code}')" class="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-extrabold shadow-sm transition-all flex items-center justify-center gap-1.5">
                  <i data-lucide="utensils" class="w-4 h-4"></i>
                  <span>Lock Pool & Push Consolidated Batch to KDS</span>
                </button>
              ` : `
                <div class="p-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-center text-xs font-bold">
                  ✓ Batch Finalized & Sent to Cookline (${p.order_code || 'RL-Active'})
                </div>
              `}
            </div>
          `;
        }).join('')}
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    container.innerHTML = `<div class="p-6 bg-rose-50 text-rose-700 border border-rose-200 rounded-3xl text-xs font-bold">Failed to load Group Pools: ${e.message}</div>`;
  }
}

async function kitchenFinalizePool(code) {
  if (!confirm(`Lock Group Pool #${code} and dispatch consolidated ticket to live cookline?`)) return;
  try {
    const resp = await fetch(`/api/group-pools/${code}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: "Dispatched from Operations Console" })
    });
    if (!resp.ok) throw new Error('Failed to finalize pool');
    alert(`🎉 Pool #${code} batch order dispatched to Kitchen KDS!`);
    loadAdminGroupPools();
    fetchOrders();
  } catch (e) {
    alert("Error: " + e.message);
  }
}

// ==========================================
// 6. BHARAT OFFLINE HUB DIAGNOSTICS (KITCHEN)
// ==========================================
async function loadAdminBharatOffline() {
  const container = document.getElementById('bharatOfflineTabContent');
  if (!container) return;

  container.innerHTML = `
    <div class="text-center py-12 text-sm text-slate-500">
      <div class="w-8 h-8 border-3 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
      Probing Bharat Offline Mode connectivity and SQLite WAL sync engine...
    </div>
  `;

  try {
    const currentOutlet = document.getElementById('outletFilterSelect') ? document.getElementById('outletFilterSelect').value : 'cp-artisan';
    const rid = (currentOutlet && currentOutlet !== 'ALL') ? currentOutlet : 'cp-artisan';

    const resp = await fetch(`/api/orders/offline-status?restaurant_id=${rid}`);
    if (!resp.ok) throw new Error('Failed to check offline status');
    const statusData = await resp.json();

    container.innerHTML = `
      <div class="space-y-6">
        <!-- Diagnostic Node Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-1">
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">Node Connectivity</span>
            <div class="text-2xl font-black text-emerald-600 flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-emerald-500 animate-ping"></span>
              <span>Online</span>
            </div>
            <p class="text-[11px] text-slate-400">Low-latency local network with background reconnect daemon</p>
          </div>

          <div class="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-1">
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">Offline Orders Synced</span>
            <div class="text-3xl font-black text-slate-900">${statusData.total_offline_synced}</div>
            <p class="text-[11px] text-slate-400">Total tickets placed during internet dropouts and safely auto-synced</p>
          </div>

          <div class="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-1">
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">Revenue Rescued</span>
            <div class="text-3xl font-black text-brand-600">₹${statusData.total_offline_revenue.toLocaleString()}</div>
            <p class="text-[11px] text-slate-400">Sales that would have failed on legacy cloud POS systems</p>
          </div>

          <div class="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-1">
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">Service Worker PWA</span>
            <div class="text-2xl font-black text-teal-600">Active v2.0</div>
            <p class="text-[11px] text-slate-400">Pre-caches menu, assets, and translations for zero-network startup</p>
          </div>
        </div>

        <!-- Regional Bharat Language Support Grid -->
        <div class="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
          <div class="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 class="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <i data-lucide="languages" class="w-4 h-4 text-brand-600"></i>
                <span>Regional Language & Voice Accessibility Matrix</span>
              </h3>
              <p class="text-xs text-slate-500">Multilingual dictionary and speech synthesis coverage across Bharat</p>
            </div>
            <span class="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">8 Indian Languages Active</span>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div class="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1">
              <span class="font-extrabold text-slate-900 block">English</span>
              <span class="text-[11px] text-slate-500 block">en-IN • Global Standard</span>
              <span class="text-[10px] text-emerald-600 font-bold">100% Dictionary • Voice Speech</span>
            </div>
            <div class="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1">
              <span class="font-extrabold text-slate-900 block">हिन्दी (Hindi)</span>
              <span class="text-[11px] text-slate-500 block">hi-IN • Devnagari Script</span>
              <span class="text-[10px] text-emerald-600 font-bold">100% Dictionary • Voice Speech</span>
            </div>
            <div class="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1">
              <span class="font-extrabold text-slate-900 block">हिंग्लिश (Hinglish)</span>
              <span class="text-[11px] text-slate-500 block">hi-IN • Street Tapri Dialect</span>
              <span class="text-[10px] text-emerald-600 font-bold">100% Conversational Dialect</span>
            </div>
            <div class="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1">
              <span class="font-extrabold text-slate-900 block">ગુજરાતી (Gujarati)</span>
              <span class="text-[11px] text-slate-500 block">gu-IN • Gujarati Script</span>
              <span class="text-[10px] text-emerald-600 font-bold">100% Dictionary • Voice Speech</span>
            </div>
            <div class="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1">
              <span class="font-extrabold text-slate-900 block">मराठी (Marathi)</span>
              <span class="text-[11px] text-slate-500 block">mr-IN • Maharashtra Dialect</span>
              <span class="text-[10px] text-emerald-600 font-bold">100% Dictionary • Voice Speech</span>
            </div>
            <div class="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1">
              <span class="font-extrabold text-slate-900 block">தமிழ் (Tamil)</span>
              <span class="text-[11px] text-slate-500 block">ta-IN • Tamil Script</span>
              <span class="text-[10px] text-emerald-600 font-bold">100% Dictionary • Voice Speech</span>
            </div>
            <div class="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1">
              <span class="font-extrabold text-slate-900 block">বাংলা (Bengali)</span>
              <span class="text-[11px] text-slate-500 block">bn-IN • Eastern Zone</span>
              <span class="text-[10px] text-emerald-600 font-bold">100% Dictionary • Voice Speech</span>
            </div>
            <div class="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1">
              <span class="font-extrabold text-slate-900 block">తెలుగు (Telugu)</span>
              <span class="text-[11px] text-slate-500 block">te-IN • Deccan South Zone</span>
              <span class="text-[10px] text-emerald-600 font-bold">100% Dictionary • Voice Speech</span>
            </div>
          </div>
        </div>

        <!-- Offline Queue Simulation Tool -->
        <div class="bg-gradient-to-r from-orange-50 via-amber-50 to-stone-50 border border-orange-200 rounded-3xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div class="space-y-1">
            <span class="text-xs font-black text-amber-950 uppercase tracking-wide">Simulate Bharat Offline Order Sync</span>
            <p class="text-xs text-stone-600 leading-relaxed">Click below to generate a mock offline queue item, verify idempotency, and test auto-flushing to SQLite WAL database.</p>
          </div>
          <button onclick="simulateBharatOfflineOrder()" class="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl text-xs font-extrabold shadow-sm transition-all flex items-center gap-2 flex-shrink-0">
            <i data-lucide="play" class="w-3.5 h-3.5"></i>
            <span>Simulate Offline Order & Auto-Sync</span>
          </button>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    container.innerHTML = `<div class="p-6 bg-rose-50 text-rose-700 border border-rose-200 rounded-3xl text-xs font-bold">Failed to load Bharat Offline Hub: ${e.message}</div>`;
  }
}

async function simulateBharatOfflineOrder() {
  const offlineRef = `OFFLINE-SIM-${Date.now()}`;
  const mockOrder = {
    offline_ref: offlineRef,
    offline_created_at: new Date().toISOString(),
    order_data: {
      order_type: "TAKEAWAY",
      customer_name: "Simulated Offline Diner",
      customer_phone: "+91 99887 76655",
      items: [
        { id: 1, name: "Masala Cutting Chai", price: 30.0, quantity: 2 },
        { id: 7, name: "Batata Vada Pav (2 pcs)", price: 80.0, quantity: 1 }
      ],
      payment_method: "CASH_ON_DELIVERY",
      notes: "Bharat Offline sync simulation test",
      restaurant_id: "cp-artisan"
    }
  };

  try {
    const resp = await fetch('/api/orders/sync-offline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockOrder)
    });

    if (!resp.ok) throw new Error('Offline sync test failed');
    const resData = await resp.json();
    alert(`🎉 Bharat Mode Success!\n\nOrder Code: ${resData.order_code}\nOffline Ref: ${resData.offline_ref}\nStatus: ${resData.status}\nBounce Voucher: ${resData.bounce_back_coupon_code}`);
    loadAdminBharatOffline();
    fetchOrders();
    fetchStats();
  } catch (e) {
    alert("Simulation error: " + e.message);
  }
}

window.loadAdminMarketing = loadAdminMarketing;
window.loadAdminGroupPools = loadAdminGroupPools;
window.loadAdminBharatOffline = loadAdminBharatOffline;
window.deployMarketingCampaign = deployMarketingCampaign;
window.kitchenFinalizePool = kitchenFinalizePool;
window.simulateBharatOfflineOrder = simulateBharatOfflineOrder;

