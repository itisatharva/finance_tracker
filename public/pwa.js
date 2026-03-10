// ─── Finance Tracker — PWA client logic ─────────────────────────────────────
// Handles: SW registration, offline/online pill, install prompt (mobile).
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

  // ── 2. Offline / Online pill ────────────────────────────────────────────────
  // Mobile:  slides down from top-centre → 3s → shrinks + drifts to top-right
  //          tap collapsed pill → info panel zooms out from pill origin
  // Desktop: inline badge injected beside #dashGreetingName on dashboard

  const PILL_CSS = `
    /* ── Offline pill wrapper ── */
    #__pwa_pill_wrap {
      position: fixed;
      top: 14px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9100;
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: none;
      /* transition for the move to top-right */
      transition: top .4s cubic-bezier(.34,1.1,.64,1),
                  left .4s cubic-bezier(.34,1.1,.64,1),
                  transform .4s cubic-bezier(.34,1.1,.64,1),
                  align-items .01s;
    }
    #__pwa_pill_wrap.pwa-collapsed {
      top: 14px;
      left: auto;
      right: 14px;
      transform: none;
      align-items: flex-end;
    }

    /* ── The pill chip itself ── */
    #__pwa_pill_chip {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 8px 14px;
      border-radius: 999px;
      font-family: 'DM Sans', sans-serif;
      font-size: .82rem;
      font-weight: 600;
      color: var(--text-1, #1c1c1c);
      background: var(--bg-card, #fff);
      border: 1.5px solid var(--border, #E2D9CF);
      box-shadow: 0 4px 20px rgba(0,0,0,.13);
      white-space: nowrap;
      overflow: hidden;
      cursor: default;
      user-select: none;
      pointer-events: none;
      /* hide state */
      opacity: 0;
      transform: translateY(-52px) scale(.9);
      transition: opacity .3s ease,
                  transform .38s cubic-bezier(.34,1.3,.64,1),
                  max-width .38s cubic-bezier(.34,1.1,.64,1),
                  padding .3s ease;
      max-width: 340px;
    }
    #__pwa_pill_chip.pwa-visible {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }
    #__pwa_pill_chip.pwa-collapsed {
      max-width: 100px;
      padding: 7px 12px;
    }

    /* dot */
    #__pwa_pill_dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      background: #f59e0b;
      box-shadow: 0 0 0 2.5px rgba(245,158,11,.2);
      transition: background .3s, box-shadow .3s;
    }
    #__pwa_pill_dot.pwa-online {
      background: #0FA974;
      box-shadow: 0 0 0 2.5px rgba(15,169,116,.2);
    }
    #__pwa_pill_text {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ── Info panel (tap on collapsed pill) ── */
    #__pwa_info_panel {
      margin-top: 8px;
      width: calc(100vw - 32px);
      max-width: 300px;
      background: var(--bg-card, #fff);
      border: 1.5px solid var(--border, #E2D9CF);
      border-radius: 18px;
      box-shadow: 0 8px 36px rgba(0,0,0,.15);
      overflow: hidden;
      /* zoom from pill (top-right when collapsed) */
      transform-origin: top right;
      transform: scale(0);
      opacity: 0;
      pointer-events: none;
      transition: transform .28s cubic-bezier(.34,1.3,.64,1),
                  opacity .22s ease;
    }
    #__pwa_info_panel.pwa-open {
      transform: scale(1);
      opacity: 1;
      pointer-events: auto;
    }
    .__pwa_ip_head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 13px 15px 9px;
      border-bottom: 1px solid var(--border, #E2D9CF);
    }
    .__pwa_ip_icon { font-size: 1.2rem; flex-shrink: 0; }
    .__pwa_ip_title {
      font-family: 'DM Sans', sans-serif;
      font-size: .88rem;
      font-weight: 700;
      color: var(--text-1, #1c1c1c);
    }
    .__pwa_ip_body {
      padding: 10px 15px 14px;
      font-family: 'DM Sans', sans-serif;
      font-size: .8rem;
      color: var(--text-2, #5a5a5a);
      line-height: 1.65;
    }
    .__pwa_ip_step {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 7px;
    }
    .__pwa_ip_step:last-child { margin-bottom: 0; }
    .__pwa_ip_num {
      width: 18px; height: 18px;
      border-radius: 50%;
      background: rgba(245,158,11,.15);
      color: #b45309;
      font-size: .7rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 1px;
    }

    /* ── Desktop inline badge ── */
    #__pwa_desk_badge {
      display: none;
      align-items: center;
      gap: 5px;
      font-family: 'DM Sans', sans-serif;
      font-size: .72rem;
      font-weight: 600;
      color: #92400e;
      background: rgba(245,158,11,.12);
      border: 1.5px solid rgba(245,158,11,.3);
      border-radius: 999px;
      padding: 2px 8px 2px 6px;
      white-space: nowrap;
      margin-left: 10px;
      vertical-align: middle;
      animation: __pwa_fadein .3s ease both;
    }
    @keyframes __pwa_fadein { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:none; } }
    #__pwa_desk_badge.pwa-desk-visible { display: inline-flex; }
    #__pwa_desk_badge .__pwa_db_dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #f59e0b;
      flex-shrink: 0;
    }
  `;

  let _injected      = false;
  let _collapseTimer = null;
  let _hideTimer     = null;
  let _panelOpen     = false;
  let _isOffline     = false;
  let _deskTried     = false;

  function _injectCSS() {
    if (_injected) return;
    _injected = true;
    const s = document.createElement('style');
    s.textContent = PILL_CSS;
    document.head.appendChild(s);

    // ── Pill wrap + chip ──
    const wrap = document.createElement('div');
    wrap.id = '__pwa_pill_wrap';
    wrap.innerHTML = `
      <div id="__pwa_pill_chip" role="status" aria-live="polite">
        <span id="__pwa_pill_dot"></span>
        <span id="__pwa_pill_text">Offline — data will sync once online</span>
      </div>
      <div id="__pwa_info_panel" role="tooltip">
        <div class="__pwa_ip_head">
          <span class="__pwa_ip_icon">📶</span>
          <span class="__pwa_ip_title">You're offline — here's what happens</span>
        </div>
        <div class="__pwa_ip_body">
          <div class="__pwa_ip_step">
            <div class="__pwa_ip_num">1</div>
            <div>Any transactions you add are <strong>saved locally</strong> in your browser's storage.</div>
          </div>
          <div class="__pwa_ip_step">
            <div class="__pwa_ip_num">2</div>
            <div>The moment you're <strong>back online</strong>, they sync to your account automatically.</div>
          </div>
          <div class="__pwa_ip_step">
            <div class="__pwa_ip_num">3</div>
            <div>All your <strong>existing data</strong> is still available to view and browse.</div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    // ── Desktop badge (will be moved next to name when online state known) ──
    const badge = document.createElement('span');
    badge.id = '__pwa_desk_badge';
    badge.innerHTML = `<span class="__pwa_db_dot"></span>Offline`;
    document.body.appendChild(badge);

    // Tap chip to toggle info panel
    document.getElementById('__pwa_pill_chip').addEventListener('click', e => {
      e.stopPropagation();
      if (!_isOffline) return;
      _panelOpen ? _closePanel() : _openPanel();
    });
    // Close panel on outside tap
    document.addEventListener('click', () => { if (_panelOpen) _closePanel(); });
  }

  function _chip()   { return document.getElementById('__pwa_pill_chip'); }
  function _wrap()   { return document.getElementById('__pwa_pill_wrap'); }
  function _dot()    { return document.getElementById('__pwa_pill_dot'); }
  function _text()   { return document.getElementById('__pwa_pill_text'); }
  function _panel()  { return document.getElementById('__pwa_info_panel'); }
  function _badge()  { return document.getElementById('__pwa_desk_badge'); }

  function _openPanel() {
    _panelOpen = true;
    _panel().classList.add('pwa-open');
  }
  function _closePanel() {
    _panelOpen = false;
    _panel().classList.remove('pwa-open');
  }

  // Try to inject desktop badge beside the greeting name on the dashboard
  function _injectDeskBadge() {
    if (_deskTried) return;
    const nameEl = document.getElementById('dashGreetingName');
    if (!nameEl) return;
    _deskTried = true;
    nameEl.parentNode.insertBefore(_badge(), nameEl.nextSibling);
  }

  function _showOffline() {
    _injectCSS();
    _isOffline = true;
    clearTimeout(_collapseTimer);
    clearTimeout(_hideTimer);
    _closePanel();

    const chip = _chip(), wrap = _wrap(), dot = _dot(), text = _text();
    dot.classList.remove('pwa-online');

    const mobile = window.innerWidth < 769;

    if (!mobile) {
      // ── Desktop: inject badge beside name ──
      const fn = () => {
        _injectDeskBadge();
        const b = _badge();
        if (b) b.classList.add('pwa-desk-visible');
      };
      document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', fn)
        : fn();
      return;
    }

    // ── Mobile: slide down from top-centre ──
    wrap.classList.remove('pwa-collapsed');
    chip.classList.remove('pwa-collapsed');
    text.textContent = 'Offline — data will sync once online';

    requestAnimationFrame(() => requestAnimationFrame(() => {
      chip.classList.add('pwa-visible');
    }));

    // After 3s: shrink text and move to top-right
    _collapseTimer = setTimeout(() => {
      _closePanel();
      text.textContent = 'Offline';
      chip.classList.add('pwa-collapsed');
      // Give text time to shrink, then move pill wrap to top-right
      setTimeout(() => wrap.classList.add('pwa-collapsed'), 150);
    }, 3000);
  }

  function _showOnline() {
    _isOffline = false;
    clearTimeout(_collapseTimer);
    clearTimeout(_hideTimer);
    _closePanel();

    // Desktop: remove badge
    const b = _badge();
    if (b) b.classList.remove('pwa-desk-visible');

    const chip = _chip();
    if (!chip || !chip.classList.contains('pwa-visible')) return;

    const wrap = _wrap(), dot = _dot(), text = _text();
    // Bring pill back to centre before showing "Back online"
    wrap.classList.remove('pwa-collapsed');
    chip.classList.remove('pwa-collapsed');
    dot.classList.add('pwa-online');
    text.textContent = 'Back online!';

    _hideTimer = setTimeout(() => {
      chip.classList.remove('pwa-visible');
      setTimeout(() => {
        wrap.classList.remove('pwa-collapsed');
        dot.classList.remove('pwa-online');
      }, 400);
    }, 2500);
  }

  const _run = fn => document.body ? fn() : document.addEventListener('DOMContentLoaded', fn);
  if (!navigator.onLine) _run(_showOffline);
  window.addEventListener('offline', () => _run(_showOffline));
  window.addEventListener('online',  () => _run(_showOnline));

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