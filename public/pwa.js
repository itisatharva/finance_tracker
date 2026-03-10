// ─── Finance Tracker — PWA client logic ─────────────────────────────────────
// Handles: SW registration, offline/online badge, install prompt (mobile).
// Include as a plain <script> (not module) so it runs early on all pages.

(function () {
  'use strict';

  // ── 1. Register Service Worker ──────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) _showUpdateToast();
          });
        });
      }).catch(err => console.warn('[SW] Registration failed:', err));

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) { refreshing = true; window.location.reload(); }
      });
    });
  }

  // ── 2. Offline / Online badge ───────────────────────────────────────────────
  // Appears inline beside #dashGreetingName on both mobile + desktop.
  // Uses opacity + max-width transitions only — never toggles display,
  // so all states (in, idle, text-swap, out) are perfectly smooth.

  const BADGE_CSS = `
    #__pwa_badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-family: 'DM Sans', sans-serif;
      font-size: .72rem;
      font-weight: 600;
      white-space: nowrap;
      border-radius: 999px;
      overflow: hidden;
      pointer-events: none;
      cursor: default;
      user-select: none;
      vertical-align: middle;

      /* Hidden state — pure opacity + geometry, zero display toggling */
      opacity: 0;
      max-width: 0;
      padding: 3px 0;
      margin-left: 0;
      transform: scale(0.78) translateY(1px);

      transition:
        opacity     .45s ease,
        max-width   .50s cubic-bezier(.34,1.1,.64,1),
        padding     .40s ease,
        margin-left .40s ease,
        transform   .45s cubic-bezier(.34,1.3,.64,1);
    }

    /* Offline state */
    #__pwa_badge.pwa-badge-offline {
      color: #92400e;
      background: rgba(245,158,11,.13);
      border: 1.5px solid rgba(245,158,11,.35);
    }
    /* Back-online state */
    #__pwa_badge.pwa-badge-online {
      color: #065f46;
      background: rgba(15,169,116,.1);
      border: 1.5px solid rgba(15,169,116,.3);
    }

    /* Visible */
    #__pwa_badge.pwa-badge-show {
      opacity: 1;
      max-width: 200px;
      padding: 3px 10px 3px 7px;
      margin-left: 6px;
      transform: scale(1) translateY(0);
      pointer-events: auto;
    }

    #__pwa_badge_dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
      background: #f59e0b;
      box-shadow: 0 0 0 2px rgba(245,158,11,.25);
      transition: background .5s ease, box-shadow .5s ease;
    }
    #__pwa_badge_dot.pwa-dot-online {
      background: #0FA974;
      box-shadow: 0 0 0 2px rgba(15,169,116,.25);
    }

    #__pwa_badge_text {
      transition: opacity .3s ease;
    }
    #__pwa_badge_text.pwa-text-fade {
      opacity: 0;
    }
  `;

  let _badgeInjected = false;
  let _isOffline     = false;
  let _hideTimer     = null;
  let _textTimer     = null;
  let _offlineDebounce = null;
  let _onlineDebounce  = null;

  function _injectBadge() {
    if (_badgeInjected) return;
    _badgeInjected = true;

    const s = document.createElement('style');
    s.textContent = BADGE_CSS;
    document.head.appendChild(s);

    const badge = document.createElement('span');
    badge.id = '__pwa_badge';
    badge.className = 'pwa-badge-offline';
    badge.innerHTML = `<span id="__pwa_badge_dot"></span><span id="__pwa_badge_text">Offline</span>`;
    document.body.appendChild(badge);
  }

  function _badge()   { return document.getElementById('__pwa_badge'); }
  function _dot()     { return document.getElementById('__pwa_badge_dot'); }
  function _badgeTxt(){ return document.getElementById('__pwa_badge_text'); }

  // Move badge inside #dashGreetingName so it sits inline on the same line.
  // Safe to call multiple times — moves only once.
  let _placed = false;
  function _placeBadge() {
    if (_placed) return;
    const nameEl = document.getElementById('dashGreetingName');
    if (!nameEl) return;
    _placed = true;
    nameEl.appendChild(_badge());
  }

  // ── Offline verification ──
  // Debounce 600ms + a real HEAD fetch before deciding we're offline.
  // Prevents false-positives from momentary connectivity blips.
  async function _confirmOffline() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      await fetch('/manifest.json?_ping=' + Date.now(), {
        method: 'HEAD', cache: 'no-store', signal: ctrl.signal
      });
      clearTimeout(t);
      return false; // fetch succeeded → still online
    } catch {
      return true; // confirmed offline
    }
  }

  function _showOfflineBadge() {
    _injectBadge();
    _isOffline = true;
    clearTimeout(_hideTimer);
    clearTimeout(_textTimer);

    const fn = () => {
      _placeBadge();
      const b = _badge(), dot = _dot(), txt = _badgeTxt();
      if (!b) return;

      // Reset to offline styling
      b.classList.remove('pwa-badge-online');
      b.classList.add('pwa-badge-offline');
      dot.classList.remove('pwa-dot-online');
      txt.classList.remove('pwa-text-fade');
      txt.textContent = 'Offline';

      // Trigger fade-in on next paint
      requestAnimationFrame(() => requestAnimationFrame(() => {
        b.classList.add('pwa-badge-show');
      }));
    };

    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', fn)
      : fn();
  }

  function _showOnlineBadge() {
    _isOffline = false;
    clearTimeout(_hideTimer);
    clearTimeout(_textTimer);

    const b = _badge(), dot = _dot(), txt = _badgeTxt();
    // If badge was never shown (came online before offline was triggered) — do nothing
    if (!b || !b.classList.contains('pwa-badge-show')) return;

    // Crossfade: fade out text → swap content + colour → fade back in
    txt.classList.add('pwa-text-fade');
    _textTimer = setTimeout(() => {
      b.classList.remove('pwa-badge-offline');
      b.classList.add('pwa-badge-online');
      dot.classList.add('pwa-dot-online');
      txt.textContent = 'Back online!';
      txt.classList.remove('pwa-text-fade');

      // After 2.5s: fade badge out entirely
      _hideTimer = setTimeout(() => {
        b.classList.remove('pwa-badge-show');
        // After fade-out transition finishes, reset state
        setTimeout(() => {
          if (!_isOffline) {
            b.classList.remove('pwa-badge-online');
            b.classList.add('pwa-badge-offline');
            dot.classList.remove('pwa-dot-online');
          }
        }, 500);
      }, 2500);
    }, 300); // matches pwa-text-fade transition
  }

  // ── Event wiring with debounce + verification ──
  const _run = fn => document.body ? fn() : document.addEventListener('DOMContentLoaded', fn);

  // On page load: only show if truly offline (not just slow)
  if (!navigator.onLine) {
    _run(() => setTimeout(async () => {
      if (await _confirmOffline()) _showOfflineBadge();
    }, 400));
  }

  window.addEventListener('offline', () => {
    clearTimeout(_offlineDebounce);
    clearTimeout(_onlineDebounce);
    _offlineDebounce = setTimeout(async () => {
      if (await _confirmOffline()) _run(_showOfflineBadge);
    }, 600);
  });

  window.addEventListener('online', () => {
    clearTimeout(_onlineDebounce);
    clearTimeout(_offlineDebounce);
    // Small delay — 'online' event fires before full connectivity is restored
    _onlineDebounce = setTimeout(() => {
      _run(_showOnlineBadge);
    }, 400);
  });

  // ── 3. Install prompt (mobile only) ─────────────────────────────────────────
  let _deferredPrompt = null;
  const INSTALL_KEY = 'pwa_install_dismissed';

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredPrompt = e;
    if (localStorage.getItem(INSTALL_KEY)) return;
    const mob = window.innerWidth < 768 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if (!mob) return;
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
      </div>`;
    const style = document.createElement('style');
    style.textContent = `
      #__pwa_install_banner{position:fixed;bottom:calc(env(safe-area-inset-bottom,0px)+72px);left:12px;right:12px;z-index:8500;background:var(--bg-card,#fff);border:1.5px solid var(--border,#E2D9CF);border-radius:var(--r-xl,24px);box-shadow:0 8px 32px rgba(0,0,0,.14);padding:16px 16px 14px;font-family:'DM Sans',sans-serif;transform:translateY(120%);transition:transform .4s cubic-bezier(.34,1.4,.64,1);max-width:480px;margin:0 auto;}
      #__pwa_install_banner.visible{transform:translateY(0)}
      .__pwa_ib_inner{display:flex;align-items:center;gap:12px;margin-bottom:14px}
      .__pwa_ib_icon{width:44px;height:44px;background:var(--ink,#1c1c1c);color:var(--ink-fg,#fff);border-radius:var(--r-md,12px);display:flex;align-items:center;justify-content:center;font-size:1.35rem;font-weight:700;flex-shrink:0}
      .__pwa_ib_text{flex:1;min-width:0}
      .__pwa_ib_title{font-size:.95rem;font-weight:700;color:var(--text-1,#1c1c1c);letter-spacing:-.01em}
      .__pwa_ib_sub{font-size:.78rem;color:var(--text-3,#9a9a9a);margin-top:2px}
      .__pwa_ib_close{background:none;border:none;font-size:1.3rem;color:var(--text-3,#9a9a9a);cursor:pointer;padding:4px 6px;border-radius:6px;flex-shrink:0;align-self:flex-start}
      .__pwa_ib_actions{display:flex;gap:10px}
      .__pwa_ib_btn_secondary{flex:1;padding:10px;border-radius:var(--r-md,12px);border:1.5px solid var(--border,#E2D9CF);background:transparent;color:var(--text-2,#5a5a5a);font-family:'DM Sans',sans-serif;font-size:.88rem;font-weight:600;cursor:pointer}
      .__pwa_ib_btn_primary{flex:2;padding:10px;border-radius:var(--r-md,12px);border:none;background:var(--ink,#1c1c1c);color:var(--ink-fg,#fff);font-family:'DM Sans',sans-serif;font-size:.88rem;font-weight:700;cursor:pointer}`;
    document.head.appendChild(style);
    document.body.appendChild(banner);
    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('visible')));
    function _dismiss(perm) {
      banner.classList.remove('visible');
      if (perm) localStorage.setItem(INSTALL_KEY, '1');
      setTimeout(() => banner.remove(), 500);
    }
    document.getElementById('__pwa_ib_close').addEventListener('click', () => _dismiss(true));
    document.getElementById('__pwa_ib_maybe').addEventListener('click', () => _dismiss(false));
    document.getElementById('__pwa_ib_install').addEventListener('click', async () => {
      if (!_deferredPrompt) return;
      _dismiss(false);
      _deferredPrompt.prompt();
      const { outcome } = await _deferredPrompt.userChoice;
      if (outcome === 'accepted') localStorage.setItem(INSTALL_KEY, '1');
      _deferredPrompt = null;
    });
  }

  if (window.matchMedia('(display-mode:standalone)').matches || window.navigator.standalone) {
    localStorage.setItem(INSTALL_KEY, '1');
  }

  // ── 4. Update available toast ────────────────────────────────────────────────
  function _showUpdateToast() {
    if (document.getElementById('__pwa_update_toast')) return;
    const toast = document.createElement('div');
    toast.id = '__pwa_update_toast';
    toast.innerHTML = `<span>New version available</span><button id="__pwa_update_btn">Update now</button>`;
    const style = document.createElement('style');
    style.textContent = `
      #__pwa_update_toast{position:fixed;bottom:calc(env(safe-area-inset-bottom,0px)+80px);left:50%;transform:translateX(-50%);background:var(--ink,#1c1c1c);color:var(--ink-fg,#fff);border-radius:999px;padding:10px 16px;font-family:'DM Sans',sans-serif;font-size:.82rem;font-weight:600;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,.25);z-index:9500;white-space:nowrap}
      #__pwa_update_btn{background:rgba(255,255,255,.18);border:none;border-radius:999px;color:inherit;font:inherit;font-weight:700;padding:4px 12px;cursor:pointer}`;
    document.head.appendChild(style);
    document.body.appendChild(toast);
    document.getElementById('__pwa_update_btn').addEventListener('click', () => {
      toast.remove();
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      });
    });
  }

})();