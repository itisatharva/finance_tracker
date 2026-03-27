// Finance Tracker — PWA client logic
// Handles: SW registration, offline/online badge, install prompt (mobile).

(function () {
  'use strict';

  // ── 1. Service Worker ────────────────────────────────────────────────────────

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        if (reg.waiting && navigator.serviceWorker.controller) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }).catch(err => console.warn('[SW] Registration failed:', err));

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) { refreshing = true; window.location.reload(); }
      });
    });
  }

  // ── 2. Offline / Online badge ────────────────────────────────────────────────
  // Sits inline beside #dashGreetingName. The wrapper animates max-width so the
  // bank pill glides smoothly rather than teleporting when the badge appears.

  const BADGE_CSS = `
    #__pwa_badge_wrap {
      display: inline-flex;
      align-items: center;
      overflow: hidden;
      max-width: 0;
      margin-left: 0;
      vertical-align: middle;
      transition:
        max-width   0.45s cubic-bezier(0.4, 0, 0.2, 1),
        margin-left 0.45s cubic-bezier(0.4, 0, 0.2, 1);
    }
    #__pwa_badge_wrap.pwa-wrap-show {
      max-width: 160px;
      margin-left: 7px;
    }

    #__pwa_badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-family: 'DM Sans', sans-serif;
      font-size: .72rem;
      font-weight: 600;
      white-space: nowrap;
      border-radius: 999px;
      padding: 3px 10px 3px 8px;
      cursor: default;
      user-select: none;
      flex-shrink: 0;
      will-change: opacity, transform;
      opacity: 0;
      transform: translateX(-10px);
      pointer-events: none;
      transition:
        opacity   0.45s cubic-bezier(0.16, 1, 0.3, 1),
        transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
    }

    #__pwa_badge.pwa-badge-offline {
      color: #92400e;
      background: rgba(245,158,11,.13);
      border: 1.5px solid rgba(245,158,11,.35);
    }
    #__pwa_badge.pwa-badge-online {
      color: #065f46;
      background: rgba(15,169,116,.1);
      border: 1.5px solid rgba(15,169,116,.3);
    }
    [data-theme="dark"] #__pwa_badge.pwa-badge-offline {
      color: #fbbf24;
      background: rgba(245,158,11,.18);
      border: 1.5px solid rgba(245,158,11,.4);
    }
    [data-theme="dark"] #__pwa_badge.pwa-badge-online {
      color: #34d399;
      background: rgba(15,169,116,.15);
      border: 1.5px solid rgba(15,169,116,.35);
    }

    #__pwa_badge.pwa-badge-show {
      opacity: 1;
      transform: translateX(0);
      pointer-events: auto;
    }
    #__pwa_badge.pwa-badge-hiding {
      opacity: 0;
      transform: translateX(10px);
      pointer-events: none;
    }

    #__pwa_badge_dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
      background: #f59e0b;
      box-shadow: 0 0 0 2px rgba(245,158,11,.25);
      will-change: background, box-shadow;
      transition: background 0.7s ease, box-shadow 0.7s ease;
    }
    #__pwa_badge_dot.pwa-dot-online {
      background: #0FA974;
      box-shadow: 0 0 0 2px rgba(15,169,116,.25);
    }

    #__pwa_badge_text {
      transition: opacity 0.45s ease;
    }
    #__pwa_badge_text.pwa-text-fade {
      opacity: 0;
    }
  `;

  let _badgeInjected   = false;
  let _isOffline       = false;
  let _hideTimer       = null;
  let _textTimer       = null;
  let _offlineDebounce = null;
  let _onlineDebounce  = null;

  function _injectBadge() {
    if (_badgeInjected) return;
    _badgeInjected = true;

    const s = document.createElement('style');
    s.textContent = BADGE_CSS;
    document.head.appendChild(s);

    const wrap = document.createElement('span');
    wrap.id = '__pwa_badge_wrap';

    const badge = document.createElement('span');
    badge.id = '__pwa_badge';
    badge.className = 'pwa-badge-offline';
    badge.innerHTML = `<span id="__pwa_badge_dot"></span><span id="__pwa_badge_text">Offline</span>`;

    wrap.appendChild(badge);
    document.body.appendChild(wrap);
  }

  function _wrap()     { return document.getElementById('__pwa_badge_wrap'); }
  function _badge()    { return document.getElementById('__pwa_badge'); }
  function _dot()      { return document.getElementById('__pwa_badge_dot'); }
  function _badgeTxt() { return document.getElementById('__pwa_badge_text'); }

  let _placed = false;
  function _placeBadge() {
    if (_placed) return;
    const nameEl = document.getElementById('dashGreetingName');
    if (nameEl) {
      // Preferred location: inline next to the greeting name (index.html)
      _placed = true;
      nameEl.appendChild(_wrap());
    } else {
      // Fallback: float in the top-right corner on pages without the greeting
      const w = _wrap();
      if (!w) return;
      _placed = true;
      w.style.cssText = 'position:fixed;top:14px;right:14px;z-index:8000;';
      document.body.appendChild(w);
    }
  }

  async function _confirmOffline() {
    // In standalone/installed PWA mode the service worker always serves
    // /manifest.json from the shell cache, so a successful fetch() does NOT
    // prove network connectivity.  Fall back to navigator.onLine which is
    // reliable for the installed-app case.
    const isStandalone =
      window.matchMedia('(display-mode:standalone)').matches ||
      window.navigator.standalone === true;
    if (isStandalone) {
      return !navigator.onLine;
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      await fetch('/manifest.json?_ping=' + Date.now(), {
        method: 'HEAD', cache: 'no-store', signal: ctrl.signal
      });
      clearTimeout(t);
      return false;
    } catch {
      return true;
    }
  }

  function _showOfflineBadge() {
    _injectBadge();
    _isOffline = true;
    clearTimeout(_hideTimer);
    clearTimeout(_textTimer);

    const fn = () => {
      _placeBadge();
      const w = _wrap(), b = _badge(), dot = _dot(), txt = _badgeTxt();
      if (!b) return;

      b.classList.remove('pwa-badge-online', 'pwa-badge-hiding');
      b.classList.add('pwa-badge-offline');
      dot.classList.remove('pwa-dot-online');
      txt.classList.remove('pwa-text-fade');
      txt.textContent = 'Offline';

      w.classList.add('pwa-wrap-show');
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

    const w = _wrap(), b = _badge(), dot = _dot(), txt = _badgeTxt();
    if (!b || !b.classList.contains('pwa-badge-show')) return;

    txt.classList.add('pwa-text-fade');

    _textTimer = setTimeout(() => {
      b.classList.remove('pwa-badge-offline');
      b.classList.add('pwa-badge-online');
      dot.classList.add('pwa-dot-online');
      txt.textContent = 'Back online!';
      txt.classList.remove('pwa-text-fade');

      _hideTimer = setTimeout(() => {
        b.classList.remove('pwa-badge-show');
        b.classList.add('pwa-badge-hiding');

        setTimeout(() => {
          if (!_isOffline) {
            b.classList.remove('pwa-badge-hiding', 'pwa-badge-online');
            b.classList.add('pwa-badge-offline');
            dot.classList.remove('pwa-dot-online');
            w.classList.remove('pwa-wrap-show');
          }
        }, 500);
      }, 2600);
    }, 450);
  }

  const _run = fn => document.body ? fn() : document.addEventListener('DOMContentLoaded', fn);

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
    _onlineDebounce = setTimeout(() => _run(_showOnlineBadge), 400);
  });

  // ── 3. Install prompt ────────────────────────────────────────────────────────

  let _deferredPrompt = null;
  const INSTALL_KEY   = 'pwa_install_dismissed';

  // Detect iOS (Safari on iPhone/iPad). beforeinstallprompt NEVER fires on iOS —
  // users must use Safari's Share sheet → "Add to Home Screen" manually.
  const _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  // Also catch iPad in desktop mode (iPadOS 13+ reports as MacIntel)
  const _isIPadOS = navigator.maxTouchPoints > 1 && /MacIntel/.test(navigator.platform);
  const _isStandalone = window.matchMedia('(display-mode:standalone)').matches
                        || window.navigator.standalone === true;

  // Once installed (standalone mode), permanently suppress the prompt.
  if (_isStandalone) localStorage.setItem(INSTALL_KEY, '1');

  // ── Shared banner styles (injected once) ──────────────────────────────────
  function _injectBannerStyles() {
    if (document.getElementById('__pwa_ib_style')) return;
    const style = document.createElement('style');
    style.id = '__pwa_ib_style';
    const isMobile = window.innerWidth < 768;
    style.textContent = `
      /* Mobile: slides up from bottom above the nav bar */
      /* Desktop: anchored bottom-right as a compact card */
      #__pwa_install_banner {
        position: fixed;
        z-index: 8500;
        background: var(--bg-card, #fff);
        border: 1.5px solid var(--border, #E2D9CF);
        border-radius: var(--r-xl, 24px);
        box-shadow: 0 8px 32px rgba(0,0,0,.14);
        padding: 16px 16px 14px;
        font-family: 'DM Sans', sans-serif;
        transition: transform .4s cubic-bezier(.34,1.4,.64,1), opacity .4s ease;
      }
      @media (max-width: 767px) {
        #__pwa_install_banner {
          bottom: calc(env(safe-area-inset-bottom, 0px) + 72px);
          left: 12px; right: 12px;
          max-width: 480px; margin: 0 auto;
          transform: translateY(130%);
          opacity: 1;
        }
        #__pwa_install_banner.visible { transform: translateY(0); }
      }
      @media (min-width: 768px) {
        #__pwa_install_banner {
          bottom: 24px; right: 24px;
          width: 340px;
          transform: translateY(20px);
          opacity: 0;
        }
        #__pwa_install_banner.visible { transform: translateY(0); opacity: 1; }
      }
      .__pwa_ib_inner   { display:flex; align-items:center; gap:12px; margin-bottom:14px; }
      .__pwa_ib_icon    { width:44px; height:44px; background:var(--ink,#1c1c1c); color:var(--ink-fg,#fff); border-radius:var(--r-md,12px); display:flex; align-items:center; justify-content:center; font-size:1.35rem; font-weight:700; flex-shrink:0; }
      .__pwa_ib_text    { flex:1; min-width:0; }
      .__pwa_ib_title   { font-size:.95rem; font-weight:700; color:var(--text-1,#1c1c1c); letter-spacing:-.01em; }
      .__pwa_ib_sub     { font-size:.78rem; color:var(--text-3,#9a9a9a); margin-top:2px; line-height:1.4; }
      .__pwa_ib_close   { background:none; border:none; font-size:1.3rem; color:var(--text-3,#9a9a9a); cursor:pointer; padding:4px 6px; border-radius:6px; flex-shrink:0; align-self:flex-start; }
      .__pwa_ib_actions { display:flex; gap:10px; }
      .__pwa_ib_btn_secondary { flex:1; padding:10px; border-radius:var(--r-md,12px); border:1.5px solid var(--border,#E2D9CF); background:transparent; color:var(--text-2,#5a5a5a); font-family:'DM Sans',sans-serif; font-size:.88rem; font-weight:600; cursor:pointer; }
      .__pwa_ib_btn_primary   { flex:2; padding:10px; border-radius:var(--r-md,12px); border:none; background:var(--ink,#1c1c1c); color:var(--ink-fg,#fff); font-family:'DM Sans',sans-serif; font-size:.88rem; font-weight:700; cursor:pointer; }
      /* iOS step list */
      .__pwa_ib_steps { margin:0 0 14px; padding:0; list-style:none; display:flex; flex-direction:column; gap:6px; }
      .__pwa_ib_steps li { display:flex; align-items:center; gap:8px; font-size:.82rem; color:var(--text-2,#5a5a5a); }
      .__pwa_ib_steps li span { font-size:1.1em; }
      .__pwa_ib_safari_warn { font-size:.75rem; color:var(--text-3,#9a9a9a); margin-bottom:12px; padding:7px 10px; border-radius:8px; background:rgba(245,158,11,.08); border:1px solid rgba(245,158,11,.25); line-height:1.4; }
    `;
    document.head.appendChild(style);
  }

  // ── Android / Chrome / Desktop install banner ────────────────────────────
  function _showInstallBanner() {
    if (document.getElementById('__pwa_install_banner')) return;
    _injectBannerStyles();
    const banner = document.createElement('div');
    banner.id = '__pwa_install_banner';
    banner.innerHTML = `
      <div class="__pwa_ib_inner">
        <div class="__pwa_ib_icon">₹</div>
        <div class="__pwa_ib_text">
          <div class="__pwa_ib_title">Install Finance Tracker</div>
          <div class="__pwa_ib_sub">Use it like a native app — works offline too</div>
        </div>
        <button class="__pwa_ib_close" id="__pwa_ib_close" aria-label="Dismiss">×</button>
      </div>
      <div class="__pwa_ib_actions">
        <button class="__pwa_ib_btn_secondary" id="__pwa_ib_maybe">Not now</button>
        <button class="__pwa_ib_btn_primary"   id="__pwa_ib_install">Install app</button>
      </div>`;
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

  // ── iOS banner — manual instructions (beforeinstallprompt never fires) ───
  function _showIOSBanner() {
    if (document.getElementById('__pwa_install_banner')) return;
    _injectBannerStyles();

    // Detect if they're NOT in Safari — Chrome/Firefox on iOS can't install PWAs.
    const inSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    const banner = document.createElement('div');
    banner.id = '__pwa_install_banner';

    if (!inSafari) {
      // Wrong browser — tell them to switch to Safari
      banner.innerHTML = `
        <div class="__pwa_ib_inner">
          <div class="__pwa_ib_icon">₹</div>
          <div class="__pwa_ib_text">
            <div class="__pwa_ib_title">Install Finance Tracker</div>
            <div class="__pwa_ib_sub">Open this page in <strong>Safari</strong> to add it to your Home Screen</div>
          </div>
          <button class="__pwa_ib_close" id="__pwa_ib_close" aria-label="Dismiss">×</button>
        </div>
        <div class="__pwa_ib_safari_warn">
          ⚠️ Chrome and Firefox on iOS cannot install web apps. Copy this URL and open it in Safari.
        </div>
        <div class="__pwa_ib_actions">
          <button class="__pwa_ib_btn_secondary" id="__pwa_ib_maybe">Dismiss</button>
          <button class="__pwa_ib_btn_primary" id="__pwa_ib_copy">Copy URL</button>
        </div>`;
    } else {
      // In Safari — show step-by-step instructions
      banner.innerHTML = `
        <div class="__pwa_ib_inner">
          <div class="__pwa_ib_icon">₹</div>
          <div class="__pwa_ib_text">
            <div class="__pwa_ib_title">Add to Home Screen</div>
            <div class="__pwa_ib_sub">Install Finance Tracker as an app</div>
          </div>
          <button class="__pwa_ib_close" id="__pwa_ib_close" aria-label="Dismiss">×</button>
        </div>
        <ol class="__pwa_ib_steps">
          <li><span>1.</span> Tap the <strong>Share</strong> button <span>⎙</span> at the bottom of Safari</li>
          <li><span>2.</span> Scroll down and tap <strong>"Add to Home Screen"</strong></li>
          <li><span>3.</span> Tap <strong>Add</strong> — done!</li>
        </ol>
        <div class="__pwa_ib_actions">
          <button class="__pwa_ib_btn_secondary" id="__pwa_ib_maybe">Not now</button>
          <button class="__pwa_ib_btn_primary" id="__pwa_ib_got_it">Got it</button>
        </div>`;
    }

    document.body.appendChild(banner);
    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('visible')));

    function _dismiss(perm) {
      banner.classList.remove('visible');
      if (perm) localStorage.setItem(INSTALL_KEY, '1');
      setTimeout(() => banner.remove(), 500);
    }

    document.getElementById('__pwa_ib_close').addEventListener('click', () => _dismiss(true));
    document.getElementById('__pwa_ib_maybe').addEventListener('click', () => _dismiss(false));

    const gotItBtn = document.getElementById('__pwa_ib_got_it');
    if (gotItBtn) gotItBtn.addEventListener('click', () => _dismiss(true));

    const copyBtn = document.getElementById('__pwa_ib_copy');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(window.location.href); } catch {}
      copyBtn.textContent = 'Copied!';
      setTimeout(() => _dismiss(true), 1200);
    });
  }

  // ── Settings install button helpers ──────────────────────────────────────

  function _showSettingsInstallBtn() {
    const _apply = () => {
      const btn = document.getElementById('btnInstallApp');
      if (btn) btn.style.display = '';
    };
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', _apply)
      : _apply();
  }

  function _hideSettingsInstallBtn() {
    const btn = document.getElementById('btnInstallApp');
    if (btn) btn.style.display = 'none';
  }

  // ── Global trigger — called by the settings drawer "Install App" button ──
  window.triggerPWAInstall = function () {
    if (_deferredPrompt) {
      // Android / Chrome / Desktop — native install prompt
      _deferredPrompt.prompt();
      _deferredPrompt.userChoice.then(({ outcome }) => {
        if (outcome === 'accepted') {
          localStorage.setItem(INSTALL_KEY, '1');
          _hideSettingsInstallBtn();
        }
        _deferredPrompt = null;
      });
    } else if (_isIOS || _isIPadOS) {
      // iOS — show manual instructions banner
      _showIOSBanner();
    }
  };

  // ── Wire up events ────────────────────────────────────────────────────────

  // Android / Chrome / Desktop: browser fires beforeinstallprompt when installable.
  // Show on ALL screen sizes — desktop users install PWAs too.
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredPrompt = e;
    // Always reveal the settings button so the user can install on demand.
    _showSettingsInstallBtn();
    if (localStorage.getItem(INSTALL_KEY)) return;
    setTimeout(_showInstallBanner, 3000);
  });

  // iOS: beforeinstallprompt never fires — reveal the settings button so
  // the user can tap it to see manual install instructions.
  if ((_isIOS || _isIPadOS) && !_isStandalone && !localStorage.getItem(INSTALL_KEY)) {
    _showSettingsInstallBtn();
    const _iosRun = fn => document.body ? fn() : document.addEventListener('DOMContentLoaded', fn);
    _iosRun(() => setTimeout(_showIOSBanner, 3000));
  }

})();