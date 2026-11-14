// RasoiLink Offline-First Bharat Mode & Auto-Sync Engine
// Allows full menu browsing, offline order queueing, and background syncing on network reconnection

class BharatOfflineSyncManager {
  constructor() {
    this.isOnline = navigator.onLine;
    this.storageKey = 'rasoilink_offline_orders';
    this.syncInProgress = false;
    this.init();
  }

  init() {
    // 1. Register Service Worker for PWA asset caching
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => console.log('[Bharat Mode SW] Registered with scope:', reg.scope))
        .catch((err) => console.warn('[Bharat Mode SW] Registration failed:', err));
    }

    // 2. Network connectivity listeners
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.updateNetworkBadge();
      this.syncQueuedOrders();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.updateNetworkBadge();
      this.showOfflineToast();
    });

    // 3. Periodic heartbeat to verify actual server reachability
    setInterval(() => this.checkServerConnectivity(), 20000);

    // Initial check
    setTimeout(() => {
      this.checkServerConnectivity();
      this.updateNetworkBadge();
      this.syncQueuedOrders();
    }, 1500);
  }

  async checkServerConnectivity() {
    try {
      const resp = await fetch('/api/health', { method: 'GET', cache: 'no-store' });
      const wasOffline = !this.isOnline;
      this.isOnline = resp.ok;
      this.updateNetworkBadge();
      if (wasOffline && this.isOnline) {
        this.syncQueuedOrders();
      }
    } catch (e) {
      this.isOnline = false;
      this.updateNetworkBadge();
    }
  }

  updateNetworkBadge() {
    const badge = document.getElementById('bharatModeBadge');
    if (!badge) return;

    if (this.isOnline) {
      badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-sm transition-all';
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>${window.t('bharat_mode_online', 'Bharat Online')}</span>`;
    } else {
      const queuedCount = this.getQueuedOrders().length;
      badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-50 text-amber-800 border border-amber-300 shadow-sm transition-all';
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span><span>${window.t('bharat_mode_offline', 'Bharat Offline Mode')} ${queuedCount > 0 ? `(${queuedCount} queued)` : ''}</span>`;
    }
  }

  getQueuedOrders() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  saveQueuedOrders(orders) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(orders));
      this.updateNetworkBadge();
    } catch (e) {
      console.warn('Failed to save offline orders to localStorage:', e);
    }
  }

  queueOrderOffline(orderPayload) {
    const offlineRef = `OFFLINE-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const queuedItem = {
      offline_ref: offlineRef,
      order_data: orderPayload,
      offline_created_at: new Date().toISOString()
    };

    const currentQueue = this.getQueuedOrders();
    currentQueue.push(queuedItem);
    this.saveQueuedOrders(currentQueue);

    // Calculate subtotal
    const items = orderPayload.items || [];
    const subtotal = items.reduce((sum, itm) => sum + (itm.price * itm.quantity), 0);
    const tip = parseFloat(orderPayload.tip_amount || 0);
    const total = Math.max(0, subtotal + tip);

    return {
      success: true,
      is_offline: true,
      order_code: offlineRef,
      offline_ref: offlineRef,
      total_amount: total,
      bounce_back_coupon_code: "BHARAT-SYNC-PENDING",
      created_at: queuedItem.offline_created_at,
      message: "Order placed securely in Bharat Offline Mode. It will sync automatically as soon as internet connectivity returns."
    };
  }

  async syncQueuedOrders() {
    if (this.syncInProgress || !this.isOnline) return;

    const queue = this.getQueuedOrders();
    if (!queue.length) return;

    this.syncInProgress = true;
    console.log(`[Bharat Auto-Sync] Attempting to sync ${queue.length} offline orders...`);

    try {
      const resp = await fetch('/api/orders/sync-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: queue })
      });

      if (resp.ok) {
        const data = await resp.json();
        console.log('[Bharat Auto-Sync] Sync complete:', data);

        // Append synced orders to customer order history in localStorage
        try {
          const history = JSON.parse(localStorage.getItem('rasoilink_order_history') || '[]');
          queue.forEach(q => {
            if (q.order_data) {
              history.unshift({
                order_code: q.offline_ref,
                order_status: 'PENDING',
                total_amount: (q.order_data.items || []).reduce((s, it) => s + (it.price * it.quantity), 0),
                items: q.order_data.items,
                created_at: q.offline_created_at
              });
            }
          });
          localStorage.setItem('rasoilink_order_history', JSON.stringify(history));
        } catch (err) {}

        this.saveQueuedOrders([]); // Clear local queue

        if (typeof showToast === 'function') {
          showToast(`🎉 Bharat Sync: ${data.synced_count} offline order(s) successfully delivered to kitchen!`, 'success');
        }

        // If kitchen KDS or orders modal is open, trigger reload
        if (typeof fetchOrders === 'function') fetchOrders();
        if (typeof renderOrdersHistory === 'function') renderOrdersHistory();
      }
    } catch (e) {
      console.warn('[Bharat Auto-Sync] Sync failed, will retry next heartbeat:', e);
    } finally {
      this.syncInProgress = false;
      this.updateNetworkBadge();
    }
  }

  showOfflineToast() {
    if (typeof showToast === 'function') {
      showToast('⚠️ Switched to Bharat Offline Mode. You can still order — orders will queue locally.', 'info');
    }
  }
}

// Global instance
window.bharatSync = new BharatOfflineSyncManager();
