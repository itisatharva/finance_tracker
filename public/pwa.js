// ─── Finance Tracker — PWA client logic ─────────────────────────────────────
// Handles: SW registration, offline/online pill, install prompt (mobile).
// Include this as a plain <script> (not module) so it runs early on all pages.

(function () {
  'use strict';

  // ── 1. Register Service Worker ──────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(reg => {

        // Notify user when a new version is waiting
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              _showUpdateToast();
            }
          });
        });

      }).catch(err => console.warn('[SW] Registration failed:', err));

      // When SW takes control (after update), reload silently
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) { refreshing = true; window.location.reload(); }
      });
    });
  }

  // ── 2. Offline / Online pill ────────────────────────────────────────────────
  // Behaviour:
  //  Offline: slides in from top-right → shows full message 4 s → collapses to dot + "Offline"
  //  Online:  dot turns green, text changes to "Online" → slides out upward after 3 s

  const PILL_STYLE = `
    #__pwa_offline_pill {
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: 9000;
      display: inline-flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0;
      pointer-events: none;
      user-select: none;
    }
    #__pwa_pill_chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px 6px 10px;
      border-radius: 999px;
      font-family: 'DM Sans', sans-serif;
      font-size: .78rem;
      font-weight: 600;
      letter-spacing: .01em;
      color: var(--text-1, #1c1c1c);
      background: var(--bg-card, #fff);
      border: 1.5px solid var(--border, #E2D9CF);
      box-shadow: 0 4px 16px rgba(0,0,0,.10);
      transform: translateY(-56px);
      opacity: 0;
      transition: transform .38s cubic-bezier(.34,1.4,.64,1), opacity .25s, max-width .4s ease;
      white-space: nowrap;
      max-width: 300px;
      overflow: hidden;
    }
    #__pwa_pill_chip.visible {
      transform: translateY(0);
      opacity: 1;
    }
    #__pwa_pill_chip.collapsed {
      max-width: 90px;
    }
    .__pwa_pill_dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      transition: background .3s, box-shadow .3s;
      background: #f59e0b;
      box-shadow: 0 0 0 2px rgba(245,158,11,.22);
    }
    .__pwa_pill_dot.online {
      background: #0FA974;
      box-shadow: 0 0 0 2px rgba(15,169,116,.22);
    }
    #__pwa_pill_text {
      transition: opacity .25s;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;

  let _pillInjected  = false;
  let _collapseTimer = null;
  let _hideTimer     = null;

  function _injectPill() {
    if (_pillInjected) return;
    _pillInjected = true;
    const s = document.createElement('style');
    s.textContent = PILL_STYLE;
    document.head.appendChild(s);
    const wrap = document.createElement('div');
    wrap.id = '__pwa_offline_pill';
    wrap.setAttribute('aria-live', 'polite');
    wrap.setAttribute('role', 'status');
    wrap.innerHTML = `
      <div id="__pwa_pill_chip">
        <span class="__pwa_pill_dot" id="__pwa_pill_dot"></span>
        <span id="__pwa_pill_text">Offline — changes will sync when you reconnect</span>
      </div>`;
    document.body.appendChild(wrap);
  }

  function _getPill() {
    _injectPill();
    return {
      chip: document.getElementById('__pwa_pill_chip'),
      dot:  document.getElementById('__pwa_pill_dot'),
      text: document.getElementById('__pwa_pill_text'),
    };
  }

  function _showOffline() {
    clearTimeout(_collapseTimer);
    clearTimeout(_hideTimer);
    const { chip, dot, text } = _getPill();
    dot.classList.remove('online');
    text.textContent = 'Offline — changes will sync when you reconnect';
    chip.classList.remove('collapsed');
    // Trigger slide-in
    requestAnimationFrame(() => requestAnimationFrame(() => chip.classList.add('visible')));
    // After 4 s collapse to short pill
    _collapseTimer = setTimeout(() => {
      text.textContent = 'Offline';
      chip.classList.add('collapsed');
    }, 4000);
  }

  function _showOnline() {
    clearTimeout(_collapseTimer);
    clearTimeout(_hideTimer);
    const { chip, dot, text } = _getPill();
    // Only animate if pill is visible (user was offline)
    if (!chip.classList.contains('visible')) return;
    dot.classList.add('online');
    text.textContent = 'Online';
    chip.classList.remove('collapsed');
    // After 3 s slide out upward
    _hideTimer = setTimeout(() => {
      chip.classList.remove('visible');
    }, 3000);
  }

  const _run = fn => document.body ? fn() : document.addEventListener('DOMContentLoaded', fn);

  if (!navigator.onLine) _run(_showOffline);
  window.addEventListener('offline', () => _run(_showOffline));
  window.addEventListener('online',  () => _run(_showOnline));

  // ── 3. Install prompt (mobile only) ─────────────────────────────────────────
  let _deferredPrompt = null;
  const INSTALL_DISMISSED_KEY = 'pwa_install_dismissed';

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredPrompt = e;

    // Don't show if user already dismissed or installed
    if (localStorage.getItem(INSTALL_DISMISSED_KEY)) return;

    // Only show on narrow screens (mobile / small tablet)
    const isMobile = window.innerWidth < 768 ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if (!isMobile) return;

    // Small delay so it doesn't pop up instantly on load
    setTimeout(_showInstallBanner, 3000);
  });

  function _showInstallBanner() {
    if (document.getElementById('__pwa_install_banner')) return;

    const banner = document.createElement('div');
    banner.id = '__pwa_install_banner';
    banner.innerHTML = `
      <div class="__pwa_ib_inner">
        <div class="__pwa_ib_icon">₹</div>
        <div class="__pwa_ib_text">
          <div class="__pwa_ib_title">Add to Home Screen</div>
          <div class="__pwa_ib_sub">Use Finance Tracker like a native app</div>
        </div>
        <button class="__pwa_ib_close" id="__pwa_ib_close" aria-label="Dismiss">×</button>
      </div>
      <div class="__pwa_ib_actions">
        <button class="__pwa_ib_btn_secondary" id="__pwa_ib_maybe">Not now</button>
        <button class="__pwa_ib_btn_primary"   id="__pwa_ib_install">Install app</button>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #__pwa_install_banner {
        position: fixed;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 72px); /* above bottom-nav */
        left: 12px;
        right: 12px;
        z-index: 8500;
        background: var(--bg-card, #fff);
        border: 1.5px solid var(--border, #E2D9CF);
        border-radius: var(--r-xl, 24px);
        box-shadow: 0 8px 32px rgba(0,0,0,.14);
        padding: 16px 16px 14px;
        font-family: 'DM Sans', sans-serif;
        transform: translateY(120%);
        transition: transform .4s cubic-bezier(.34,1.4,.64,1);
        max-width: 480px;
        margin: 0 auto;
      }
      #__pwa_install_banner.visible {
        transform: translateY(0);
      }
      .__pwa_ib_inner {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 14px;
      }
      .__pwa_ib_icon {
        width: 44px;
        height: 44px;
        background: var(--ink, #1c1c1c);
        color: var(--ink-fg, #fff);
        border-radius: var(--r-md, 12px);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.35rem;
        font-weight: 700;
        flex-shrink: 0;
      }
      .__pwa_ib_text { flex: 1; min-width: 0; }
      .__pwa_ib_title {
        font-size: .95rem;
        font-weight: 700;
        color: var(--text-1, #1c1c1c);
        letter-spacing: -.01em;
      }
      .__pwa_ib_sub {
        font-size: .78rem;
        color: var(--text-3, #9a9a9a);
        margin-top: 2px;
      }
      .__pwa_ib_close {
        background: none;
        border: none;
        font-size: 1.3rem;
        line-height: 1;
        color: var(--text-3, #9a9a9a);
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 6px;
        flex-shrink: 0;
        align-self: flex-start;
      }
      .__pwa_ib_actions {
        display: flex;
        gap: 10px;
      }
      .__pwa_ib_btn_secondary {
        flex: 1;
        padding: 10px;
        border-radius: var(--r-md, 12px);
        border: 1.5px solid var(--border, #E2D9CF);
        background: transparent;
        color: var(--text-2, #5a5a5a);
        font-family: 'DM Sans', sans-serif;
        font-size: .88rem;
        font-weight: 600;
        cursor: pointer;
      }
      .__pwa_ib_btn_primary {
        flex: 2;
        padding: 10px;
        border-radius: var(--r-md, 12px);
        border: none;
        background: var(--ink, #1c1c1c);
        color: var(--ink-fg, #fff);
        font-family: 'DM Sans', sans-serif;
        font-size: .88rem;
        font-weight: 700;
        cursor: pointer;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(banner);

    // Animate in
    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('visible')));

    function _dismissBanner(permanent) {
      banner.classList.remove('visible');
      if (permanent) localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
      setTimeout(() => banner.remove(), 500);
    }

    document.getElementById('__pwa_ib_close').addEventListener('click', () => _dismissBanner(true));
    document.getElementById('__pwa_ib_maybe').addEventListener('click', () => _dismissBanner(false));
    document.getElementById('__pwa_ib_install').addEventListener('click', async () => {
      if (!_deferredPrompt) return;
      _dismissBanner(false);
      _deferredPrompt.prompt();
      const { outcome } = await _deferredPrompt.userChoice;
      if (outcome === 'accepted') localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
      _deferredPrompt = null;
    });
  }

  // Hide install banner if already installed (running in standalone mode)
  if (window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true) {
    localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  }

  // ── 4. Update available toast ────────────────────────────────────────────────
  function _showUpdateToast() {
    if (document.getElementById('__pwa_update_toast')) return;

    const toast = document.createElement('div');
    toast.id = '__pwa_update_toast';
    toast.innerHTML = `
      <span>New version available</span>
      <button id="__pwa_update_btn">Update now</button>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #__pwa_update_toast {
        position: fixed;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 80px);
        left: 50%;
        transform: translateX(-50%);
        background: var(--ink, #1c1c1c);
        color: var(--ink-fg, #fff);
        border-radius: 999px;
        padding: 10px 16px;
        font-family: 'DM Sans', sans-serif;
        font-size: .82rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,.25);
        z-index: 9500;
        white-space: nowrap;
      }
      #__pwa_update_btn {
        background: rgba(255,255,255,.18);
        border: none;
        border-radius: 999px;
        color: inherit;
        font: inherit;
        font-weight: 700;
        padding: 4px 12px;
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(toast);

    document.getElementById('__pwa_update_btn').addEventListener('click', () => {
      toast.remove();
      // Tell the waiting SW to skip waiting
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      });
    });
  }

})();