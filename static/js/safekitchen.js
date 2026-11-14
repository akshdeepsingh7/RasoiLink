/**
 * RasoiLink SafeKitchen Verified Engine
 * Compact animated hygiene protocol checklist with real-time Trust Score & audit logs.
 */
(function () {
  let activeSafeKitchenTimer = null;

  async function loadSafeKitchenData(restaurantId) {
    const rid = restaurantId || (window.State && window.State.selectedRestaurantId) || 'cp-artisan';
    const container = document.getElementById('safekitchenContainer');
    const checklistEl = document.getElementById('safekitchenChecklist');
    const badgeEl = document.getElementById('safekitchenBadge');
    const scoreEl = document.getElementById('safekitchenTrustScore');
    const fssaiEl = document.getElementById('safekitchenFssai');

    if (!container || !checklistEl) return;

    if (activeSafeKitchenTimer) {
      clearTimeout(activeSafeKitchenTimer);
      activeSafeKitchenTimer = null;
    }

    try {
      const res = await fetch(`/api/safekitchen/${encodeURIComponent(rid)}`);
      if (!res.ok) {
        // Handle unavailable data gracefully by hiding container cleanly
        container.classList.add('hidden');
        return;
      }

      const data = await res.json();
      if (!data || !data.success || !Array.isArray(data.checks) || data.checks.length === 0) {
        container.classList.add('hidden');
        return;
      }

      // Unhide container
      container.classList.remove('hidden');

      // Update actual restaurant Trust Score and FSSAI license
      if (scoreEl) {
        scoreEl.textContent = data.trust_score ?? '98';
      }
      if (fssaiEl && data.fssai_license) {
        fssaiEl.textContent = `· ${data.fssai_license}`;
        fssaiEl.classList.remove('hidden');
      }

      const checks = data.checks;
      const sessionKey = `safekitchen_seen_${rid}`;
      const hasSeen = sessionStorage.getItem(sessionKey) === 'true';
      const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const shouldAnimate = !hasSeen && !prefersReducedMotion;

      // Clear container
      checklistEl.innerHTML = '';
      if (badgeEl) {
        badgeEl.classList.remove('animate-pulse-glow', 'already-shown');
        badgeEl.style.opacity = shouldAnimate ? '0' : '1';
      }

      // Render each of the 9 checks in order
      checks.forEach((item, index) => {
        const itemEl = document.createElement('div');
        const delayMs = index * 300;

        if (shouldAnimate) {
          itemEl.className = 'safekitchen-item animate';
          itemEl.style.animationDelay = `${delayMs}ms`;
        } else {
          itemEl.className = 'safekitchen-item already-shown';
        }

        // Animated SVG checkmark stroke
        const checkDelayStyle = shouldAnimate ? `style="animation-delay: ${delayMs + 120}ms"` : '';

        itemEl.innerHTML = `
          <svg class="safekitchen-svg" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="rgba(34, 197, 94, 0.15)" stroke="#22C55E" stroke-width="1.2"/>
            <path class="safekitchen-check-stroke" d="M4.5 8.2L7 10.7L11.5 5.5" stroke="#22C55E" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${checkDelayStyle}/>
          </svg>
          <span class="safekitchen-text truncate" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
        `;

        checklistEl.appendChild(itemEl);
      });

      // Once all checks appear (sequential ~300ms delays), display the badge with one-time pulse/glow
      if (badgeEl) {
        if (shouldAnimate) {
          const totalDuration = (checks.length * 300) + 50;
          activeSafeKitchenTimer = setTimeout(() => {
            badgeEl.classList.add('animate-pulse-glow');
            sessionStorage.setItem(sessionKey, 'true');
          }, totalDuration);
        } else {
          badgeEl.classList.add('already-shown');
          badgeEl.style.opacity = '1';
        }
      }

    } catch (err) {
      console.warn('SafeKitchen audit fetch error (handled gracefully):', err);
      if (container) container.classList.add('hidden');
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  window.loadSafeKitchenData = loadSafeKitchenData;

  // Auto-load on DOM ready if elements exist
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const rid = (window.State && window.State.selectedRestaurantId) || 'cp-artisan';
      loadSafeKitchenData(rid);
    });
  } else {
    const rid = (window.State && window.State.selectedRestaurantId) || 'cp-artisan';
    loadSafeKitchenData(rid);
  }
})();
