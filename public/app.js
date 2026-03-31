let uid             = null;
let transactions    = [];
let prevTransactionIds = new Set();
let isFirstLoad = true;
let pendingAmounts  = [];
let categories      = { income: [], expense: [] };
let startingBalance = 0;
let editTxId        = null;
let activeView      = 'dashboard';

// —— Pending-sync pill tracking —————————————————————————————
let _pendingTxIds   = new Set(); // IDs currently hasPendingWrites
let _justSyncedIds  = new Set(); // IDs that just confirmed — show green briefly
const _syncTimers   = {};        // cleanup timers per txId

// —— Multi-account state ————————————————————————————————————
let activeAccountId    = null;  // currently selected bank account ID
let accounts           = [];    // [{id, name, createdAt}]
let _unsubTransactions = null;  // unsubscribe fn for transaction listener
let _unsubAccounts     = null;  // unsubscribe fn for accounts listener
let _unsubPending      = null;  // unsubscribe fn for pending listener

// —— Undo-delete state ——————————————————————————————————————
let _undoPendingId   = null;  // ID currently held back from Firestore delete
let _undoTimer       = null;  // 4s countdown before hard-delete fires
let _undoTxSnapshot  = null;  // snapshot of deleted tx data (for re-adds if needed)


function txCol()        { return window.collection(window.db, 'users', uid, 'accounts', activeAccountId, 'transactions'); }
function pendingCol()   { return window.collection(window.db, 'users', uid, 'accounts', activeAccountId, 'pending'); }
function txDocRef(id)   { return window.doc(window.db, 'users', uid, 'accounts', activeAccountId, 'transactions', id); }
function pendDocRef(id) { return window.doc(window.db, 'users', uid, 'accounts', activeAccountId, 'pending', id); }
function catDocRef()    { return window.doc(window.db, 'users', uid, 'accounts', activeAccountId, 'categories', 'data'); }
function settDocRef()   { return window.doc(window.db, 'users', uid, 'accounts', activeAccountId, 'settings', 'general'); }
function acctColRef()   { return window.collection(window.db, 'users', uid, 'accounts'); }
function acctDocRef(id) { return window.doc(window.db, 'users', uid, 'accounts', id); }

function _once(q) {
  return new Promise((res, rej) => {
    const u = window.onSnapshot(q, s => { u(); res(s); }, rej);
  });
}

(function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle  = document.getElementById('sidebarToggle');
  if (!sidebar || !toggle) return;

  function _setSidebarWidth() {
    const nameEl = sidebar.querySelector('.sidebar-account-name');
    if (!nameEl) return;

    const MIN_W = 176;
    const PADDING = 84; // icon(44) + gap(7) + change-btn(26) + gaps/padding(~7)
    const canvas = _setSidebarWidth._canvas || (_setSidebarWidth._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    const style = window.getComputedStyle(nameEl);
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const textW = ctx.measureText(nameEl.textContent || '').width;
    const needed = Math.ceil(textW) + PADDING;
    const finalW = Math.max(MIN_W, needed);
    sidebar.style.setProperty('--sidebar-open-w', finalW + 'px');
  }

  toggle.addEventListener('click', () => {
    const isCollapsed = sidebar.classList.contains('collapsed');
    if (isCollapsed) {
      _setSidebarWidth();
      sidebar.classList.remove('collapsed');
      document.body.classList.add('sidebar-expanded');
    } else {
      sidebar.classList.add('collapsed');
      document.body.classList.remove('sidebar-expanded');
    }
  });

  window._recalcSidebarWidth = _setSidebarWidth;
})();let activePeriod    = 'daily';
let monthlyType     = 'expense';
let yearlyType      = 'expense';

window._allDataLoaded = false;


function hideLoader() {
  const l = document.getElementById('pageLoader');
  if (l) { l.style.opacity = '0'; setTimeout(() => l.remove(), 300); }
}

const _snack = {
  _el:   null,
  _msg:  null,
  _btn:  null,
  _prog: null,

  _init() {
    if (this._el) return;
    this._el   = document.getElementById('undoSnackbar');
    this._msg  = document.getElementById('undoSnackMsg');
    this._btn  = document.getElementById('undoSnackBtn');
    this._prog = document.getElementById('undoSnackProgress');
    if (this._btn) this._btn.addEventListener('click', () => _undoDelete());
  },

  show(msg) {
    this._init();
    if (!this._el) return;
    this._msg.textContent = msg;
    if (this._el.classList.contains('show')) {
      // Already visible — restart only the progress bar, no layout flush.
      if (this._prog) {
        this._prog.style.animation = 'none';
        requestAnimationFrame(() => { this._prog.style.animation = ''; });
      }
    } else {
      this._el.classList.add('show');
    }
  },

  hide() {
    this._init();
    if (!this._el) return;
    this._el.classList.remove('show');
  }
};

window.firebaseReady.then(() => {
  if (window.NLP) NLP.preload();
  window.onAuthStateChanged(window.auth, async user => {
    if (!user) {
      window.location.replace('landing.html');
      return;
    }
    uid = user.uid;
    document.body.classList.remove('auth-pending');
    // Tear down any previous account listener from a prior auth session
    if (_unsubAccounts) { _unsubAccounts(); _unsubAccounts = null; }
    isFirstLoad = true;
    window._allDataLoaded = false;
    window._dataLoaded = {
      categories: false,
      settings: false,
      transactions: false,
      pending: false
    };

    window._checkAllDataLoaded = function() {
      const d = window._dataLoaded;
      if (d.categories && d.settings && d.transactions && d.pending) {
        console.log('[App] All data loaded, hiding loader');
        window._allDataLoaded = true;
        renderStats();
        renderTxList();
        setTimeout(hideLoader, 300);
      }
    };

    document.getElementById('acctEmail').textContent = user.email || '—';

    (function populateProfile() {
      const photo = user.photoURL;
      const email = user.email || '';
      const savedName = localStorage.getItem('profileName_' + user.uid) || '';
      const displayName = savedName || user.displayName || '';
      const initials = (displayName || email).replace(/[@+].*/, '').slice(0, 2).toUpperCase() || '?';

      const panelImg = document.getElementById('profilePanelImg');
      const panelIni = document.getElementById('profilePanelInitials');
      if (photo) { panelImg.src = photo; panelImg.style.display = ''; panelIni.style.display = 'none'; }
      else { panelIni.textContent = initials; panelIni.style.display = ''; panelImg.style.display = 'none'; }

      document.getElementById('profilePanelName').textContent = displayName || email.split('@')[0];
      document.getElementById('profilePanelEmail').textContent = email;
      document.getElementById('profileNameInput').value = displayName;

      const dashImg = document.getElementById('dashAvatarImg');
      const dashIni = document.getElementById('dashAvatarInitials');
      if (dashImg && dashIni) {
        if (photo) { dashImg.src = photo; dashImg.style.display = ''; dashIni.style.display = 'none'; }
        else { dashIni.textContent = initials; dashIni.style.display = ''; dashImg.style.display = 'none'; }
      }
    })();

    const _greetEl = document.getElementById('dashGreeting');
    if (_greetEl) {
      const _savedN = localStorage.getItem('profileName_' + user.uid);
      const _name = (_savedN || user.displayName || user.email || '').split(/[@\s]/)[0];
      const _hr = new Date().getHours();
      const _day = new Date().getDay();

      const _morningGreets  = ['Morning', 'Good morning', 'Rise and shine', 'Early bird'];
      const _afternoonGreets = ['Afternoon', 'Good afternoon', "Hope your day's going well"];
      const _eveningGreets  = ['Evening', 'Good evening', "Hope it's been a good day"];
      const _lateGreets     = ['Burning the midnight oil', 'Up late', 'Night owl mode'];
      const _weekendGreets  = ['Happy weekend', 'Enjoy your day off', 'Weekend vibes'];

      let _pool;
      if (_day === 0 || _day === 6)  _pool = _weekendGreets;
      else if (_hr < 12)             _pool = _morningGreets;
      else if (_hr < 17)             _pool = _afternoonGreets;
      else if (_hr < 21)             _pool = _eveningGreets;
      else                           _pool = _lateGreets;

      const _tod = _pool[Math.floor(Math.random() * _pool.length)];
      _greetEl.textContent = _tod;
      const _nameEl = document.getElementById('dashGreetingName');
      if (_nameEl) _nameEl.textContent = _name || 'there';
    }
    const ts = user.metadata.creationTime;
    if (ts) document.getElementById('acctJoined').textContent =
      new Date(ts).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

    const today = new Date();
    document.getElementById('txDate').valueAsDate  = today;
    document.getElementById('dailyDate').value     = toInputDate(today);
    initMonthDropdown(today);
    document.getElementById('yearlyYear').value    = today.getFullYear();
    document.getElementById('cashflowYear').value  = today.getFullYear();

    await initAccounts();
    await loadCategories();
    await loadSettings();
    listenPending();
    listenTransactions();
    wireSettingsDrawer();
    wireAddTxForm();
    wireAddPending();
    wireAccountSwitcher();
  });
});

function toInputDate(d) { return d ? d.toISOString().split('T')[0] : ''; }
function toDate(v) {
  if (v == null) return null;
  if (v.toDate) return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function fmt(n) {
  const abs = Math.abs(n);
  const str = '₹' + abs.toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
  return n < 0 ? '-' + str : str;
}
function vibrate() { if (navigator.vibrate) navigator.vibrate(40); }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wireBottomSheetDrag(panel, closeFn) {
  if (!panel) return;

  const handle = document.createElement("div");
  handle.className = "drag-handle";
  panel.insertBefore(handle, panel.firstChild);

  let startY = 0;
  let lastY  = 0;
  let dragging = false;
  let startedOnHandle = false;

  panel.addEventListener("touchstart", function(e) {
    if (window.innerWidth >= 600) return;
    startY   = e.touches[0].clientY;
    lastY    = startY;
    dragging = false;
    // The handle has pointer-events:none so e.target is never the handle element.
    // Instead, check whether the touch Y coordinate falls within the handle's
    // rendered area (expanded by a generous hit-zone so it's easy to grab).
    var hr = handle.getBoundingClientRect();
    var hitTop    = hr.top    - 16;
    var hitBottom = hr.bottom + 16;
    startedOnHandle = startY >= hitTop && startY <= hitBottom;
  }, { passive: true });

  panel.addEventListener("touchmove", function(e) {
    if (window.innerWidth >= 600) return;
    lastY = e.touches[0].clientY;
    var dy = lastY - startY;
    // Dragging is only initiated when the touch originated on the drag handle
    if (!dragging && dy > 8 && startedOnHandle) {
      dragging = true;
    }
    if (!dragging) return;
    var offset = Math.max(0, dy);
    // translate3d keeps the element on its GPU compositor layer during drag;
    // transition:none removes the easing so drag tracking is 1:1 with finger.
    panel.style.transition = "none";
    panel.style.transform  = "translate3d(0," + offset + "px,0)";
  }, { passive: true });

  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    var dy = lastY - startY;
    if (dy > 80) {
      // Dismissed — clear inline styles before closeFn triggers CSS transition
      panel.style.transition = "";
      panel.style.transform  = "";
      closeFn();
    } else {
      // Partial drag: spring back with a fast elastic ease instead of an
      // abrupt snap. Use a slightly shorter duration than the open animation
      // so the spring-back feels responsive, not sluggish.
      panel.style.transition = "transform .32s cubic-bezier(0.32, 0.72, 0, 1)";
      panel.style.transform  = "translate3d(0,0,0)";
      // Remove the inline transition once it completes so the CSS rule takes over
      var _t = setTimeout(function() { panel.style.transition = ""; }, 340);
      // Guard: if another drag starts before the timer fires, cancel it
      panel.addEventListener("touchstart", function _cleanup() {
        clearTimeout(_t);
        panel.style.transition = "";
        panel.removeEventListener("touchstart", _cleanup);
      }, { once: true, passive: true });
    }
  }

  panel.addEventListener("touchend",    onDragEnd);
  panel.addEventListener("touchcancel", function() {
    if (!dragging) return;
    dragging = false;
    // Same spring-back on cancel
    panel.style.transition = "transform .32s cubic-bezier(0.32, 0.72, 0, 1)";
    panel.style.transform  = "translate3d(0,0,0)";
    setTimeout(function() { panel.style.transition = ""; }, 340);
  });
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function initMonthDropdown(currentDate, txList) {
  const select = document.getElementById('monthlyDate');
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  const prevSelected = select.value;

  let startYear = currentYear - 2;
  if (txList && txList.length) {
    const years = txList.map(t => { const d = toDate(t.selectedDate); return d ? d.getFullYear() : NaN; }).filter(y => !isNaN(y));
    if (years.length) startYear = Math.min(...years, startYear);
  }

  select.innerHTML = '';

  for (let year = startYear; year <= currentYear + 1; year++) {
    for (let month = 0; month < 12; month++) {
      const option = document.createElement('option');
      const value = `${year}-${String(month + 1).padStart(2, '0')}`;
      option.value = value;
      option.textContent = `${MONTHS[month]} ${year}`;
      select.appendChild(option);
    }
  }

  if (prevSelected && select.querySelector(`option[value="${prevSelected}"]`)) {
    select.value = prevSelected;
  } else {
    const defaultVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    select.value = defaultVal;
  }
}


function wireSettingsDrawer() {
  const btnOpen   = document.getElementById('btnSettings');
  const backdrop  = document.getElementById('settingsBackdrop');
  const drawer    = document.getElementById('settingsDrawer');
  const btnClose  = document.getElementById('btnCloseSettings');
  const btnOut    = document.getElementById('btnSignOut');
  const btnCats   = document.getElementById('btnOpenCats');
  const btnSaveBal= document.getElementById('saveStartingBalance');
  const balInput  = document.getElementById('startingBalanceInput');
  const saveBtn   = document.getElementById('profileNameSave');
  const nameInput = document.getElementById('profileNameInput');

  function openDrawer() {
    drawer.classList.add('open');
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  btnOpen.addEventListener('click', openDrawer);

  const bnSettingsBtn = document.getElementById('bnSettings');
  if (bnSettingsBtn) {
    bnSettingsBtn.addEventListener('click', () => {
      ['bnDash','bnAnalytics','bnTransactions','bnSettings'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      bnSettingsBtn.classList.add('active');
      openDrawer();
    });
  }

  function closeDrawerAndRestoreNav() {
    closeDrawer();
    const bnMap = { dashboard: 'bnDash', analytics: 'bnAnalytics', transactions: 'bnTransactions' };
    ['bnDash','bnAnalytics','bnTransactions','bnSettings'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });
    const activeEl = document.getElementById(bnMap[activeView] || 'bnDash');
    if (activeEl) activeEl.classList.add('active');
  }
  btnClose.addEventListener('click', closeDrawerAndRestoreNav);
  backdrop.addEventListener('click', closeDrawerAndRestoreNav);

  wireBottomSheetDrag(drawer, closeDrawerAndRestoreNav);
  const btnImportCSV = document.getElementById('btnImportCSV');
  if (btnImportCSV) {
    btnImportCSV.addEventListener('click', () => {
      closeDrawerAndRestoreNav();
      openImportModal();
    });
  }

  const btnExportCSV = document.getElementById('btnExportCSV');
  if (btnExportCSV) {
    btnExportCSV.addEventListener('click', async () => {
      if (!transactions.length) { alert('No transactions to export.'); return; }
      const orig = btnExportCSV.innerHTML;
      btnExportCSV.innerHTML = '<span class="btn-spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px;display:inline-block;vertical-align:middle;"></span>Exporting…';
      btnExportCSV.disabled = true;
      await new Promise(r => setTimeout(r, 40)); // allow repaint
      try {
        const rows = [['Date','Type','Category','Amount','Description']];
        txSorted(transactions).slice().reverse().forEach(tx => {
          const d = toDate(tx.selectedDate);
          if (!d) return;
          const dateStr = [
            String(d.getMonth()+1).padStart(2,'0'),
            String(d.getDate()).padStart(2,'0'),
            d.getFullYear()
          ].join('/');
          const desc = (tx.description||'').replace(/"/g,'""');
          rows.push([dateStr, tx.type, tx.category, tx.amount, `"${desc}"`]);
        });
        const csv = rows.map(r => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const today = new Date();
        a.href = url;
        a.download = `transactions_${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        btnExportCSV.innerHTML = '✓ Exported';
        btnExportCSV.style.color = 'var(--green)';
        setTimeout(() => {
          btnExportCSV.innerHTML = orig;
          btnExportCSV.style.color = '';
          btnExportCSV.disabled = false;
        }, 2000);
      } catch(e) {
        alert('Export failed: ' + e.message);
        btnExportCSV.innerHTML = orig;
        btnExportCSV.disabled = false;
      }
    });
  }


  if (saveBtn && nameInput) {
    saveBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) return;
      localStorage.setItem('profileName_' + uid, name);
      document.getElementById('profilePanelName').textContent = name;
      const user = window.auth && window.auth.currentUser;
      if (user && !user.photoURL) {
        const ini = name.slice(0, 2).toUpperCase();
        document.getElementById('profilePanelInitials').textContent = ini;
      }
      const nameEl = document.getElementById('dashGreetingName');
      if (nameEl) nameEl.textContent = name;
      const dashIni2 = document.getElementById('dashAvatarInitials');
      const dashImg2 = document.getElementById('dashAvatarImg');
      const _user = window.auth && window.auth.currentUser;
      if (dashIni2 && dashImg2 && !(_user && _user.photoURL)) {
        dashIni2.textContent = name.slice(0, 2).toUpperCase();
      }
      saveBtn.textContent = '✓ Saved';
      saveBtn.style.background = 'var(--green)';
      saveBtn.style.color = '#fff';
      setTimeout(() => {
        saveBtn.textContent = 'Save';
        saveBtn.style.background = '';
        saveBtn.style.color = '';
      }, 1800);
    });
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });
  }

  btnOut.addEventListener('click', () => {
    _showSignOutToast();
  });

  const _signOutToast      = document.getElementById('signOutToast');
  const _signOutBackdrop   = document.getElementById('signOutBackdrop');
  const _signOutConfirmBtn = document.getElementById('signOutConfirmBtn');
  const _signOutCancelBtn  = document.getElementById('signOutCancelBtn');
  let _signOutTimer = null;

  function _showSignOutToast() {
    if (_signOutTimer) { clearTimeout(_signOutTimer); _signOutTimer = null; }
    _signOut_hideUndo(); // hide undo snackbar if visible
    _signOutBackdrop.classList.add('show');
    _signOutToast.classList.add('show');
    _signOutTimer = setTimeout(_hideSignOutToast, 6000);
  }

  function _hideSignOutToast() {
    _signOutToast.classList.remove('show');
    _signOutBackdrop.classList.remove('show');
    if (_signOutTimer) { clearTimeout(_signOutTimer); _signOutTimer = null; }
  }

  function _signOut_hideUndo() {
    const undo = document.getElementById('undoSnackbar');
    if (undo) undo.classList.remove('show');
  }

  _signOutCancelBtn.addEventListener('click', _hideSignOutToast);
  _signOutBackdrop.addEventListener('click', _hideSignOutToast);

  _signOutConfirmBtn.addEventListener('click', async () => {
    _hideSignOutToast();
    localStorage.removeItem('skipDeleteConfirm');
    await window.fbSignOut(window.auth).catch(console.error);
    window.location.replace('login.html');
  });

  btnCats.addEventListener('click', () => { closeDrawer(); openCatsModal(); });

  const btnChangePwd    = document.getElementById('btnChangePassword');
  const cpBackdrop      = document.getElementById('changePwdBackdrop');
  const btnClosePwd     = document.getElementById('btnClosePwdModal');
  const btnCancelPwd    = document.getElementById('btnCancelPwdModal');
  const btnSubmitPwd    = document.getElementById('btnSubmitPwdChange');
  const cpFormState     = document.getElementById('cpFormState');
  const cpGoogleState   = document.getElementById('cpGoogleState');
  const cpSuccessState  = document.getElementById('cpSuccessState');
  const cpErrEl         = document.getElementById('cpErr');

  const CP_ERR = {
    'auth/wrong-password':          'Current password is incorrect.',
    'auth/weak-password':           'New password must be at least 6 characters.',
    'auth/too-many-requests':       'Too many attempts — please wait a moment.',
    'auth/network-request-failed':  'Network error — check your connection.',
    'auth/requires-recent-login':   'For security, please sign out and sign back in before changing your password.',
    'auth/invalid-credential':      'Current password is incorrect.',
  };

  function showCpErr(msg) {
    cpErrEl.textContent = msg;
    cpErrEl.classList.toggle('show', !!msg);
  }

  function openChangePwdModal() {
    cpFormState.style.display    = '';
    cpGoogleState.style.display  = 'none';
    cpSuccessState.style.display = 'none';
    showCpErr('');
    document.getElementById('cpCurrentPwd').value  = '';
    document.getElementById('cpNewPwd').value      = '';
    document.getElementById('cpConfirmPwd').value  = '';
    document.getElementById('pwdStrengthWrap').style.display = 'none';
    btnSubmitPwd.disabled  = false;
    btnSubmitPwd.innerHTML = 'Update Password';
    btnSubmitPwd.style.background = '';
    btnSubmitPwd.style.color      = '';

    const user = window.auth && window.auth.currentUser;
    const isEmailUser = user && user.providerData.some(p => p.providerId === 'password');
    if (!isEmailUser) {
      cpFormState.style.display   = 'none';
      cpGoogleState.style.display = '';
    }

    cpBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (isEmailUser) setTimeout(() => document.getElementById('cpCurrentPwd').focus(), 340);
  }

  function closeChangePwdModal() {
    cpBackdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (btnChangePwd)  btnChangePwd.addEventListener('click', () => { closeDrawer(); openChangePwdModal(); });
  if (btnClosePwd)   btnClosePwd.addEventListener('click', closeChangePwdModal);
  if (btnCancelPwd)  btnCancelPwd.addEventListener('click', closeChangePwdModal);
  if (cpBackdrop)    cpBackdrop.addEventListener('click', e => { if (e.target === cpBackdrop) closeChangePwdModal(); });

  document.querySelectorAll('.pwd-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.target);
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      btn.classList.toggle('active', inp.type === 'text');
    });
  });

  window.updatePwdStrength = function(val) {
    const wrap  = document.getElementById('pwdStrengthWrap');
    const fill  = document.getElementById('pwdStrengthFill');
    const label = document.getElementById('pwdStrengthLabel');
    if (!val) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    let score = 0;
    if (val.length >= 8)           score++;
    if (val.length >= 12)          score++;
    if (/[A-Z]/.test(val))         score++;
    if (/[0-9]/.test(val))         score++;
    if (/[^A-Za-z0-9]/.test(val))  score++;
    const levels = [
      { w: '20%',  color: 'var(--red)',    text: 'Too weak'  },
      { w: '40%',  color: 'var(--red)',    text: 'Weak'      },
      { w: '60%',  color: 'var(--orange)', text: 'Fair'      },
      { w: '80%',  color: 'var(--orange)', text: 'Good'      },
      { w: '100%', color: 'var(--green)',  text: 'Strong'    },
    ];
    const lvl = levels[Math.min(score, 4)];
    fill.style.width      = lvl.w;
    fill.style.background = lvl.color;
    label.textContent     = lvl.text;
    label.style.color     = lvl.color;
  };

  if (btnSubmitPwd) {
    btnSubmitPwd.addEventListener('click', async () => {
      showCpErr('');
      const currentPwd = document.getElementById('cpCurrentPwd').value;
      const newPwd     = document.getElementById('cpNewPwd').value;
      const confirmPwd = document.getElementById('cpConfirmPwd').value;

      if (!currentPwd) { showCpErr('Please enter your current password.'); document.getElementById('cpCurrentPwd').focus(); return; }
      if (!newPwd)     { showCpErr('Please enter a new password.');         document.getElementById('cpNewPwd').focus();     return; }
      if (newPwd.length < 6) { showCpErr('New password must be at least 6 characters.'); document.getElementById('cpNewPwd').focus(); return; }
      if (newPwd !== confirmPwd) { showCpErr('Passwords do not match.'); document.getElementById('cpConfirmPwd').focus(); return; }
      if (newPwd === currentPwd) { showCpErr('New password must be different from current password.'); document.getElementById('cpNewPwd').focus(); return; }

      btnSubmitPwd.disabled  = true;
      btnSubmitPwd.innerHTML = '<span class="btn-spinner"></span> Updating…';

      try {
        const user       = window.auth.currentUser;
        const credential = window.EmailAuthProvider.credential(user.email, currentPwd);
        await window.reauthenticateWithCredential(user, credential);
        await window.updatePassword(user, newPwd);
        cpFormState.style.display    = 'none';
        cpSuccessState.style.display = '';
        cpSuccessState.style.opacity = '0';
        cpSuccessState.style.transform = 'scale(.96)';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          cpSuccessState.style.transition = 'opacity .3s ease, transform .3s ease';
          cpSuccessState.style.opacity    = '1';
          cpSuccessState.style.transform  = 'scale(1)';
        }));
        setTimeout(closeChangePwdModal, 2600);
      } catch (err) {
        showCpErr(CP_ERR[err.code] || 'Something went wrong. Please try again.');
        btnSubmitPwd.disabled  = false;
        btnSubmitPwd.innerHTML = 'Update Password';
      }
    });

    document.getElementById('cpConfirmPwd').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); btnSubmitPwd.click(); }
    });
  }

  btnSaveBal.addEventListener('click', async () => {
    const raw = balInput.value.replace(/,/g,'').trim();
    const val = parseFloat(raw);
    if (isNaN(val) || val < 0) { alert('Enter a valid starting balance (e.g. 10000)'); return; }
    startingBalance = val;
    await saveSettings();
    renderStats();
    if (activePeriod === 'cashflow') renderCashflow();
    btnSaveBal.textContent = '✓ Saved!';
    btnSaveBal.style.background = 'var(--green)';
    btnSaveBal.style.color = '#fff';
    setTimeout(() => {
      btnSaveBal.textContent = 'Save Balance';
      btnSaveBal.style.background = '';
      btnSaveBal.style.color = '';
    }, 2000);
  });
}

window.showView = function(v) {
  activeView = v;

  const _drawer   = document.getElementById('settingsDrawer');
  const _backdrop = document.getElementById('settingsBackdrop');
  if (_drawer && _drawer.classList.contains('open')) {
    _drawer.classList.remove('open');
    _backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (window.closeAddTxSheet) window.closeAddTxSheet();

  if (window.closePendingSheet) window.closePendingSheet();

  const _catsBg = document.getElementById('catsModalBg');
  if (_catsBg && _catsBg.classList.contains('open')) {
    window.closeCatsModal();
  }

  const _txBg = document.getElementById('txDetailBg');
  if (_txBg && _txBg.classList.contains('open')) {
    window.closeTxDetail && window.closeTxDetail();
  }

  document.getElementById('viewDashboard').classList.toggle('hidden', v !== 'dashboard');
  document.getElementById('viewAnalytics').classList.toggle('hidden', v !== 'analytics');
  document.getElementById('viewTransactions').classList.toggle('hidden', v !== 'transactions');
  const bnMap = { dashboard: 'bnDash', analytics: 'bnAnalytics', transactions: 'bnTransactions' };
  ['bnDash','bnAnalytics','bnTransactions','bnSettings'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  if (bnMap[v]) {
    const el = document.getElementById(bnMap[v]);
    if (el) el.classList.add('active');
  }
  if (v === 'analytics') refreshCurrentPeriod();
  if (v === 'transactions') {
    populateTxCategoryFilter();
    renderAllTxList();
  }
  ['sidebarDash','sidebarAnalytics','sidebarTransactions'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const sidebarMap = { dashboard: 'sidebarDash', analytics: 'sidebarAnalytics', transactions: 'sidebarTransactions' };
  if (sidebarMap[v]) { const el = document.getElementById(sidebarMap[v]); if (el) el.classList.add('active'); }
};

const PERIODS = ['daily','monthly','yearly','cashflow'];

window.showPeriod = function(p) {
  activePeriod = p;
  PERIODS.forEach(id => {
    const periodEl = document.getElementById('period' + cap(id));
    const tabEl    = document.getElementById('pt' + cap(id));
    if (periodEl) periodEl.classList.toggle('hidden', id !== p);
    if (tabEl)    tabEl.classList.toggle('active', id === p);
  });
  refreshCurrentPeriod();
};

function cap(s) { return s[0].toUpperCase() + s.slice(1); }

function refreshCurrentPeriod() {
  if (activePeriod === 'daily')    renderDaily();
  if (activePeriod === 'monthly')  renderMonthly();
  if (activePeriod === 'yearly')   renderYearly();
  if (activePeriod === 'cashflow') renderCashflow();
}


window.setMonthlyType = function(type) {
  monthlyType = type;
  document.getElementById('btnMonthlyExpense').classList.toggle('active', type === 'expense');
  document.getElementById('btnMonthlyIncome').classList.toggle('active', type === 'income');
  renderMonthly();
};

window.setYearlyType = function(type) {
  yearlyType = type;
  document.getElementById('btnYearlyExpense').classList.toggle('active', type === 'expense');
  document.getElementById('btnYearlyIncome').classList.toggle('active', type === 'income');
  renderYearly();
};

async function loadCategories() {
  const snap = await window.getDoc(catDocRef());
  if (snap.exists()) {
    const d = snap.data();
    categories = { income: d.income||[], expense: d.expense||[] };
  } else {
    categories = {
      income: [
        {name:'Salary',     color:'#0FA974'},
        {name:'Freelance',  color:'#3b82f6'},
        {name:'Business',   color:'#8b5cf6'},
        {name:'Investment', color:'#06b6d4'},
        {name:'Other',      color:'#6366f1'},
      ],
      expense: [
        {name:'Food & Dining',    color:'#E84545'},
        {name:'Transport',        color:'#f97316'},
        {name:'Shopping',         color:'#ec4899'},
        {name:'Bills & Utilities',color:'#f59e0b'},
        {name:'Entertainment',    color:'#a855f7'},
        {name:'Healthcare',       color:'#14b8a6'},
        {name:'Education',        color:'#3b82f6'},
        {name:'Travel',           color:'#06b6d4'},
        {name:'Other',            color:'#6b7280'},
      ]
    };
    await saveCategories();
  }
  populateCategoryDropdowns();
  if (window._dataLoaded) {
    window._dataLoaded.categories = true;
    renderQuickCats();
    window._checkAllDataLoaded();
  }
}

function triggerNewTransactionAnimations() {
  requestAnimationFrame(() => {
    const newItems = document.querySelectorAll('[data-is-new="true"]');
    newItems.forEach((el, index) => {
      setTimeout(() => {
        el.removeAttribute('data-is-new');
        el.classList.add('tx-adding');
        setTimeout(() => {
          el.classList.remove('tx-adding');
        }, 300);
      }, index * 50);
    });
  });
}

async function saveCategories() {
  await window.setDoc(
    catDocRef(),
    { income: categories.income, expense: categories.expense, updatedAt: window.serverTimestamp() }
  );
}

async function loadSettings() {
  try {
    const snap = await window.getDoc(settDocRef());
    if (snap.exists()) startingBalance = Number(snap.data().startingBalance) || 0;
    const inp = document.getElementById('startingBalanceInput');
    if (inp) inp.value = startingBalance > 0 ? startingBalance : '';
  } catch(e) { console.error('loadSettings', e); }
  if (window._dataLoaded) { window._dataLoaded.settings = true; window._checkAllDataLoaded(); }
}

async function saveSettings() {
  await window.setDoc(
    settDocRef(),
    { startingBalance, updatedAt: window.serverTimestamp() }
  );
}

function catName(c)  { return typeof c === 'string' ? c : c.name; }
function catColor(c) { return typeof c === 'string' ? '#999'  : c.color; }

function catType(name) {
  if (categories.income.some(c  => catName(c) === name)) return 'income';
  if (categories.expense.some(c => catName(c) === name)) return 'expense';
  return null;
}

function catColorByName(type, name) {
  const found = (categories[type]||[]).find(c => catName(c) === name);
  return found ? catColor(found) : (type === 'income' ? '#0FA974' : '#E84545');
}

function populateCategoryDropdowns() {
  ['txCategory', 'editCategory'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">Select category</option>';

    const eg = document.createElement('optgroup');
    eg.label = 'Expense';
    categories.expense.forEach(c => {
      const o = document.createElement('option'); o.value = catName(c); o.textContent = catName(c); eg.appendChild(o);
    });
    sel.appendChild(eg);

    const ig = document.createElement('optgroup');
    ig.label = 'Income';
    categories.income.forEach(c => {
      const o = document.createElement('option'); o.value = catName(c); o.textContent = catName(c); ig.appendChild(o);
    });
    sel.appendChild(ig);

    if (prev) sel.value = prev;
  });
}


function renderQuickCats() {
  const el = document.getElementById('quickCats');
  if (!el) return;
  el.style.cursor = 'pointer';

  const counts = {};
  transactions.forEach(tx => {
    if (tx.type === 'expense') counts[tx.category] = (counts[tx.category] || 0) + 1;
  });

  let top = categories.expense
    .map(c => ({ name: catName(c), color: catColor(c), count: counts[catName(c)] || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  if (!top.length) { el.innerHTML = ''; return; }

  el.innerHTML = top.map(cat => `
    <button class="quick-cat-pill" data-cat="${esc(cat.name)}" title="Add ${esc(cat.name)} transaction">
      <span class="quick-cat-dot" style="background:${cat.color}"></span>
      ${esc(cat.name)}
    </button>`).join('');

  // Single delegated handler — overwrites the previous one instead of stacking.
  // Handles both pill clicks and bare-container clicks in one place.
  el.onclick = e => {
    e.stopPropagation();
    const pill = e.target.closest('.quick-cat-pill');
    window.openAddTxSheet && window.openAddTxSheet();
    if (pill) {
      const selectedCat = pill.dataset.cat;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const sel = document.getElementById('txCategory');
          if (sel) sel.value = selectedCat;
          const amt = document.getElementById('txAmount');
          if (amt) amt.focus();
        });
      });
    }
  };
}
window.openCatsModal = function() {
  renderCatLists();
  document.getElementById('catsModalBg').classList.add('open');
  document.body.style.overflow = 'hidden';
  const nav = document.getElementById('bottomNav');
  if (nav) nav.style.display = 'none';
};
(function() {
  var panel = document.querySelector('#catsModalBg .modal');
  if (panel && !panel._dragWired) {
    panel._dragWired = true;
    wireBottomSheetDrag(panel, function() { window.closeCatsModal(); });
  }
})();
window.closeCatsModal = function() {
  _closeColorPicker();
  document.getElementById('catsModalBg').classList.remove('open');
  document.body.style.overflow = '';
  const nav = document.getElementById('bottomNav');
  if (nav) nav.style.display = '';
  const bnMap = { dashboard: 'bnDash', analytics: 'bnAnalytics', transactions: 'bnTransactions' };
  ['bnDash','bnAnalytics','bnTransactions','bnSettings'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const activeEl = document.getElementById(bnMap[activeView] || 'bnDash');
  if (activeEl) activeEl.classList.add('active');
  populateCategoryDropdowns();
  // Snapshot the doc reference NOW (synchronously) so a concurrent
  // switchAccount() cannot change activeAccountId before the write lands.
  const _savedCatRef = catDocRef();
  window.setDoc(
    _savedCatRef,
    { income: categories.income, expense: categories.expense, updatedAt: window.serverTimestamp() }
  ).catch(e => console.error('auto-save categories failed:', e));
};

(function wireImport() {
  const bg      = document.getElementById('importPanelBg');
  const closeBtn = document.getElementById('importCloseBtn');
  const cancelBtn = document.getElementById('importCancelBtn');
  const previewBtn = document.getElementById('importPreviewBtn');
  const doBtn   = document.getElementById('importDoBtn');
  const textarea = document.getElementById('csvInput');
  const errorEl = document.getElementById('importError');
  const previewEl = document.getElementById('importPreview');
  const previewList = document.getElementById('importPreviewList');

  function openImport() {
    textarea.value = '';
    errorEl.style.display = 'none';
    previewEl.style.display = 'none';
    doBtn.textContent = 'Import';
    doBtn.disabled = false;
    doBtn.style.background = '';
    bg.classList.add('open');
    // Only lock scroll on desktop (mobile has no bg overlay to scroll under)
    if (window.innerWidth >= 600) document.body.style.overflow = 'hidden';
  }

  function closeImport() {
    bg.classList.remove('open');
    document.body.style.overflow = '';
  }

  window.openImportModal  = openImport;
  window.closeImportModal = closeImport;

  wireBottomSheetDrag(document.getElementById("importPanel"), closeImport);

  closeBtn.addEventListener('click', closeImport);
  cancelBtn.addEventListener('click', closeImport);

  bg.addEventListener('click', function(e) {
    if (e.target === bg) closeImport();
  });

  previewBtn.addEventListener('click', function() {
    const csv = textarea.value.trim();
    errorEl.style.display = 'none';
    previewEl.style.display = 'none';
    if (!csv) { showError('Please paste CSV data first.'); return; }
    try {
      const rows = parseCSV(csv);
      if (!rows.length) { showError('No valid transactions found. Check the format.'); return; }
      previewList.innerHTML = rows.slice(0, 10).map(r =>
        `<div>${r.date} · <span style="color:${r.type==='income'?'var(--green)':'var(--red)'}">${r.type}</span> · ${r.category} · ₹${r.amount}${r.description ? ' · ' + r.description : ''}</div>`
      ).join('') + (rows.length > 10 ? `<div style="color:var(--text-3);margin-top:4px;">…and ${rows.length - 10} more</div>` : '');
      previewEl.style.display = 'block';
    } catch(e) { showError('Parse error: ' + e.message); }
  });

  doBtn.addEventListener('click', async function() {
    const csv = textarea.value.trim();
    errorEl.style.display = 'none';
    if (!csv) { showError('Please paste CSV data first.'); return; }
    let rows;
    try {
      rows = parseCSV(csv);
      if (!rows.length) { showError('No valid transactions found.'); return; }
    } catch(e) { showError('Parse error: ' + e.message); return; }

    doBtn.disabled = true;
    doBtn.innerHTML = '<span class="btn-spinner" style="display:inline-block;vertical-align:middle;width:13px;height:13px;border-width:2px;margin-right:6px;"></span>Importing…';
    previewEl.style.display = 'block';
    previewList.innerHTML = `<div style="color:var(--text-2)">Starting import of ${rows.length} transactions…</div>`;

    const BATCH_SIZE = 500;
    let ok = 0, fail = 0, errs = [];

    for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
      const chunk = rows.slice(batchStart, batchStart + BATCH_SIZE);
      const batch = window.writeBatch(window.db);
      chunk.forEach(r => {
        const ref = window.doc(txCol());
        batch.set(ref, {
          type: r.type, category: r.category, amount: r.amount,
          description: r.description, selectedDate: r.dateObj,
          createdAt: window.serverTimestamp()
        });
      });
      try {
        await batch.commit();
        ok += chunk.length;
        previewList.innerHTML = `<div style="color:var(--green);font-weight:600">✓ Imported ${ok} of ${rows.length}</div>`;
      } catch(e) {
        fail += chunk.length;
        errs.push(`Batch ${Math.floor(batchStart/BATCH_SIZE)+1}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 100));
    }

    if (fail) {
      errorEl.innerHTML = `<strong>Imported ${ok}, failed ${fail}</strong><br>${errs.slice(0,3).join('<br>')}`;
      errorEl.style.display = 'block';
    }
    previewList.innerHTML = `<div style="color:var(--green);font-weight:700">✓ Done! ${ok} transaction${ok!==1?'s':''} imported.</div>`;
    doBtn.innerHTML = '✓ Done!';
    doBtn.style.background = 'var(--green)';
    setTimeout(() => { closeImport(); }, 1800);
  });

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }
})();

function parseCSV(csvText) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l);
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.toLowerCase().includes('date')) continue;
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 4) continue;
    const dateStr = parts[0];
    const type = parts[1].toLowerCase();
    const category = parts[2];
    const amountStr = parts[3];
    const description = parts.slice(4).join(',').replace(/^["']|["']$/g, '');
    if (type !== 'income' && type !== 'expense') continue;
    const amount = parseFloat(amountStr.replace(/[^0-9.]/g, ''));
    if (isNaN(amount) || amount <= 0) continue;
    const dateParts = dateStr.split('/');
    if (dateParts.length !== 3) continue;
    const month = parseInt(dateParts[0]), day = parseInt(dateParts[1]), year = parseInt(dateParts[2]);
    if (isNaN(month)||isNaN(day)||isNaN(year)) continue;
    if (month<1||month>12||day<1||day>31) continue;
    results.push({ date: dateStr, type, category, amount, description: description||'',
      dateObj: new Date(year, month-1, day, 12, 0, 0) });
  }
  return results;
}
window.addCat = async function(type) {
  const nameEl = document.getElementById(type === 'income' ? 'newIncName' : 'newExpName');
  const name = nameEl.value.trim();
  if (!name) { alert('Enter a category name'); return; }

  const newCat = { name, color: _addPaletteColor[type], budget: null };
  if (type === 'expense') {
    const budgetEl = document.getElementById('newExpBudget');
    if (budgetEl && budgetEl.value) newCat.budget = parseFloat(budgetEl.value);
  }

  categories[type].push(newCat);
  await saveCategories();
  renderCatLists();
  nameEl.value = '';
  if (type === 'expense') {
    const budgetEl = document.getElementById('newExpBudget');
    if (budgetEl) budgetEl.value = '';
  }
};
window.removeCat = async function(type, name) {
  const idx = categories[type].findIndex(c => catName(c) === name);
  if (idx === -1) return;
  categories[type].splice(idx, 1);
  await saveCategories();
  renderCatLists();
};

window.showCatDeleteConfirm = function(btn, type, name) {
  const existing = btn.parentNode.querySelector('.tx-confirm-row');
  if (existing) { existing.remove(); btn.style.display = ''; return; }
  document.querySelectorAll('.cat-item .tx-confirm-row').forEach(el => {
    const p = el.closest('.cat-item');
    el.remove();
    if (p) { const d = p.querySelector('.btn-sm.del'); if (d) d.style.display = ''; }
  });
  btn.style.display = 'none';
  const row = document.createElement('div');
  row.className = 'tx-confirm-row';
  const label = document.createElement('span');
  label.className = 'tx-confirm-label';
  label.textContent = 'Remove?';
  const yesBtn = document.createElement('button');
  yesBtn.className = 'btn-sm del';
  yesBtn.textContent = 'Yes';
  yesBtn.addEventListener('click', () => window.removeCat(type, name));
  const noBtn = document.createElement('button');
  noBtn.className = 'btn-sm';
  noBtn.textContent = 'No';
  noBtn.addEventListener('click', () => { row.remove(); btn.style.display = ''; });
  row.appendChild(label);
  row.appendChild(yesBtn);
  row.appendChild(noBtn);
  btn.parentNode.appendChild(row);
};

let _colorPickerPopover = null;
let _colorPickerCleanup = null;

function _buildPickerContent(popover, initialColor, onPick) {
  const VIVID = [
    '#E84545','#f97316','#ec4899','#f59e0b','#a855f7',
    '#14b8a6','#3b82f6','#06b6d4','#0FA974','#8b5cf6',
    '#6366f1','#ef4444','#22c55e','#eab308','#64748b',
  ];
  const PASTEL = [
    '#fca5a5','#fdba74','#f9a8d4','#fde68a','#e9d5ff',
    '#99f6e4','#bfdbfe','#a5f3fc','#bbf7d0','#c7d2fe',
    '#ddd6fe','#fecaca','#d9f99d','#fef08a','#e2e8f0',
  ];

  let currentColor = initialColor;

  function applyColor(c) {
    currentColor = c;
    onPick(c);
    popover.querySelectorAll('.cat-palette-dot').forEach(d =>
      d.classList.toggle('active', d.dataset.color === c));
    hexInput.value = c;
    hexPreview.style.background = c;
    hexInput.classList.remove('invalid');
    nativeInput.value = c;
  }

  function makeRow(colors, label) {
    const lbl = document.createElement('p');
    lbl.className = 'cat-color-panel-row-label';
    lbl.textContent = label;
    popover.appendChild(lbl);
    const row = document.createElement('div');
    row.className = 'cat-color-panel-row';
    colors.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-palette-dot' + (c === initialColor ? ' active' : '');
      btn.style.background = c;
      btn.dataset.color = c;
      btn.title = c;
      btn.addEventListener('click', e => { e.stopPropagation(); applyColor(c); });
      row.appendChild(btn);
    });
    popover.appendChild(row);
  }

  makeRow(VIVID,  'Vivid');
  makeRow(PASTEL, 'Pastel');

  const footer = document.createElement('div');
  footer.className = 'cat-color-panel-footer';

  const hexRow = document.createElement('div');
  hexRow.className = 'color-pick-hex-row';

  const hexPreview = document.createElement('span');
  hexPreview.className = 'color-pick-hex-preview';
  hexPreview.style.background = initialColor;
  hexRow.appendChild(hexPreview);

  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.className = 'cat-color-hex-input';
  hexInput.placeholder = '#000000';
  hexInput.maxLength = 7;
  hexInput.value = initialColor;
  hexInput.addEventListener('input', () => {
    const v = hexInput.value.trim();
    const ok = /^#[0-9a-fA-F]{6}$/.test(v);
    hexInput.classList.toggle('invalid', !ok && v.length >= 2);
    if (ok) {
      currentColor = v;
      onPick(v);
      hexPreview.style.background = v;
      popover.querySelectorAll('.cat-palette-dot').forEach(d =>
        d.classList.toggle('active', d.dataset.color === v));
      nativeInput.value = v;
    }
  });
  hexRow.appendChild(hexInput);

  const nativeWrap = document.createElement('div');
  nativeWrap.className = 'cat-color-native-wrap';
  nativeWrap.title = 'Custom colour';
  nativeWrap.addEventListener('pointerdown', e => e.stopPropagation());
  const nativeInput = document.createElement('input');
  nativeInput.type = 'color';
  nativeInput.value = initialColor;
  nativeInput.addEventListener('pointerdown', e => e.stopPropagation());
  const _applyNative = () => {
    const nc = nativeInput.value;
    currentColor = nc;
    onPick(nc);
    hexInput.value = nc;
    hexPreview.style.background = nc;
    hexInput.classList.remove('invalid');
    popover.querySelectorAll('.cat-palette-dot').forEach(d =>
      d.classList.toggle('active', d.dataset.color === nc));
  };
  nativeInput.addEventListener('input', _applyNative);
  nativeInput.addEventListener('change', _applyNative);
  const nativeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  nativeIcon.setAttribute('viewBox', '0 0 24 24');
  nativeIcon.setAttribute('fill', 'currentColor');
  nativeIcon.classList.add('cat-color-native-icon');
  const dp1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  dp1.setAttribute('d', 'M20.71 5.63l-2.34-2.34a1 1 0 0 0-1.41 0l-3.12 3.12-1.42-1.42-1.41 1.42 1.41 1.41-6.6 6.6A2 2 0 0 0 7 16v1H6a1 1 0 0 0-1 1v2h2.5a1 1 0 0 0 .71-.29L9 19l.29.29A1 1 0 0 0 10 20h1a2 2 0 0 0 1.41-.59l6.6-6.6 1.41 1.41 1.42-1.41-1.42-1.42 3.12-3.12a1 1 0 0 0-.83-1.64z');
  nativeIcon.appendChild(dp1);
nativeWrap.removeAttribute('title');
  nativeWrap.appendChild(nativeInput);
  nativeWrap.appendChild(nativeIcon);
  hexRow.appendChild(nativeWrap);
  footer.appendChild(hexRow);

  const doneRow = document.createElement('div');
  doneRow.className = 'color-pick-done-row';
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'color-pick-done-btn';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', e => { e.stopPropagation(); _closeColorPicker(); });
  doneRow.appendChild(doneBtn);
  footer.appendChild(doneRow);

  popover.appendChild(footer);
}

function _closeColorPicker() {
  if (_colorPickerCleanup) { _colorPickerCleanup(); _colorPickerCleanup = null; }
  if (_colorPickerPopover) { _colorPickerPopover.remove(); _colorPickerPopover = null; }
  document.querySelectorAll('.color-pick-btn.open').forEach(b => b.classList.remove('open'));
}

function _makeColorPickBtn(initialColor, onPick) {
  let currentColor = initialColor;

  const wrap = document.createElement('div');
  wrap.className = 'color-pick-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'color-pick-btn';
  btn.dataset.color = initialColor;

  const dot = document.createElement('span');
  dot.className = 'color-pick-dot';
  dot.style.background = initialColor;

  btn.appendChild(dot);
  wrap.appendChild(btn);

  function _updateDot(c) {
    currentColor = c;
    dot.style.background = c;
    btn.dataset.color = c;
    onPick(c);
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = btn.classList.contains('open');

    _closeColorPicker();
    if (isOpen) return;

    btn.classList.add('open');
    const popover = document.createElement('div');
    popover.className = 'color-pick-popover';
    _buildPickerContent(popover, currentColor, c => {
      dot.style.background = c;
      btn.dataset.color = c;
      currentColor = c;
      onPick(c);
    });
    document.body.appendChild(popover);
    _colorPickerPopover = popover;

    function _position() {
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const br = btn.getBoundingClientRect();

      const maxPossibleH = vh - 2 * margin;
      popover.style.maxHeight = maxPossibleH + 'px';

      const pw = popover.offsetWidth  || 280;
      const ph = popover.offsetHeight || 260;

      let left = br.left;
      if (left + pw > vw - margin) left = vw - pw - margin;
      left = Math.max(margin, left);

      const spaceBelow = vh - br.bottom - margin;
      const spaceAbove = br.top - margin;
      let top;
      if (spaceBelow >= ph || spaceBelow >= spaceAbove) {
        top = br.bottom + 6;
      } else {
        top = br.top - ph - 6;
      }
      top = Math.max(margin, Math.min(top, vh - ph - margin));

      popover.style.left = left + 'px';
      popover.style.top  = top  + 'px';
    }
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(_position, 0)));

    _colorPickerCleanup = () => {};
  });

  wrap._setColor = _updateDot;
  wrap._getColor = () => currentColor;

  return wrap;
}

document.addEventListener('pointerdown', e => {
  if (!_colorPickerPopover) return;
  if (_colorPickerPopover.contains(e.target)) return;
  if (e.target.closest('.color-pick-btn')) return;
  _closeColorPicker();
}, true);
window.addEventListener('scroll', (e) => {
  if (document.activeElement && document.activeElement.type === 'color') return;
  _closeColorPicker();
}, true);
window.addEventListener('resize', _closeColorPicker);

const _addPaletteColor = { expense: '#E84545', income: '#0FA974' };

function renderAddPalette(type) {
  const id = type === 'expense' ? 'expAddPalette' : 'incAddPalette';
  const wrap = document.getElementById(id);
  if (!wrap) return;
  wrap.innerHTML = '';

  const pickWrap = _makeColorPickBtn(_addPaletteColor[type], (c) => {
    _addPaletteColor[type] = c;
    const syncId = type === 'expense' ? 'newExpColor' : 'newIncColor';
    const inp = document.getElementById(syncId);
    if (inp) inp.value = c;
  }, 'Colour');

  wrap.appendChild(pickWrap);
}
window.syncSwatch = function() {}; // no-op, kept for safety

window.updateCatColor = async function(type, name, color) {
  const idx = categories[type].findIndex(c => catName(c) === name);
  if (idx === -1) return;
  if (typeof categories[type][idx] === 'string') categories[type][idx] = { name: categories[type][idx], color };
  else categories[type][idx].color = color;
  await saveCategories();
};

window.updateCatBudget = async function(type, name, budget) {
  const idx = categories[type].findIndex(c => catName(c) === name);
  if (idx === -1) return;
  if (typeof categories[type][idx] === 'string') {
    categories[type][idx] = { name: categories[type][idx], color: '#666', budget: null };
  }
  categories[type][idx].budget = budget ? parseFloat(budget) : null;
  await saveCategories();
};

function renderCatLists() {
  ['income','expense'].forEach(type => {
    const el = document.getElementById(type === 'income' ? 'incomeList' : 'expenseList');
    el.innerHTML = '';
    categories[type].forEach((c) => {
      const color  = catColor(c);
      const name   = catName(c);
      const budget = typeof c === 'object' ? c.budget : null;
      const div    = document.createElement('div');
      div.className = 'cat-item';
      div.dataset.catName = name;

      const safeName = name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const budgetInput = type === 'expense'
        ? `<input type="number" value="${budget || ''}" placeholder="Budget" class="cat-budget-input" min="0" step="0.01" onchange="updateCatBudget('${type}','${safeName}',this.value)">`
        : '';

      const infoEl = document.createElement('div');
      infoEl.className = 'cat-info';
      infoEl.innerHTML = `<span class="cat-name">${esc(name)}</span>${budgetInput}`;
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-sm del';
      delBtn.textContent = 'Remove';
      delBtn.addEventListener('click', () => window.showCatDeleteConfirm(delBtn, type, name));

      const colorPickWrap = _makeColorPickBtn(color, (newColor) => {
        window.updateCatColor(type, name, newColor);
      }, 'Colour');

      div.appendChild(colorPickWrap);
      div.appendChild(infoEl);
      div.appendChild(delBtn);
      el.appendChild(div);
    });
  });
  renderAddPalette('expense');
  renderAddPalette('income');
}

function listenTransactions() {
  if (_unsubTransactions) { _unsubTransactions(); _unsubTransactions = null; }
  const q = window.query(
    txCol(),
    window.orderBy('selectedDate', 'desc')
  );
  let _txFirstSnap = true;
  _unsubTransactions = window.onSnapshot(q, snap => {
    snap.docs.forEach(d => {
      const isPending = d.metadata.hasPendingWrites;
      if (_pendingTxIds.has(d.id) && !isPending) {
        _justSyncedIds.add(d.id);
        clearTimeout(_syncTimers[d.id]);
        _syncTimers[d.id] = setTimeout(() => {
          _justSyncedIds.delete(d.id);
          delete _syncTimers[d.id];
        }, 3500);
      }
      if (isPending) _pendingTxIds.add(d.id);
      else           _pendingTxIds.delete(d.id);
    });
    transactions = snap.docs.map(d => ({ id: d.id, ...d.data(), hasPendingWrites: d.metadata.hasPendingWrites }));

    const _newMonthKey = transactions.map(t => {
      const d = toDate(t.selectedDate); return d ? `${d.getFullYear()}-${d.getMonth()}` : '';
    }).sort().join('|');
    if (_newMonthKey !== (listenTransactions._lastMonthKey || '')) {
      listenTransactions._lastMonthKey = _newMonthKey;
      initMonthDropdown(new Date(), transactions);
    }

    const currentIds = new Set(transactions.map(t => t.id));
    const newIds = [...currentIds].filter(id => !prevTransactionIds.has(id));
    prevTransactionIds = currentIds;

    window._newTxIds = (!isFirstLoad && newIds.length > 0) ? new Set(newIds) : new Set();

    if (isFirstLoad) {
      isFirstLoad = false;
    }
    renderTxList();
    renderStats();
    renderQuickCats();
    setTimeout(() => { window._newTxIds = new Set(); }, 600);
    if (activeView === 'analytics') refreshCurrentPeriod();

    populateTxCategoryFilter();
    if (activeView === 'transactions') renderAllTxList();

    if (_txFirstSnap && window._dataLoaded) {
      _txFirstSnap = false;
      window._dataLoaded.transactions = true;
      window._checkAllDataLoaded();
    }
  });
}

function wireAddTxForm() {
  const bg       = document.getElementById('addTxSheetBg');
  const closeBtn = document.getElementById('addTxCloseBtn');
  const fab      = document.getElementById('bnAddTx');
  const desktopTrigger = document.getElementById('btnOpenAddTx');

  let _autoCloseTimer = null;
  let _txSuccessMode  = false;

  let _openOverflowTimer = null; // tracks the deferred overflow=hidden

  function openAddTxSheet(confirmMode = false) {
    // Prep non-visual state synchronously (no layout impact)
    const panel = document.getElementById('addTxSheet');
    const sni   = document.getElementById('sheetNlpInput');
    if (sni)   sni.value = '';
    if (panel) panel.classList.toggle('confirm-mode', !!confirmMode);

    // Double-rAF: first frame lets the browser commit the panel's current
    // transform (translate3d(0,102%,0)) to the compositor before we add
    // .open.  Without this the transition can start from an undefined state
    // on the first open, causing a visible snap/flash on slow devices.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bg.classList.add('open');
        if (fab) fab.classList.add('open');
      });
    });

    clearTimeout(_openOverflowTimer);
    // Delay overflow:hidden until well after the animation completes (360ms)
    // so the scrollbar disappearance never causes a layout shift mid-flight.
    _openOverflowTimer = setTimeout(() => {
      document.body.style.overflow = 'hidden';
    }, 440);

    ['bnDash','bnAnalytics','bnTransactions','bnSettings'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });
  }

  function closeAddTxSheet() {
    clearTimeout(_autoCloseTimer);
    clearTimeout(_openOverflowTimer);
    _autoCloseTimer = null;
    _txSuccessMode  = false;
    bg.classList.remove('open');
    document.getElementById('addTxSheet')?.classList.remove('confirm-mode');
    if (fab) fab.classList.remove('open');
    document.body.style.overflow = '';
    const bnMap = { dashboard: 'bnDash', analytics: 'bnAnalytics', transactions: 'bnTransactions' };
    const activeEl = document.getElementById(bnMap[activeView] || 'bnDash');
    if (activeEl) activeEl.classList.add('active');
  }

  function resetToAddForm(shouldFocus = true) {
    clearTimeout(_autoCloseTimer);
    _autoCloseTimer = null;
    _txSuccessMode  = false;
    const btn     = document.getElementById('addTxBtn');
    const label   = document.getElementById('addTxLabel');
    const done    = document.getElementById('addTxDone');
    if (done)  done.classList.add('hidden');
    if (label) label.classList.remove('hidden');
    if (btn)   { btn.disabled = false; btn.style.background = ''; btn.style.color = ''; }
    if (shouldFocus) {
      const catField = document.getElementById('txCategory');
      if (catField) setTimeout(() => catField.focus(), 60);
    }
  }

  window.openAddTxSheet  = openAddTxSheet;
  window.closeAddTxSheet = closeAddTxSheet;

  let _catSuggestColor = '#E84545';
  let _catSuggestType  = 'expense';
  let _catSuggestPickerWrap = null; // the _makeColorPickBtn wrap node

  window._catSuggestSetType = function(type) {
    _catSuggestType = type;
    const expBtn = document.getElementById('catSuggestTypeExp');
    const incBtn = document.getElementById('catSuggestTypeInc');
    const budRow = document.getElementById('catSuggestBudgetRow');
    if (expBtn) expBtn.className = type === 'expense' ? 'btn btn-primary' : 'btn btn-secondary';
    if (incBtn) incBtn.className = type === 'income'  ? 'btn btn-primary' : 'btn btn-secondary';
    if (budRow) budRow.style.display = type === 'expense' ? '' : 'none';
  };

  function _catSuggestSetColor(color) {
    _catSuggestColor = color;
    const icon = document.getElementById('catSuggestIconCircle');
    if (icon) { icon.style.background = color + '22'; icon.style.color = color; }
    if (_catSuggestPickerWrap && _catSuggestPickerWrap._setColor) {
      _catSuggestPickerWrap._setColor(color);
    }
  }

  function _initCatSuggestionModal() {
    if (document.getElementById('catSuggestionModal')) return;

    const html = `
<div id="catSuggestionModal" role="dialog" aria-modal="true" aria-label="New category detected">
  <div class="cat-suggest-card">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:22px;">
      <div id="catSuggestIconCircle" class="cat-suggest-icon-circle">✦</div>
      <h2 class="cat-suggest-title">New Category Detected</h2>
      <p id="catSuggestSubtitle" class="cat-suggest-subtitle"></p>
    </div>

    <div class="cat-suggest-divider"></div>

    <!-- Name -->
    <div class="cat-suggest-field">
      <label class="cat-suggest-label" for="catSuggestName">Category Name</label>
      <input type="text" id="catSuggestName" placeholder="Category name…" autocomplete="off" />
    </div>

    <!-- Type toggle -->
    <div class="cat-suggest-field">
      <label class="cat-suggest-label">Type</label>
      <div class="cat-suggest-type-row">
        <button id="catSuggestTypeExp" class="btn btn-primary"
                onclick="_catSuggestSetType('expense')">💸 Expense</button>
        <button id="catSuggestTypeInc" class="btn btn-secondary"
                onclick="_catSuggestSetType('income')">💰 Income</button>
      </div>
    </div>

    <!-- Color -->
    <div class="cat-suggest-field">
      <label class="cat-suggest-label">Color</label>
      <div id="catSuggestColorMount"></div>
    </div>

    <!-- Budget (expense only) -->
    <div id="catSuggestBudgetRow" class="cat-suggest-field">
      <label class="cat-suggest-label" for="catSuggestBudget">
        Monthly Budget <span>(optional)</span>
      </label>
      <input type="number" id="catSuggestBudget" placeholder="e.g. 5000" min="0" step="0.01" />
    </div>

    <!-- Actions -->
    <div class="cat-suggest-actions">
      <button class="btn btn-secondary" id="catSuggestSkipBtn">Skip</button>
      <button class="btn btn-primary"   id="catSuggestAddBtn">Add &amp; Use →</button>
    </div>

    <!-- Fallback hint -->
    <p id="catSuggestFallbackHint" class="cat-suggest-fallback"></p>
  </div>
</div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    const colorMount = document.getElementById('catSuggestColorMount');
    if (colorMount) {
      _catSuggestPickerWrap = _makeColorPickBtn(_catSuggestColor, (c) => {
        _catSuggestColor = c;
        const icon = document.getElementById('catSuggestIconCircle');
        if (icon) { icon.style.background = c + '22'; icon.style.color = c; }
      }, 'Colour');
      colorMount.appendChild(_catSuggestPickerWrap);
    }
  }

  function _showCatSuggestionPopup(match) {
    _initCatSuggestionModal();
    return new Promise(resolve => {
      const modal    = document.getElementById('catSuggestionModal');
      const nameIn   = document.getElementById('catSuggestName');
      const subtitle = document.getElementById('catSuggestSubtitle');
      const addBtn   = document.getElementById('catSuggestAddBtn');
      const skipBtn  = document.getElementById('catSuggestSkipBtn');
      const fallback = document.getElementById('catSuggestFallbackHint');

      nameIn.value = match.suggestedName;
      subtitle.textContent =
        `"${match.suggestedName}" wasn't found in your categories. Want to add it?`;

      _catSuggestSetType(match.suggestedType);
      const defaultColor = match.suggestedType === 'income' ? '#0FA974' : '#E84545';
      _catSuggestSetColor(defaultColor);
      document.getElementById('catSuggestBudget').value = '';

      if (match.categoryName) {
        fallback.innerHTML = `Skip → will use <strong>"${match.categoryName}"</strong> instead`;
        fallback.style.display = '';
      } else {
        fallback.innerHTML = '';
        fallback.style.display = 'none';
      }

      modal.style.display = 'flex';
      requestAnimationFrame(() => {
        modal.style.opacity = '1';
        const card = modal.firstElementChild;
        if (card) card.style.transform = 'translateY(0)';
      });
      setTimeout(() => nameIn && (nameIn.focus(), nameIn.select()), 80);

      function _close() {
        modal.style.opacity = '0';
        const card = modal.firstElementChild;
        if (card) card.style.transform = 'translateY(12px)';
        setTimeout(() => { modal.style.display = 'none'; }, 180);
        addBtn.removeEventListener('click', onAdd);
        skipBtn.removeEventListener('click', onSkip);
      }

      async function onAdd() {
        const name = nameIn.value.trim();
        if (!name) { nameIn.focus(); nameIn.classList.add('input-error'); return; }
        nameIn.classList.remove('input-error');
        const type   = _catSuggestType;
        const color  = _catSuggestColor;
        const budgetEl = document.getElementById('catSuggestBudget');
        const budget = (type === 'expense' && budgetEl && budgetEl.value)
          ? parseFloat(budgetEl.value) : null;

        const newCat = { name, color, budget };
        categories[type].push(newCat);
        try {
          await saveCategories();
          renderCatLists();
          populateCategoryDropdowns();
        } catch (e) { console.error('catSuggest save failed', e); }

        _close();
        resolve({ name, color, type, budget });
      }

      function onSkip() { _close(); resolve(null); }

      addBtn.addEventListener('click', onAdd);
      skipBtn.addEventListener('click', onSkip);
    });
  }

  async function _processCatSuggestionQueue(items) {
    const resolved = new Map();

    const uniqueMatches = [];
    for (const { match } of items) {
      if (!resolved.has(match.suggestedName)) {
        resolved.set(match.suggestedName, undefined); // placeholder
        uniqueMatches.push(match);
      }
    }

    for (const match of uniqueMatches) {
      const result = await _showCatSuggestionPopup(match);
      resolved.set(match.suggestedName, result); // {name,color,type,budget} or null
    }

    for (const { tx, match } of items) {
      const added = resolved.get(match.suggestedName);
      if (added) {
        tx.category = added.name;
        tx.type     = added.type;
      } else if (match.categoryName) {
        tx.category = match.categoryName;
        tx.type     = match.categoryType;
        tx.confidence = Math.max(20, tx.confidence - 15);
      } else {
        const pool = tx.type === 'income' ? categories.income : categories.expense;
        if (pool && pool.length) {
          tx.category = catName(pool[0]);
        }
        tx.confidence = Math.max(10, tx.confidence - 25);
      }
    }
  }

  (function initNLP() {
    const toggleBtn        = document.getElementById('nlpToggleBtn');
    const nlpInputRow      = document.getElementById('nlpInputRow');
    const nlpInput         = document.getElementById('nlpInput');
    const nlpSendBtn       = document.getElementById('nlpSendBtn');
    const nlpCloseBtn      = document.getElementById('nlpCloseBtn');
    const nlpStatus        = document.getElementById('nlpStatus');
    const nlpPreview       = document.getElementById('nlpPreview');
    const nlpPreviewList   = document.getElementById('nlpPreviewList');
    const nlpPreviewCancel = document.getElementById('nlpPreviewCancel');
    const nlpPreviewLogAll = document.getElementById('nlpPreviewLogAll');
    const mobileWrap       = document.getElementById('mobileNlpWrap');
    const mobileInput      = document.getElementById('mobileNlpInput');
    const mobileSendBtn    = document.getElementById('mobileNlpSendBtn');
    const sheetNlpInput    = document.getElementById('sheetNlpInput');
    const sheetNlpSend     = document.getElementById('sheetNlpSend');
    const sheetNlpStatus   = document.getElementById('sheetNlpStatus');
    const sheetNlpPreview  = document.getElementById('sheetNlpPreview');
    const sheetNlpPrevList = document.getElementById('sheetNlpPreviewList');
    const sheetNlpCancel   = document.getElementById('sheetNlpCancel');
    const sheetNlpLogAll   = document.getElementById('sheetNlpLogAll');

    let nlpOn = localStorage.getItem('nlpEnabled') === 'true';
    let pendingTxns = [];

    function setNlpMode(on) {
      nlpOn = on;
      localStorage.setItem('nlpEnabled', on);
      if (toggleBtn)   toggleBtn.classList.toggle('active', on);
      if (nlpInputRow) nlpInputRow.classList.toggle('hidden', !on);
      if (mobileWrap)  mobileWrap.classList.toggle('hidden', !on);
      if (!on) { hideStatus(); hidePreview(); }
      else setTimeout(() => (nlpInput || mobileInput)?.focus(), 100);
    }

    function showStatus(msg, isError = false) {
      if (!nlpStatus) return;
      nlpStatus.textContent = msg;
      nlpStatus.className = 'nlp-status' + (isError ? ' nlp-status-error' : '');
      nlpStatus.classList.remove('hidden');
    }
    function hideStatus() { if (nlpStatus) nlpStatus.classList.add('hidden'); }

    function showPreview(txns) {
      if (!nlpPreview || !nlpPreviewList) return;
      pendingTxns = txns;
      nlpPreviewList.innerHTML = '';
      txns.forEach((tx, i) => {
        const row = document.createElement('div');
        row.className = 'nlp-preview-row';
        const col = tx.type === 'income' ? 'var(--green)' : 'var(--red)';
        row.innerHTML = `
          <span class="nlp-preview-cat">${tx.category}</span>
          <span class="nlp-preview-amt" style="color:${col}">₹${tx.amount}</span>
          <span class="nlp-preview-note">${tx.note || ''}</span>
          <span class="nlp-preview-date">${tx.date}</span>
          <span class="nlp-preview-conf">${tx.confidence}%</span>
          <button class="nlp-preview-remove" data-idx="${i}" aria-label="Remove">×</button>`;
        nlpPreviewList.appendChild(row);
      });
      nlpPreviewList.querySelectorAll('.nlp-preview-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          pendingTxns.splice(parseInt(btn.dataset.idx), 1);
          pendingTxns.length === 0 ? hidePreview() : showPreview(pendingTxns);
        });
      });
      nlpPreview.classList.remove('hidden');
    }
    function hidePreview() {
      if (nlpPreview) nlpPreview.classList.add('hidden');
      pendingTxns = [];
    }

    async function doNlpParse(text) {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!window.NLP) { showStatus('AI model not loaded — please refresh.', true); return; }
      showStatus('Parsing…');
      hidePreview();
      try {
        const results = await NLP.parse(trimmed);
        const valid = results.filter(r => r.amount && r.amount > 0);
        if (!valid.length) {
          showStatus('No amount found. Try: "paid 350 for groceries"', true);
          return;
        }

        const matchResults = valid.map(tx => {
          const match = NLP.matchToUserCategories(
            tx.category, tx.type,
            categories.expense || [],
            categories.income  || [],
            tx.segText || trimmed
          );
          return { tx, match };
        });

        const needsSuggestion = [];
        matchResults.forEach(({ tx, match }) => {
          if (match.matched) {
            tx.category = match.categoryName;
            tx.type     = match.categoryType;
          } else {
            needsSuggestion.push({ tx, match });
          }
        });

        if (needsSuggestion.length > 0) {
          hideStatus();
          await _processCatSuggestionQueue(needsSuggestion);
        }

        hideStatus();
        if (valid.length === 1) {
          const tx = valid[0];
          openAddTxSheet(true);
          setTimeout(() => {
            const sel  = document.getElementById('txCategory');
            const amt  = document.getElementById('txAmount');
            const note = document.getElementById('txNote');
            const date = document.getElementById('txDate');
            if (sel)  sel.value  = tx.category;
            if (amt)  amt.value  = tx.amount;
            if (note) note.value = tx.note || '';
            if (date) date.value = tx.date;
            if (nlpInput)      nlpInput.value      = '';
            if (mobileInput)   mobileInput.value   = '';
            if (sheetNlpInput) sheetNlpInput.value = '';
          }, 120);
        } else {
          showPreview(valid);
        }
      } catch (err) {
        showStatus('Parse failed — try again.', true);
        console.error('NLP error:', err);
      }
    }

    async function logAllPending() {
      if (!pendingTxns.length) return;
      const btn = nlpPreviewLogAll;
      if (btn) { btn.disabled = true; btn.textContent = 'Logging…'; }
      let logged = 0;
      for (const tx of pendingTxns) {
        const type = catType(tx.category) || tx.type;
        if (!type) continue;
        try {
          await window.addDoc(
            txCol(),
            { type, category: tx.category, amount: tx.amount,
              description: tx.note || '',
              selectedDate: new Date(tx.date + 'T00:00:00'),
              createdAt: window.serverTimestamp() }
          );
          logged++;
        } catch (e) { console.error('NLP log failed:', e); }
      }
      hidePreview();
      if (nlpInput)    nlpInput.value    = '';
      if (mobileInput) mobileInput.value = '';
      showStatus(`✓ Logged ${logged} transaction${logged !== 1 ? 's' : ''}!`);
      setTimeout(hideStatus, 3000);
      if (window.vibrate) vibrate();
      if (btn) { btn.disabled = false; btn.textContent = 'Log All'; }
    }

    if (toggleBtn)        toggleBtn.addEventListener('click', () => setNlpMode(!nlpOn));
    if (nlpCloseBtn)      nlpCloseBtn.addEventListener('click', () => setNlpMode(false));
    if (nlpPreviewCancel) nlpPreviewCancel.addEventListener('click', hidePreview);
    if (nlpPreviewLogAll) nlpPreviewLogAll.addEventListener('click', logAllPending);
    if (nlpSendBtn)       nlpSendBtn.addEventListener('click', () => doNlpParse(nlpInput.value));
    if (mobileSendBtn)    mobileSendBtn.addEventListener('click', () => doNlpParse(mobileInput.value));
    if (nlpInput)         nlpInput.addEventListener('keydown', e => { if (e.key==='Enter') doNlpParse(nlpInput.value); });
    if (mobileInput)      mobileInput.addEventListener('keydown', e => { if (e.key==='Enter') doNlpParse(mobileInput.value); });
    function showSheetStatus(msg, isError = false) {
      if (!sheetNlpStatus) return;
      sheetNlpStatus.textContent = msg;
      sheetNlpStatus.className = 'sheet-nlp-status' + (isError ? ' sheet-nlp-status-error' : '');
      sheetNlpStatus.classList.remove('hidden');
    }
    function hideSheetStatus() { if (sheetNlpStatus) sheetNlpStatus.classList.add('hidden'); }

    function showSheetPreview(txns) {
      if (!sheetNlpPreview || !sheetNlpPrevList) return;
      pendingTxns = txns;
      sheetNlpPrevList.innerHTML = '';
      txns.forEach((tx, i) => {
        const row = document.createElement('div');
        row.className = 'nlp-preview-row';
        const col = tx.type === 'income' ? 'var(--green)' : 'var(--red)';
        row.innerHTML = `
          <span class="nlp-preview-cat">${tx.category}</span>
          <span class="nlp-preview-amt" style="color:${col}">₹${tx.amount}</span>
          <span class="nlp-preview-note">${tx.note || ''}</span>
          <span class="nlp-preview-date">${tx.date}</span>
          <span class="nlp-preview-conf">${tx.confidence}%</span>
          <button type="button" class="nlp-preview-remove" data-idx="${i}" aria-label="Remove">×</button>`;
        sheetNlpPrevList.appendChild(row);
      });
      sheetNlpPrevList.querySelectorAll('.nlp-preview-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          pendingTxns.splice(parseInt(btn.dataset.idx), 1);
          pendingTxns.length === 0 ? hideSheetPreview() : showSheetPreview(pendingTxns);
        });
      });
      sheetNlpPreview.classList.remove('hidden');
    }
    function hideSheetPreview() {
      if (sheetNlpPreview) sheetNlpPreview.classList.add('hidden');
      pendingTxns = [];
    }

    async function doSheetNlpParse(text) {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!window.NLP) { showSheetStatus('AI model not loaded — refresh.', true); return; }
      showSheetStatus('Parsing…');
      hideSheetPreview();
      try {
        const results = await NLP.parse(trimmed);
        const valid = results.filter(r => r.amount && r.amount > 0);
        if (!valid.length) {
          showSheetStatus('No amount found. Try: "paid 350 for groceries"', true);
          return;
        }
        const sheetMatchResults = valid.map(tx => {
          const match = NLP.matchToUserCategories(
            tx.category, tx.type,
            categories.expense || [],
            categories.income  || [],
            tx.segText || trimmed
          );
          return { tx, match };
        });

        const sheetNeedsSuggestion = [];
        sheetMatchResults.forEach(({ tx, match }) => {
          if (match.matched) {
            tx.category = match.categoryName;
            tx.type     = match.categoryType;
          } else {
            sheetNeedsSuggestion.push({ tx, match });
          }
        });

        if (sheetNeedsSuggestion.length > 0) {
          hideSheetStatus();
          await _processCatSuggestionQueue(sheetNeedsSuggestion);
        }

        hideSheetStatus();
        if (valid.length === 1) {
          const tx = valid[0];
          if (sheetNlpInput) sheetNlpInput.value = '';
          setTimeout(() => {
            const sel  = document.getElementById('txCategory');
            const amt  = document.getElementById('txAmount');
            const note = document.getElementById('txNote');
            const date = document.getElementById('txDate');
            if (sel)  sel.value  = tx.category;
            if (amt)  amt.value  = tx.amount;
            if (note) note.value = tx.note || '';
            if (date) date.value = tx.date;
            const form = document.getElementById('addTxForm');
            if (form) {
              form.classList.add('nlp-filled');
              setTimeout(() => form.classList.remove('nlp-filled'), 800);
            }
            showSheetStatus('✓ Filled! Check below and tap Add Transaction.');
            setTimeout(hideSheetStatus, 3000);
            if (amt) setTimeout(() => amt.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
          }, 60);
        } else {
          if (sheetNlpInput) sheetNlpInput.value = '';
          showSheetPreview(valid);
        }
      } catch (err) {
        showSheetStatus('Parse failed — try again.', true);
        console.error('Sheet NLP error:', err);
      }
    }

    if (sheetNlpCancel)  sheetNlpCancel.addEventListener('click', hideSheetPreview);
    if (sheetNlpLogAll)  sheetNlpLogAll.addEventListener('click', async () => {
      if (!pendingTxns.length) return;
      sheetNlpLogAll.disabled = true;
      sheetNlpLogAll.textContent = 'Logging…';
      let logged = 0;
      for (const tx of pendingTxns) {
        const type = catType(tx.category) || tx.type;
        if (!type) continue;
        try {
          await window.addDoc(txCol(), {
            type, category: tx.category, amount: tx.amount,
            description: tx.note || '',
            selectedDate: new Date(tx.date + 'T00:00:00'),
            createdAt: window.serverTimestamp()
          });
          logged++;
        } catch(e) { console.error('Sheet NLP log failed:', e); }
      }
      hideSheetPreview();
      showSheetStatus(`✓ Logged ${logged} transaction${logged !== 1 ? 's' : ''}!`);
      setTimeout(hideSheetStatus, 3000);
      if (window.vibrate) vibrate();
      sheetNlpLogAll.disabled = false;
      sheetNlpLogAll.textContent = 'Log All';
    });
    if (sheetNlpSend)     sheetNlpSend.addEventListener('click', () => doSheetNlpParse(sheetNlpInput.value));
    if (sheetNlpInput)    sheetNlpInput.addEventListener('keydown', e => { if (e.key==='Enter') { e.preventDefault(); doSheetNlpParse(sheetNlpInput.value); } });

    setNlpMode(nlpOn); // restore saved state
  })();

  window.openAddTxSheetWithType = function(type) {
    openAddTxSheet();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const sel = document.getElementById('txCategory');
      if (!sel) return;
      const typeCats = type === 'income' ? categories.income : categories.expense;
      sel.innerHTML = '<option value="">Select category</option>';
      typeCats.forEach(c => {
        const o = document.createElement('option');
        o.value = catName(c);
        o.textContent = catName(c);
        sel.appendChild(o);
      });
      sel.focus();
    }));
  };

  const _origCloseForType = closeAddTxSheet;
  closeAddTxSheet = function() {
    _origCloseForType();
    setTimeout(() => populateCategoryDropdowns(), 420);
  };
  window.closeAddTxSheet = closeAddTxSheet;


  if (window.visualViewport && window.innerWidth < 600) {
    const panel = document.getElementById('addTxSheet');

    function scrollFieldIntoView(field) {
      if (!bg.classList.contains('open')) return;
      // Wait for Android to finish its own focus-scroll attempt before we measure
      setTimeout(() => {
        const scrollTarget = (field.id === 'txNote')
          ? (document.getElementById('addTxBtn') || field)
          : field;

        scrollTarget.scrollIntoView({ behavior: 'instant', block: 'nearest' });

        requestAnimationFrame(() => {
          const vvHeight   = window.visualViewport.height;
          const targetRect = scrollTarget.getBoundingClientRect();
          const PADDING    = 28; // breathing room above keyboard edge
          if (targetRect.bottom > vvHeight - PADDING) {
            panel.scrollTop += targetRect.bottom - (vvHeight - PADDING);
          }
        });
      }, 150);
    }

    function scrollPanelToBottom() {
      if (!bg.classList.contains('open')) return;
      setTimeout(() => { panel.scrollTop = panel.scrollHeight; }, 60);
    }

    function onViewportResize() {
      const kbHeight = window.screen.height - window.visualViewport.height - window.visualViewport.offsetTop;
      if (kbHeight > 80) scrollPanelToBottom();
    }

    window.visualViewport.addEventListener('resize', onViewportResize);

    ['txDate', 'txCategory', 'txAmount', 'txNote'].forEach(fId => {
      const el = document.getElementById(fId);
      if (el) el.addEventListener('focus', () => scrollFieldIntoView(el));
    });
  }

  if (fab) fab.addEventListener('click', () => {
    const settingsDrawer = document.getElementById('settingsDrawer');
    if (settingsDrawer && settingsDrawer.classList.contains('open')) {
      settingsDrawer.classList.remove('open');
      const settingsBackdrop = document.getElementById('settingsBackdrop');
      if (settingsBackdrop) settingsBackdrop.classList.remove('open');
      document.body.style.overflow = '';
      const bnMap2 = { dashboard: 'bnDash', analytics: 'bnAnalytics', transactions: 'bnTransactions' };
      ['bnDash','bnAnalytics','bnTransactions','bnSettings'].forEach(id => {
        const el = document.getElementById(id); if (el) el.classList.remove('active');
      });
      const activeEl = document.getElementById(bnMap2[activeView] || 'bnDash');
      if (activeEl) activeEl.classList.add('active');
      return;
    }
    if (window.closePendingSheet && document.getElementById('pendingSheetBg')?.classList.contains('open')) {
      window.closePendingSheet();
    } else if (bg.classList.contains('open')) {
      if (_txSuccessMode) {
        resetToAddForm();
      } else {
        closeAddTxSheet();
      }
    } else {
      openAddTxSheet();
    }
  });
  if (desktopTrigger) desktopTrigger.addEventListener('click', openAddTxSheet);
  const addTxCard = desktopTrigger ? desktopTrigger.closest('.add-tx-card, .stat-card, [data-card], .card') || desktopTrigger.parentElement : null;
  if (addTxCard && addTxCard !== desktopTrigger) {
    addTxCard.style.cursor = 'pointer';
    addTxCard.addEventListener('click', e => {
      if (e.target.closest('.quick-cat-pill')) return;
      const t = e.target;
      if (t.closest('#nlpToggleBtn') || t.closest('#nlpInputRow') ||
          t.closest('#nlpStatus')    || t.closest('#nlpPreview')) return;
      if (!document.getElementById('addTxSheetBg')?.classList.contains('open')) openAddTxSheet();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', closeAddTxSheet);
  bg.addEventListener('click', e => {
    const panel = document.getElementById('addTxSheet');
    if (panel && !panel.contains(e.target)) {
      if (_txSuccessMode) {
        resetToAddForm();
      } else {
        closeAddTxSheet();
      }
    }
  });
  wireBottomSheetDrag(document.getElementById('addTxSheet'), function() {
    if (_txSuccessMode) {
      resetToAddForm();
    } else {
      closeAddTxSheet();
    }
  });

  document.getElementById('addTxSheet').addEventListener('pointerdown', () => {
    if (_txSuccessMode) resetToAddForm(false);
  });

  document.getElementById('addTxForm').addEventListener('submit', async e => {
    e.preventDefault();

    if (_txSuccessMode) { resetToAddForm(); return; }

    const category = document.getElementById('txCategory').value;
    const raw      = document.getElementById('txAmount').value.replace(/,/g,'').trim();
    const amount   = parseFloat(raw);
    const dateVal  = document.getElementById('txDate').value;
    const note     = document.getElementById('txNote').value.trim();

    if (!category) { alert('Please select a category'); return; }
    if (!amount || amount <= 0) { alert('Please enter a valid amount'); return; }
    const type = catType(category);
    if (!type) { alert('Unknown category — please re-select'); return; }

    const btn     = document.getElementById('addTxBtn');
    const label   = document.getElementById('addTxLabel');
    const spinner = document.getElementById('addTxSpinner');
    const done    = document.getElementById('addTxDone');

    label.classList.add('hidden');
    spinner.classList.remove('hidden');
    btn.disabled = true;

    try {
      const QUEUE_TIMEOUT = 800;
      const addDocPromise = window.addDoc(
        txCol(),
        { type, category, amount, description: note, selectedDate: new Date(dateVal + 'T00:00:00'), createdAt: window.serverTimestamp() }
      );
      const timeoutPromise = new Promise(resolve =>
        setTimeout(() => resolve('__queued__'), QUEUE_TIMEOUT)
      );
      const result = await Promise.race([addDocPromise, timeoutPromise]);
      const wasQueued = result === '__queued__' && !navigator.onLine;

      spinner.classList.add('hidden');
      done.classList.remove('hidden');
      if (wasQueued) {
        done.textContent = '↑ Saved offline — will sync';
        btn.style.background = '#f59e0b';
        btn.style.color = '#1a1200';
      } else {
        done.textContent = '✓ Added!';
        btn.style.background = 'var(--green)';
        btn.style.color = '#ffffff';
        vibrate();
      }
      btn.disabled = false;
      document.getElementById('txAmount').value = '';
      document.getElementById('txNote').value   = '';
      document.getElementById('txCategory').value = '';
      document.getElementById('txDate').valueAsDate = new Date();
      _txSuccessMode = true;
      _autoCloseTimer = setTimeout(() => {
        _autoCloseTimer = null;
        _txSuccessMode  = false;
        done.classList.add('hidden');
        label.classList.remove('hidden');
        btn.style.background = '';
        btn.style.color = '';
        btn.disabled = false;
        // Auto-close after 3s — gives user time to add another transaction
        closeAddTxSheet();
      }, 3000);
    } catch (err) {
      console.error(err);
      alert('Failed to save — check your connection.');
      spinner.classList.add('hidden');
      label.classList.remove('hidden');
      btn.disabled = false;
    }
  });
}

function txSorted(list) {
  return list.slice().sort((a, b) => {
    const da = toDate(a.selectedDate);
    const db = toDate(b.selectedDate);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    const selDiff = db - da;
    if (selDiff !== 0) return selDiff;
    if (!a.createdAt && !b.createdAt) return 0;
    if (!a.createdAt) return -1;
    if (!b.createdAt) return 1;
    return toDate(b.createdAt) - toDate(a.createdAt);
  });
}


function _txPillHtml(txId, hasPending) {
  if (hasPending) {
    return `<span class="tx-queue-wrap" id="tqw-${txId}"><span class="tx-queue-pill tqp-queued" id="tqp-${txId}"><span class="tqp-dot"></span><span class="tqp-text">Queued</span></span></span>`;
  }
  if (_justSyncedIds.has(txId)) {
    return `<span class="tx-queue-wrap" id="tqw-${txId}"><span class="tx-queue-pill tqp-synced" id="tqp-${txId}"><span class="tqp-dot tqp-dot-synced"></span><span class="tqp-text">Synced</span></span></span>`;
  }
  return '';
}
function _animateTxPill(txId, hasPending) {
  if (hasPending) {
    const w = document.getElementById(`tqw-${txId}`);
    const p = document.getElementById(`tqp-${txId}`);
    if (!w || !p) return;
    w.classList.add('tqw-show');
    requestAnimationFrame(() => requestAnimationFrame(() => p.classList.add('tqp-show')));
  } else if (_justSyncedIds.has(txId)) {
    const w = document.getElementById(`tqw-${txId}`);
    const p = document.getElementById(`tqp-${txId}`);
    if (!w || !p) return;
    w.classList.add('tqw-show');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      p.classList.add('tqp-show');
      setTimeout(() => {
        p.classList.remove('tqp-show');
        setTimeout(() => w.classList.remove('tqw-show'), 650);
      }, 2000);
    }));
  }
}

// Compute the running account balance immediately AFTER each transaction.
// Uses ALL transactions (unfiltered) so filtered views still show the true
// balance at that point in time.
// Returns Map<txId, number>.
function computeRunningBalances() {
  const balMap = new Map();
  // Sort oldest-first so we can accumulate forward
  const chronological = txSorted(transactions).slice().reverse();
  let running = startingBalance;
  for (const tx of chronological) {
    running += tx.type === 'income' ? tx.amount : -tx.amount;
    balMap.set(tx.id, running);
  }
  return balMap;
}

function buildTxDiv(tx, balanceAfter) {
  const d     = toDate(tx.selectedDate);
  const dateLabel = d
    ? d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
    : 'No date';
  const color = catColorByName(tx.type, tx.category);

  const row = document.createElement('div');
  row.className = 'tx-row';
  row.setAttribute('data-tx-id', tx.id);

  const div = document.createElement('div');
  div.className = 'tx-item';
  div.style.cursor = 'pointer';
  const pillHtml = _txPillHtml(tx.id, tx.hasPendingWrites);

  div.innerHTML = `
    <div class="tx-meta">
      <div class="tx-cat"><span class="tx-badge" style="background:${color}22;color:${color}">${esc(tx.category)}</span>${pillHtml}</div>
      ${tx.description ? `<div class="tx-note">${esc(tx.description)}</div>` : ''}
      <div class="tx-date">${dateLabel}</div>
    </div>
    <div class="tx-right">
      <div class="tx-amount ${tx.type}">${tx.type==='income'?'+':'-'}${fmt(tx.amount)}</div>
      ${balanceAfter != null ? `<div class="tx-bal-after" title="Balance after this transaction"><span class=\"tx-bal-label\">Balance:</span> ${balanceAfter >= 0 ? '' : '-'}${fmt(Math.abs(balanceAfter))}</div>` : ''}
    </div>
    <div class="tx-actions">
      <div class="txa-normal">
        <button class="btn-sm" onclick="event.stopPropagation();openEditModal('${tx.id}')">Edit</button>
        <button class="btn-sm del" onclick="event.stopPropagation();showDeleteConfirm('${tx.id}')">Delete</button>
      </div>
      <div class="txa-confirm" style="display:none">
        <span class="tx-confirm-label">Delete?</span>
        <button class="btn-sm del" onclick="event.stopPropagation();doConfirmDeleteTx('${tx.id}',this)">Yes</button>
        <button class="btn-sm" onclick="event.stopPropagation();cancelDeleteTx(this)">No</button>
        <label class="tx-dont-ask" onclick="event.stopPropagation()"><input type="checkbox" class="dont-ask-chk" style="accent-color:var(--red);width:12px;height:12px;cursor:pointer;flex-shrink:0"> <span>Don't ask again</span></label>
      </div>
    </div>
  `;
  div.addEventListener('click', e => {
    if (e.target.closest('.tx-actions')) return;
    openTxDetail(tx.id);
  });
  if (window._restoringTxId === tx.id) div.classList.add('tx-restoring');
  if (pillHtml) setTimeout(() => _animateTxPill(tx.id, tx.hasPendingWrites), 0);
  row.appendChild(div);
  return row;
}

function _preserveRemovingRows(el, rebuildFn) {
  const live    = [...el.querySelectorAll('.tx-row.removing')];
  const anchors = live.map(r => ({ row: r, next: r.nextSibling }));
  live.forEach(r => r.remove());
  rebuildFn();
  anchors.forEach(({ row, next }) => {
    if (next && next.parentNode === el) {
      el.insertBefore(row, next);
    } else {
      el.appendChild(row);
    }
  });
}

function renderTxList() {
  const el = document.getElementById('txList');
  let sorted = txSorted(transactions).slice(0, 5);
  if (_undoPendingId) sorted = sorted.filter(t => t.id !== _undoPendingId);

  if (!sorted.length) {
    el.innerHTML = '<div class="empty">No transactions yet</div>';
    return;
  }

  const balMap = window._allDataLoaded ? computeRunningBalances() : new Map();
  const isFirstRender = el.children.length === 0 || el.querySelector('.empty') !== null || el.querySelector('.tx-skel') !== null;
  const newIds = window._newTxIds || new Set();

  if (isFirstRender) {
    el.innerHTML = '';
    sorted.forEach((tx, index) => {
      const div = buildTxDiv(tx, balMap.get(tx.id));
      div.style.opacity = '0';
      div.style.transition = 'opacity 0.3s ease';
      el.appendChild(div);
      setTimeout(() => { div.style.opacity = '1'; }, 600 + (index * 80));
    });
  } else if (newIds.size > 0) {
    _preserveRemovingRows(el, () => {
      el.innerHTML = '';
      sorted.forEach(tx => {
        const div = buildTxDiv(tx, balMap.get(tx.id));
        if (newIds.has(tx.id)) div.classList.add('tx-adding');
        el.appendChild(div);
      });
    });
  } else {
    _preserveRemovingRows(el, () => {
      el.innerHTML = '';
      sorted.forEach(tx => el.appendChild(buildTxDiv(tx, balMap.get(tx.id))));
    });
  }

}

function populateTxCategoryFilter() {
  const sel = document.getElementById('txCategoryFilter');
  if (!sel) return;
  const current = sel.value;
  const cats = [...new Set(transactions.map(t => t.category).filter(Boolean))].sort();
  const newKey = cats.join('|');
  if (newKey === (populateTxCategoryFilter._lastKey || '')) return;
  populateTxCategoryFilter._lastKey = newKey;
  sel.innerHTML = '<option value="">All Categories</option>';
  cats.forEach(cat => {
    const o = document.createElement('option');
    o.value = cat;
    o.textContent = cat;
    sel.appendChild(o);
  });
  if (cats.includes(current)) sel.value = current;
}

function renderAllTxList() {
  const el      = document.getElementById('allTxList');
  const countEl = document.getElementById('allTxCount');
  if (!transactions.length) {
    el.innerHTML = '<div class="empty">No transactions yet</div>';
    if (countEl) countEl.textContent = '0 transactions';
    return;
  }

  const searchQ    = (document.getElementById('txSearchInput')?.value || '').trim().toLowerCase();
  const catFilter  = document.getElementById('txCategoryFilter')?.value || '';
  const typeFilter = document.getElementById('txTypeFilter')?.value || '';

  let sorted = txSorted(transactions);
  if (_undoPendingId) sorted = sorted.filter(t => t.id !== _undoPendingId);

  if (catFilter)  sorted = sorted.filter(t => t.category === catFilter);
  if (typeFilter) sorted = sorted.filter(t => t.type === typeFilter);
  if (searchQ)    sorted = sorted.filter(t =>
    (t.description || '').toLowerCase().includes(searchQ) ||
    (t.category    || '').toLowerCase().includes(searchQ)
  );

  const total = transactions.length;
  const shown = sorted.length;
  if (countEl) {
    countEl.textContent = (searchQ || catFilter || typeFilter)
      ? `${shown} of ${total} transaction${total !== 1 ? 's' : ''}`
      : `${total} transaction${total !== 1 ? 's' : ''}`;
  }

  if (!sorted.length) {
    el.innerHTML = '<div class="empty">No transactions match your filters</div>';
    return;
  }

  const balMap = computeRunningBalances();
  _preserveRemovingRows(el, () => {
    el.innerHTML = '';
    sorted.forEach(tx => el.appendChild(buildTxDiv(tx, balMap.get(tx.id))));
  });
}


function _txConfirmShow(actions) {
  const normal  = actions.querySelector('.txa-normal');
  const confirm = actions.querySelector('.txa-confirm');
  if (!normal || !confirm) return;
  normal.style.display  = 'none';
  confirm.style.display = 'flex';
  confirm.style.animationName = 'none';
  confirm.offsetWidth; // force reflow
  confirm.style.animationName = '';
  actions.classList.add('confirming');
}

function _txConfirmHide(actions) {
  const normal  = actions.querySelector('.txa-normal');
  const confirm = actions.querySelector('.txa-confirm');
  if (!normal || !confirm) return;
  normal.style.display  = '';
  confirm.style.display = 'none';
  actions.classList.remove('confirming');
}

window.showDeleteConfirm = function(id) {
  if (localStorage.getItem('skipDeleteConfirm') === '1') {
    window.confirmDeleteTx(id);
    return;
  }
  const activeList = activeView === 'transactions'
    ? document.getElementById('allTxList')
    : document.getElementById('txList');
  const txEl   = activeList ? activeList.querySelector('[data-tx-id="' + id + '"]')
                             : document.querySelector('[data-tx-id="' + id + '"]');
  const actions = txEl ? txEl.querySelector('.tx-actions') : null;
  if (!actions) return;

  document.querySelectorAll('.tx-actions.confirming').forEach(a => {
    if (a !== actions) _txConfirmHide(a);
  });

  if (actions.classList.contains('confirming')) {
    _txConfirmHide(actions);
  } else {
    _txConfirmShow(actions);
  }
};

window.cancelDeleteTx = function(btn) {
  const actions = btn.closest('.tx-actions');
  if (actions) _txConfirmHide(actions);
};

window.doConfirmDeleteTx = function(id, btn) {
  const confirm = btn.closest('.txa-confirm');
  const chk = confirm ? confirm.querySelector('.dont-ask-chk') : null;
  if (chk && chk.checked) localStorage.setItem('skipDeleteConfirm', '1');
  window.confirmDeleteTx(id);
};

const _removingIds = new Set();
function _animateRowOut(id) {
  if (_removingIds.has(id)) return;

  const row = (document.getElementById('txList')    || { querySelector: () => null })
                .querySelector('[data-tx-id="' + id + '"]')
           || (document.getElementById('allTxList') || { querySelector: () => null })
                .querySelector('[data-tx-id="' + id + '"]');
  if (!row) return;

  _removingIds.add(id);
  row.style.height = row.getBoundingClientRect().height + 'px';
  row.classList.add('removing');

  requestAnimationFrame(() => requestAnimationFrame(() => {
    row.style.height       = '0';
    row.style.marginBottom = '0';
    vibrate();
    row.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName !== 'height') return;
      row.removeEventListener('transitionend', onEnd);
      _removingIds.delete(id);
      row.remove();
    });
    setTimeout(() => { _removingIds.delete(id); if (row.parentNode) row.remove(); }, 500);
  }));
}

window.confirmDeleteTx = async function(id) {
  if (_undoPendingId && _undoPendingId !== id) {
    clearTimeout(_undoTimer);
    _undoTimer = null;
    const staleId = _undoPendingId;
    _undoPendingId = null;
    _undoTxSnapshot = null;
    await window.deleteDoc(txDocRef(staleId)).catch(console.error);
  }

  const tx = transactions.find(t => t.id === id);
  _undoTxSnapshot = tx ? { ...tx } : null;
  _undoPendingId  = id;

  _animateRowOut(id);

  const label = (tx && (tx.description || tx.category)) || 'Transaction';
  _snack.show(`"${label}" deleted`);

  clearTimeout(_undoTimer);
  _undoTimer = setTimeout(async () => {
    _undoTimer = null;
    if (_undoPendingId !== id) return;
    _undoPendingId  = null;
    _undoTxSnapshot = null;
    _snack.hide();
    await window.deleteDoc(txDocRef(id)).catch(console.error);
  }, 4000);
};

async function _undoDelete() {
  if (!_undoPendingId) return;
  clearTimeout(_undoTimer);
  _undoTimer      = null;
  const id        = _undoPendingId;
  const snapshot  = _undoTxSnapshot;   // capture before clearing
  _undoPendingId  = null;
  _undoTxSnapshot = null;
  _snack.hide();

  // Optimistically restore in the UI immediately
  window._restoringTxId = id;
  renderTxList();
  if (activeView === 'transactions') renderAllTxList();
  setTimeout(() => { window._restoringTxId = null; }, 500);

  // Defensively re-write the document to Firestore in case the 4-second
  // timer won the race and already deleted it. setDoc with the original
  // data restores it idempotently; if the doc still exists this is a no-op.
  if (snapshot) {
    const { id: _ignoredId, hasPendingWrites: _hw, ...firestoreData } = snapshot;
    try {
      await window.setDoc(txDocRef(id), firestoreData);
    } catch (e) {
      console.error('_undoDelete Firestore restore failed:', e);
    }
  }
}

let _txDetailId = null;
let _txDetailEditing = false;

function fmtDateTime(v) {
  if (!v) return '—';
  const d = v && v.toDate ? v.toDate() : new Date(v);
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
    + ' · ' + d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
}

window.openTxDetail = function(id) {
  const tx = transactions.find(t => t.id === id);
  if (!tx) return;
  _txDetailId = id;
  _txDetailEditing = false;

  const d = toDate(tx.selectedDate);
  const color = catColorByName(tx.type, tx.category);

  document.getElementById('txdTypeDot').style.background = tx.type === 'income' ? 'var(--green)' : 'var(--red)';
  document.getElementById('txdTypeLabel').textContent = tx.type;
  const amtEl = document.getElementById('txdAmount');
  amtEl.textContent = (tx.type === 'income' ? '+' : '−') + fmt(tx.amount);
  amtEl.className = 'txd-amount ' + tx.type;
  document.getElementById('txdCategory').innerHTML =
    `<span class="tx-badge" style="background:${color}22;color:${color}">${tx.category}</span>`;
  document.getElementById('txdDate').textContent = d
    ? d.toLocaleDateString('en-IN', { weekday:'short', day:'2-digit', month:'long', year:'numeric' })
    : 'No date';

  const noteRow = document.getElementById('txdNoteRow');
  if (tx.description) {
    document.getElementById('txdNote').textContent = tx.description;
    noteRow.style.display = '';
  } else {
    noteRow.style.display = 'none';
  }

  document.getElementById('txdAdded').textContent = fmtDateTime(tx.createdAt);

  const updRow = document.getElementById('txdUpdatedRow');
  if (tx.updatedAt) {
    document.getElementById('txdUpdated').textContent = fmtDateTime(tx.updatedAt);
    updRow.style.display = '';
  } else {
    updRow.style.display = 'none';
  }

  document.getElementById('txdView').style.display = '';
  document.getElementById('txdEdit').style.display = 'none';

  document.getElementById('txDetailBg').classList.add('open');
  document.body.style.overflow = 'hidden';
};

window.closeTxDetail = function(e) {
  if (e && e.target !== document.getElementById('txDetailBg')) return;
  const bg = document.getElementById('txDetailBg');
  bg.classList.remove('open');
  document.body.style.overflow = '';
  _txDetailId = null;
};
(function() {
  var panel = document.getElementById('txDetailPanel');
  if (panel && !panel._dragWired) {
    panel._dragWired = true;
    wireBottomSheetDrag(panel, function() {
      document.getElementById('txDetailBg').classList.remove('open');
      document.body.style.overflow = '';
      _txDetailId = null;
    });
  }
})();

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('txDetailBg').classList.contains('open')) {
    document.getElementById('txDetailBg').classList.remove('open');
    document.body.style.overflow = '';
    _txDetailId = null;
  }
});

window.txDetailStartEdit = function() {
  const tx = transactions.find(t => t.id === _txDetailId);
  if (!tx) return;
  const d = toDate(tx.selectedDate);

  document.getElementById('txdEditDate').value = toInputDate(d);
  document.getElementById('txdEditAmount').value = tx.amount;
  document.getElementById('txdEditNote').value = tx.description || '';

  const sel = document.getElementById('txdEditCategory');
  sel.innerHTML = '<option value="">Select</option>';
  const allCats = [...(categories.income||[]), ...(categories.expense||[])];
  allCats.forEach(cat => {
    const name = typeof cat === 'string' ? cat : cat.name;
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if (name === tx.category) opt.selected = true;
    sel.appendChild(opt);
  });

  document.getElementById('txdView').style.display = 'none';
  document.getElementById('txdEdit').style.display = '';
};

window.txDetailCancelEdit = function() {
  document.getElementById('txdView').style.display = '';
  document.getElementById('txdEdit').style.display = 'none';
};

window.txDetailSave = async function() {
  const category = document.getElementById('txdEditCategory').value;
  const rawAmt   = document.getElementById('txdEditAmount').value.replace(/,/g,'').trim();
  const amount   = parseFloat(rawAmt);
  const dateVal  = document.getElementById('txdEditDate').value;
  const note     = document.getElementById('txdEditNote').value.trim();
  const type     = catType(category);
  if (!category || !amount || !dateVal || !type) { alert('Please fill all fields'); return; }
  await window.setDoc(
    window.doc(window.db, 'users', uid, 'accounts', activeAccountId, 'transactions', _txDetailId),
    { type, category, amount, description: note, selectedDate: new Date(dateVal + 'T00:00:00'), updatedAt: window.serverTimestamp() },
    { merge: true }
  );
  document.getElementById('txDetailBg').classList.remove('open');
  document.body.style.overflow = '';
  _txDetailId = null;
  vibrate();
};

window.txDetailDelete = function() {
  const btn = document.getElementById('txdDeleteBtn');
  const existing = document.getElementById('txDetailBg').querySelector('.tx-confirm-row');
  if (existing) { existing.remove(); btn.style.display = ''; return; }
  btn.style.display = 'none';
  const row = document.createElement('div');
  row.className = 'tx-confirm-row';
  row.style.cssText = 'padding:0 20px 14px;';
  const label = document.createElement('span');
  label.className = 'tx-confirm-label'; label.textContent = 'Delete this transaction?';
  const yes = document.createElement('button');
  yes.className = 'btn-sm del'; yes.textContent = 'Yes, delete';
  yes.addEventListener('click', async () => {
    const id = _txDetailId;
    document.getElementById('txDetailBg').classList.remove('open');
    document.body.style.overflow = '';
    _txDetailId = null;
    await window.confirmDeleteTx(id);
  });
  const no = document.createElement('button');
  no.className = 'btn-sm'; no.textContent = 'Cancel';
  no.addEventListener('click', () => { row.remove(); btn.style.display = ''; });
  row.appendChild(label); row.appendChild(yes); row.appendChild(no);
  btn.parentNode.appendChild(row);
};

window.openEditModal = function(id) {
  editTxId = id;
  const tx = transactions.find(t => t.id === id);
  if (!tx) return;
  const d = toDate(tx.selectedDate);
  document.getElementById('editDate').value     = toInputDate(d);
  document.getElementById('editCategory').value = tx.category;
  document.getElementById('editAmount').value   = tx.amount;
  document.getElementById('editNote').value     = tx.description || '';
  document.getElementById('editModalBg').classList.add('open');
  document.body.style.overflow = 'hidden';
};
window.closeEditModal = function() {
  document.getElementById('editModalBg').classList.remove('open');
  document.body.style.overflow = '';
  editTxId = null;
};
window.saveEdit = async function() {
  const category = document.getElementById('editCategory').value;
  const rawAmt   = document.getElementById('editAmount').value.replace(/,/g,'').trim();
  const amount   = parseFloat(rawAmt);
  const dateVal  = document.getElementById('editDate').value;
  const note     = document.getElementById('editNote').value.trim();
  const type     = catType(category);
  if (!category || !amount || !dateVal || !type) { alert('Please fill all fields'); return; }

  const saveBtn = document.querySelector('#editModalBg .btn-primary');
  const origHtml = saveBtn ? saveBtn.innerHTML : null;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="btn-spinner"></span> Saving…';
  }

  try {
    await window.setDoc(
      window.doc(window.db, 'users', uid, 'accounts', activeAccountId, 'transactions', editTxId),
      { type, category, amount, description: note, selectedDate: new Date(dateVal + 'T00:00:00'), updatedAt: window.serverTimestamp() },
      { merge: true }
    );
    vibrate();
    if (saveBtn) {
      saveBtn.innerHTML = '✓ Saved';
      saveBtn.style.background = 'var(--green)';
      saveBtn.style.color = '#fff';
      saveBtn.style.borderColor = 'var(--green)';
    }
    setTimeout(() => {
      if (saveBtn) {
        saveBtn.style.background = '';
        saveBtn.style.color = '';
        saveBtn.style.borderColor = '';
        saveBtn.disabled = false;
        if (origHtml) saveBtn.innerHTML = origHtml;
      }
      closeEditModal();
    }, 900);
  } catch (e) {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = origHtml || 'Save';
    }
    alert('Could not save: ' + e.message);
  }
};

function renderStats() {
  if (!window._allDataLoaded) return;

  const tcEl = document.getElementById('profileTxCount');
  if (tcEl) tcEl.textContent = transactions.length;
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth();
  const monthTx = transactions.filter(t => {
    const d = toDate(t.selectedDate || t.createdAt);
    return d && d.getFullYear() === curY && d.getMonth() === curM;
  });
  const income  = monthTx.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const expense = monthTx.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const pending = pendingAmounts.reduce((s,p)=>s+p.amount,0);
  const allIncome  = transactions.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const allExpense = transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const balance = startingBalance + allIncome - allExpense - pending;

  const incomeEl = document.getElementById('sIncome');
  const expenseEl = document.getElementById('sExpense');
  const balanceEl = document.getElementById('sBalance');
  const pendingEl = document.getElementById('sPending');

  const elements = [incomeEl, expenseEl, balanceEl, pendingEl].filter(Boolean);
  const valueMap = new Map([
    [incomeEl, fmt(income)], [expenseEl, fmt(expense)],
    [balanceEl, fmt(balance)], [pendingEl, fmt(pending)]
  ]);

  const hasSpinners = incomeEl && incomeEl.querySelector('.loading-spinner') !== null;

  if (hasSpinners) {
    elements.forEach(el => {
      el.style.transition = 'opacity 0.2s ease';
      el.style.opacity = '0';
    });
    setTimeout(() => {
      elements.forEach(el => {
        el.innerHTML = valueMap.get(el);
        el.style.opacity = '0'; // ensure we start from invisible
      });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        elements.forEach(el => { el.style.opacity = '1'; });
      }));
    }, 200);
  } else {
    elements.forEach(el => el.innerHTML = valueMap.get(el));
  }

  const cfEl = document.getElementById('cfStartBal');
  if (cfEl) cfEl.textContent = fmt(startingBalance);

  const topEl = document.getElementById('sPendingTop');
  if (topEl) {
    if (pendingAmounts.length) {
      const top = pendingAmounts.reduce((a, b) => b.amount > a.amount ? b : a);
      topEl.innerHTML = `<span class="pending-dot"></span><span class="pending-top-name">${esc(top.name)}</span><span class="pending-top-amt">${fmt(top.amount)}</span>`;
    } else {
      topEl.innerHTML = '';
    }
  }

  renderSparklines();
  renderTopSpending();
}


function renderTopSpending() {
  const el = document.getElementById('topSpendingList');
  const monthEl = document.getElementById('topSpendingMonth');
  if (!el) return;

  const now  = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth();

  if (monthEl) {
    monthEl.textContent = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  }

  const monthExpenses = transactions.filter(t => {
    const d = toDate(t.selectedDate || t.createdAt);
    return t.type === 'expense' && d && d.getFullYear() === curY && d.getMonth() === curM;
  });

  if (!monthExpenses.length) {
    el.innerHTML = '<div class="empty">No expenses this month</div>';
    return;
  }

  const totals = {};
  monthExpenses.forEach(t => {
    const cat = t.category || 'Other';
    totals[cat] = (totals[cat] || 0) + t.amount;
  });

  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const maxAmt = sorted[0][1];

  el.innerHTML = sorted.map(([name, spent]) => {
    const catObj  = (categories.expense || []).find(c => catName(c) === name);
    const color   = catObj?.color || '#6b7280';
    const budget  = catObj?.budget || null;
    const pct     = Math.min(100, Math.round((spent / maxAmt) * 100));
    const budgetPct = budget ? Math.min(100, Math.round((spent / budget) * 100)) : null;
    const overBudget = budget && spent > budget;
    const barPct  = budget ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
    const barFill = overBudget ? 'var(--red)' : color;

    const budgetLine = budget
      ? `<span class="tsc-budget ${overBudget ? 'over' : ''}">${overBudget ? '⚠ ' : ''}${fmt(spent)} / ${fmt(budget)}</span>`
      : `<span class="tsc-budget">${fmt(spent)}</span>`;

    const barHtml = budget
      ? `<div class="tsc-bar-wrap"><div class="tsc-bar-fill" style="width:${barPct}%;background:${barFill}"></div></div>`
      : '';

    return `
      <div class="tsc-row">
        <div class="tsc-meta">
          <span class="tsc-dot" style="background:${color}"></span>
          <span class="tsc-name">${esc(name)}</span>
          ${budgetLine}
        </div>
        ${barHtml}
      </div>`;
  }).join('');
}

function renderSparklines() {
  if (!transactions) return;
  const DAYS = 30;
  const now  = new Date();

  function dailyTotals(type, n) {
    const buckets = new Array(n).fill(0);
    transactions.forEach(t => {
      if (t.type !== type) return;
      const d = toDate(t.selectedDate);
      if (!d) return;
      const diff = Math.floor((now - d) / 86_400_000);
      if (diff >= 0 && diff < n) buckets[n - 1 - diff] += t.amount;
    });
    return buckets;
  }

  function dailyBalance(n) {
    return Array.from({ length: n }, (_, i) => {
      const dayEnd = new Date(now);
      dayEnd.setDate(dayEnd.getDate() - (n - 1 - i));
      dayEnd.setHours(23, 59, 59, 999);
      let bal = startingBalance;
      transactions.forEach(t => {
        const d = toDate(t.selectedDate);
        if (d && d <= dayEnd) bal += t.type === 'income' ? t.amount : -t.amount;
      });
      return bal;
    });
  }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  drawSparkline('sparkIncome',  dailyTotals('income',  DAYS), '#0FA974', isDark);
  drawSparkline('sparkExpense', dailyTotals('expense', DAYS), '#E84545', isDark);
  drawSparkline('sparkBalance', dailyBalance(DAYS),            null,     isDark);
}

function drawSparkline(id, data, color, isDark) {
  const svg = document.getElementById(id);
  if (!svg) return;

  const resolvedColor = color || (isDark ? '#a0a0a0' : '#6b7280');

  const n   = data.length;
  const max = Math.max(...data);
  const min = Math.min(...data);

  const W = Math.round(svg.getBoundingClientRect().width) || 300;
  const H = 56;
  const PAD_T = 8;   // gap above the peak so the line isn't clipped
  const PAD_B = 4;   // enough room for stroke-width/2 so zero values aren't clipped
  const range = (max - min) || 1;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  const pts = data.map((v, i) => [
    (i / (n - 1)) * W,
    PAD_T + (1 - (v - min) / range) * (H - PAD_T - PAD_B)
  ]);

  function makePath(points) {
    let d = `M ${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      const cpX = ((points[i - 1][0] + points[i][0]) / 2).toFixed(1);
      d += ` C ${cpX},${points[i-1][1].toFixed(1)} ${cpX},${points[i][1].toFixed(1)} ${points[i][0].toFixed(1)},${points[i][1].toFixed(1)}`;
    }
    return d;
  }

  const linePath = makePath(pts);
  const fillPath = `${linePath} L ${W},${H} L 0,${H} Z`;
  const gradId   = `sg_${id}`;

  const fillOpacity0 = isDark ? '0.30' : '0.20';
  const lineOpacity  = isDark ? '0.90' : '0.80';

  svg.innerHTML = `
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${resolvedColor}" stop-opacity="${fillOpacity0}"/>
        <stop offset="100%" stop-color="${resolvedColor}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${fillPath}" fill="url(#${gradId})"/>
    <path d="${linePath}" fill="none" stroke="${resolvedColor}"
          stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
          opacity="${lineOpacity}"/>
  `;

  svg.classList.add('loaded');
}

function listenPending() {
  if (_unsubPending) { _unsubPending(); _unsubPending = null; }
  const q = window.query(
    pendingCol(),
    window.orderBy('createdAt', 'desc')
  );
  let _pendingFirstSnap = true;
  _unsubPending = window.onSnapshot(q, snap => {
    pendingAmounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPendingList();
    renderStats();

    if (_pendingFirstSnap && window._dataLoaded) {
      _pendingFirstSnap = false;
      window._dataLoaded.pending = true;
      window._checkAllDataLoaded();
    }
  });
}

function wireAddPending() {
  const bg       = document.getElementById('pendingSheetBg');
  const closeBtn = document.getElementById('pendingSheetCloseBtn');
  const openBtn  = document.getElementById('btnOpenPending');

  function openPendingSheet() {
    bg.classList.add('open');
    if (openBtn) openBtn.classList.add('open');
    const fab = document.getElementById('bnAddTx');
    if (fab) fab.classList.add('open');
    document.body.style.overflow = 'hidden';
    ['bnDash','bnAnalytics','bnTransactions','bnSettings'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });
  }

  function closePendingSheet() {
    bg.classList.remove('open');
    if (openBtn) openBtn.classList.remove('open');
    const fab = document.getElementById('bnAddTx');
    if (fab) fab.classList.remove('open');
    document.body.style.overflow = '';
    const bnMap = { dashboard: 'bnDash', analytics: 'bnAnalytics', transactions: 'bnTransactions' };
    const activeEl = document.getElementById(bnMap[activeView] || 'bnDash');
    if (activeEl) activeEl.classList.add('active');
  }

  window.openPendingSheet  = openPendingSheet;
  window.closePendingSheet = closePendingSheet;

  if (openBtn) openBtn.addEventListener('click', () => {
    if (bg.classList.contains('open')) closePendingSheet();
    else openPendingSheet();
  });
  if (closeBtn) closeBtn.addEventListener('click', closePendingSheet);
  bg.addEventListener('click', e => {
    const panel = document.getElementById('pendingSheet');
    if (panel && !panel.contains(e.target)) closePendingSheet();
  });

  wireBottomSheetDrag(document.getElementById('pendingSheet'), closePendingSheet);

  document.getElementById('addPendingBtn').addEventListener('click', async () => {
    const name   = document.getElementById('pendingName').value.trim();
    const raw    = document.getElementById('pendingAmt').value.replace(/,/g,'').trim();
    const amount = parseFloat(raw);
    if (!name || !amount || amount <= 0) { alert('Enter a name and amount'); return; }
    const btn = document.getElementById('addPendingBtn');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    await window.addDoc(
      window.collection(window.db, 'users', uid, 'accounts', activeAccountId, 'pending'),
      { name, amount, createdAt: window.serverTimestamp() }
    );
    document.getElementById('pendingName').value = '';
    document.getElementById('pendingAmt').value  = '';
    btn.textContent = '✓ Added!';
    btn.style.background = 'var(--green)';
    vibrate();
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Add Pending';
      btn.style.background = '';
      closePendingSheet();
    }, 1000);
  });
}

function renderPendingList() {
  const el = document.getElementById('pendingList');
  const isMobile = window.innerWidth <= 768;
  const pendingCard = document.querySelector('.pending-card');
  const pendingStatAdd = document.getElementById('pendingStatAdd');

  if (isMobile && pendingCard) {
    const hide = pendingAmounts.length === 0;
    pendingCard.classList.toggle('pending-card-mobile-hidden', hide);
  }

  if (pendingStatAdd) {
    pendingStatAdd.style.display = (isMobile && pendingAmounts.length === 0) ? '' : 'none';
  }

  if (!pendingAmounts.length) { el.innerHTML = '<div class="empty">No pending amounts</div>'; return; }
  el.innerHTML = '';

  const hint = document.createElement('p');
  hint.className = 'pending-hint';
  hint.textContent = 'Tap the circle when money is credited.';
  el.appendChild(hint);

  pendingAmounts.forEach(p => {
    const div = document.createElement('div');
    div.className = 'pending-item';
    div.innerHTML = `
      <label class="p-check-wrap" title="Mark as cleared">
        <input type="checkbox" class="p-check-input" onchange="clearPending('${p.id}')">
        <span class="p-check-circle">
          <svg class="p-check-icon" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <polyline points="2,6 5,9 10,3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </label>
      <span class="p-name">${esc(p.name)}</span>
      <span class="p-amount">${fmt(p.amount)}</span>
    `;
    el.appendChild(div);
  });
}

window.clearPending = async function(id) {
  await window.deleteDoc(pendDocRef(id));
  vibrate();
};

function renderDaily() {
  const dateVal = document.getElementById('dailyDate').value;
  if (!dateVal) return;
  const sel  = new Date(dateVal);
  const prev = new Date(sel); prev.setDate(prev.getDate() - 1);

  const selExp  = transactions.filter(t => { const d = toDate(t.selectedDate); return t.type==='expense' && d && d.toDateString()===sel.toDateString(); });
  const prevExp = transactions.filter(t => { const d = toDate(t.selectedDate); return t.type==='expense' && d && d.toDateString()===prev.toDateString(); });
  const selTotal  = selExp.reduce((s,t)=>s+t.amount,0);
  const prevTotal = prevExp.reduce((s,t)=>s+t.amount,0);

  document.getElementById('cmpToday').textContent     = fmt(selTotal);
  document.getElementById('cmpYesterday').textContent = fmt(prevTotal);

  const diff = selTotal - prevTotal;
  const resultEl = document.getElementById('cmpResult');
  const arrowEl  = document.getElementById('cmpArrow');
  if (diff > 0) {
    resultEl.textContent = `${fmt(diff)} more than previous day`; resultEl.className='cmp-result neg';
    arrowEl.textContent = '↑'; arrowEl.className = 'cmp-arrow up';
  } else if (diff < 0) {
    resultEl.textContent = `${fmt(Math.abs(diff))} less than previous day`; resultEl.className='cmp-result pos';
    arrowEl.textContent = '↓'; arrowEl.className = 'cmp-arrow down';
  } else {
    resultEl.textContent = selTotal===0?'No spending on either day':'Same as previous day'; resultEl.className='cmp-result';
    arrowEl.textContent = '='; arrowEl.className='cmp-arrow flat';
  }
  renderPieChart('dailyChartWrap', selExp, 'expense');
}
document.getElementById('dailyDate').addEventListener('change', renderDaily);

(function wireDescSuggestions() {
  const noteInput = document.getElementById('txNote');
  const catSelect = document.getElementById('txCategory');
  if (!noteInput || !catSelect) return;
  let suggestEl = null;

  function getSuggestions(cat, query) {
    if (!cat || !query) return [];
    const q = query.toLowerCase();
    const seen = new Set();
    return transactions
      .filter(t => t.category === cat && t.description && t.description.toLowerCase().includes(q))
      .map(t => t.description.trim())
      .filter(d => { if (seen.has(d)) return false; seen.add(d); return true; })
      .slice(0, 5);
  }

  function showSuggestions(list) {
    removeSuggestions();
    if (!list.length) return;
    suggestEl = document.createElement('div');
    suggestEl.className = 'desc-suggestions';
    list.forEach(text => {
      const item = document.createElement('div');
      item.className = 'desc-suggestion-item';
      item.textContent = text;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        noteInput.value = text;
        removeSuggestions();
      });
      suggestEl.appendChild(item);
    });
    noteInput.parentNode.style.position = 'relative';
    noteInput.parentNode.appendChild(suggestEl);
  }

  function removeSuggestions() {
    if (suggestEl) { suggestEl.remove(); suggestEl = null; }
  }

  noteInput.addEventListener('input', () => {
    const q = noteInput.value.trim();
    if (q.length < 1) { removeSuggestions(); return; }
    showSuggestions(getSuggestions(catSelect.value, q));
  });
  noteInput.addEventListener('blur', () => setTimeout(removeSuggestions, 150));
  catSelect.addEventListener('change', () => {
    if (noteInput.value.trim()) showSuggestions(getSuggestions(catSelect.value, noteInput.value.trim()));
  });
})();

function renderMonthly() {
  const val = document.getElementById('monthlyDate').value;
  if (!val) return;
  const [y, m] = val.split('-').map(Number);

  const monthTx  = transactions.filter(t => {
    const d = toDate(t.selectedDate);
    return d && d.getFullYear()===y && d.getMonth()===m-1;
  });

  const prevDate = new Date(y, m-1, 1);
  prevDate.setMonth(prevDate.getMonth() - 1);
  const prevY = prevDate.getFullYear();
  const prevM = prevDate.getMonth();
  const prevMonthTx = transactions.filter(t => {
    const d = toDate(t.selectedDate);
    return d && d.getFullYear()===prevY && d.getMonth()===prevM;
  });

  const monthInc = monthTx.filter(t=>t.type==='income');
  const monthExp = monthTx.filter(t=>t.type==='expense');
  const monthIncTotal = monthInc.reduce((s,t)=>s+t.amount,0);
  const monthExpTotal = monthExp.reduce((s,t)=>s+t.amount,0);

  const prevMonthInc = prevMonthTx.filter(t=>t.type==='income');
  const prevMonthExp = prevMonthTx.filter(t=>t.type==='expense');
  const prevMonthIncTotal = prevMonthInc.reduce((s,t)=>s+t.amount,0);
  const prevMonthExpTotal = prevMonthExp.reduce((s,t)=>s+t.amount,0);

  document.getElementById('msIncome').textContent  = fmt(monthIncTotal);
  document.getElementById('msExpense').textContent = fmt(monthExpTotal);

  const msArrow = document.getElementById('msArrow');
  if (monthIncTotal > monthExpTotal) {
    msArrow.textContent = '↓';
    msArrow.style.color = 'var(--green)';
  } else if (monthIncTotal < monthExpTotal) {
    msArrow.textContent = '↑';
    msArrow.style.color = 'var(--red)';
  } else {
    msArrow.textContent = '→';
    msArrow.style.color = 'var(--text-3)';
  }

  const typeLabel = monthlyType === 'income' ? 'Income' : 'Expense';
  document.getElementById('monthlyLabel').textContent = `Monthly ${typeLabel}`;

  const thisTotal = monthlyType === 'income' ? monthIncTotal : monthExpTotal;
  const lastTotal = monthlyType === 'income' ? prevMonthIncTotal : prevMonthExpTotal;

  document.getElementById('monthlyThis').textContent = fmt(thisTotal);
  document.getElementById('monthlyLast').textContent = fmt(lastTotal);

  const diff = thisTotal - lastTotal;
  const resultEl = document.getElementById('monthlyResult');
  const arrowEl  = document.getElementById('monthlyArrow');

  if (diff > 0) {
    resultEl.textContent = `${fmt(diff)} more than last month`;
    resultEl.className='cmp-result neg';
    arrowEl.textContent = '↑';
    arrowEl.className = 'cmp-arrow up';
  } else if (diff < 0) {
    resultEl.textContent = `${fmt(Math.abs(diff))} less than last month`;
    resultEl.className='cmp-result pos';
    arrowEl.textContent = '↓';
    arrowEl.className = 'cmp-arrow down';
  } else {
    resultEl.textContent = thisTotal===0 ? 'No data for either month' : 'Same as last month';
    resultEl.className='cmp-result';
    arrowEl.textContent = '=';
    arrowEl.className='cmp-arrow flat';
  }

  const data = monthlyType === 'income' ? monthInc : monthExp;
  renderPieChart('monthlyChartWrap', data, monthlyType);
  renderMonthlyLineChart(y, m, monthlyType === 'income' ? monthInc : monthExp, monthlyType);

  const totals = {}; const colors = {};
  data.forEach(t => {
    totals[t.category] = (totals[t.category]||0) + t.amount;
    colors[t.category] = catColorByName(monthlyType, t.category);
  });
  const sorted = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  const el = document.getElementById('breakdownList');
  if (!sorted.length) {
    el.innerHTML=`<div class="empty">No ${monthlyType} this month</div>`;
    return;
  }
  el.innerHTML = '';
  sorted.forEach(([name, amt]) => {
    const div = document.createElement('div');
    div.className = 'breakdown-item';

    let budgetBarHtml = '';
    if (monthlyType === 'expense') {
      const cat = categories.expense.find(c => catName(c) === name);
      const budget = cat && typeof cat === 'object' ? cat.budget : null;
      if (budget) {
        const pct = Math.min((amt / budget) * 100, 100);
        const isOver = amt > budget;
        const remaining = budget - amt;
        const barColor = isOver ? 'var(--red)' : pct > 80 ? 'var(--amber,#f59e0b)' : colors[name] || 'var(--green)';
        const budgetText = isOver
          ? `<span style="color:var(--red)">₹${fmt(Math.abs(remaining)).slice(1)} over</span>`
          : `<span style="color:var(--text-3)">₹${fmt(remaining).slice(1)} left of ₹${fmt(budget).slice(1)}</span>`;
        budgetBarHtml = `
          <div class="b-progress-row">
            <div class="b-progress-track">
              <div class="b-progress-fill" style="width:${pct}%;background:${barColor};"></div>
            </div>
            <div class="b-progress-label">${budgetText}</div>
          </div>`;
      }
    }

    div.innerHTML = `
      <div class="b-top-row">
        <div class="b-name"><div class="b-dot" style="background:${colors[name]}"></div><span>${name}</span></div>
        <div class="b-amt">${fmt(amt)}</div>
      </div>
      ${budgetBarHtml}
    `;
    el.appendChild(div);
  });

  renderMonthlyInsights(y, m, monthTx, prevMonthTx, monthInc, monthExp, monthIncTotal, monthExpTotal, prevMonthIncTotal, prevMonthExpTotal);
}

function renderMonthlyInsights(y, m, monthTx, prevMonthTx, monthInc, monthExp, monthIncTotal, monthExpTotal, prevIncTotal, prevExpTotal) {
  const el = document.getElementById('monthlyInsights');
  if (!el) return;

  const cards = [];
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === y && today.getMonth() === m - 1;
  const daysPassed = isCurrentMonth ? today.getDate() : daysInMonth;

  if (monthExpTotal > 0 || prevExpTotal > 0) {
    const diff = monthExpTotal - prevExpTotal;
    const pct = prevExpTotal > 0 ? Math.round((diff / prevExpTotal) * 100) : null;
    const isUp = diff > 0;
    cards.push({
      tone: isUp ? 'neg' : 'pos',
      icon: '💸',
      label: 'Total Spending',
      msg: pct !== null
        ? `<strong>${fmt(monthExpTotal)}</strong> — ${Math.abs(pct)}% ${isUp ? 'more' : 'less'} than last month`
        : `<strong>${fmt(monthExpTotal)}</strong> this month`
    });
  }

  if (monthIncTotal > 0) {
    const net = monthIncTotal - monthExpTotal;
    const rate = Math.round((net / monthIncTotal) * 100);
    const isOver = net < 0;
    cards.push({
      tone: isOver ? 'neg' : rate >= 20 ? 'pos' : 'warn',
      icon: isOver ? '⚠️' : '🏦',
      label: 'Net Savings',
      msg: isOver
        ? `Overspent by <strong style="color:var(--red)">${fmt(Math.abs(net))}</strong>`
        : `Saved <strong>${fmt(net)}</strong> — ${rate}% of income`
    });
  }

  if (monthIncTotal > 0 || prevIncTotal > 0) {
    const diff = monthIncTotal - prevIncTotal;
    const pct = prevIncTotal > 0 ? Math.round((diff / prevIncTotal) * 100) : null;
    cards.push({
      tone: diff >= 0 ? 'pos' : 'neg',
      icon: '📥',
      label: 'Income',
      msg: pct !== null
        ? `<strong>${fmt(monthIncTotal)}</strong> — ${Math.abs(pct)}% ${diff >= 0 ? 'up' : 'down'} vs last month`
        : `<strong>${fmt(monthIncTotal)}</strong> this month`
    });
  }

  if (monthExp.length > 0) {
    const totals = {};
    monthExp.forEach(t => { totals[t.category] = (totals[t.category] || 0) + t.amount; });
    const [topCat, topAmt] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
    const share = Math.round((topAmt / monthExpTotal) * 100);
    cards.push({
      tone: 'neutral',
      icon: '🏷️',
      label: 'Top Category',
      msg: `<strong>${topCat}</strong> — ${fmt(topAmt)} (${share}% of expenses)`
    });
  }

  if (monthExp.length > 0 && prevMonthTx.length > 0) {
    const cur = {}, prev = {};
    monthExp.forEach(t => { cur[t.category] = (cur[t.category] || 0) + t.amount; });
    prevMonthTx.filter(t => t.type === 'expense').forEach(t => { prev[t.category] = (prev[t.category] || 0) + t.amount; });
    let biggestCat = null, biggestPct = 0;
    Object.entries(cur).forEach(([cat, amt]) => {
      if (prev[cat] && prev[cat] > 0) {
        const pct = ((amt - prev[cat]) / prev[cat]) * 100;
        if (pct > biggestPct) { biggestPct = pct; biggestCat = cat; }
      }
    });
    if (biggestCat && biggestPct > 10) {
      cards.push({
        tone: 'warn',
        icon: '📈',
        label: 'Biggest Jump',
        msg: `<strong>${biggestCat}</strong> up ${Math.round(biggestPct)}% vs last month`
      });
    }
  }

  const budgetCats = categories.expense.filter(c => typeof c === 'object' && c.budget);
  if (budgetCats.length > 0 && monthExp.length > 0) {
    const totals = {};
    monthExp.forEach(t => { totals[t.category] = (totals[t.category] || 0) + t.amount; });
    const totalBudget = budgetCats.reduce((s, c) => s + c.budget, 0);
    const totalUsed = budgetCats.reduce((s, c) => s + (totals[catName(c)] || 0), 0);
    const pct = Math.round((totalUsed / totalBudget) * 100);
    const overCats = budgetCats.filter(c => (totals[catName(c)] || 0) > c.budget);
    cards.push({
      tone: overCats.length > 0 ? 'neg' : pct > 80 ? 'warn' : 'pos',
      icon: '🎯',
      label: 'Budget Used',
      msg: overCats.length > 0
        ? `${pct}% used — <strong style="color:var(--red)">${overCats.length} category over limit</strong>`
        : `<strong>${pct}%</strong> of total budget used`
    });
  }

  if (monthExpTotal > 0 && daysPassed > 0) {
    const avg = monthExpTotal / daysPassed;
    const projected = avg * daysInMonth;
    cards.push({
      tone: 'neutral',
      icon: '📅',
      label: 'Daily Average',
      msg: isCurrentMonth
        ? `<strong>${fmt(avg)}</strong>/day — projected <strong>${fmt(projected)}</strong> by month end`
        : `<strong>${fmt(avg)}</strong>/day average`
    });
  }

  if (monthExp.length > 0) {
    const prevCount = prevMonthTx.filter(t => t.type === 'expense').length;
    const diff = monthExp.length - prevCount;
    const avg = (monthExpTotal / monthExp.length);
    cards.push({
      tone: 'neutral',
      icon: '🧾',
      label: 'Transactions',
      msg: prevCount > 0
        ? `<strong>${monthExp.length}</strong> expenses (${diff >= 0 ? '+' : ''}${diff} vs last month) · avg <strong>${fmt(avg)}</strong>`
        : `<strong>${monthExp.length}</strong> expense transactions · avg <strong>${fmt(avg)}</strong>`
    });
  }

  if (!cards.length) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="insights-header">
      <span class="insights-title">Monthly Insights</span>
    </div>
    <div class="insights-grid">
      ${cards.map(card => `
        <div class="insight-card insight-${card.tone}">
          <div class="insight-icon">${card.icon}</div>
          <div class="insight-body">
            <div class="insight-label">${card.label}</div>
            <div class="insight-msg">${card.msg}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

document.getElementById('monthlyDate').addEventListener('change', renderMonthly);

let _txSearchDebounceTimer = null;
document.getElementById('txSearchInput').addEventListener('input', () => {
  clearTimeout(_txSearchDebounceTimer);
  _txSearchDebounceTimer = setTimeout(renderAllTxList, 200);
});
document.getElementById('txCategoryFilter').addEventListener('change', renderAllTxList);
document.getElementById('txTypeFilter').addEventListener('change', renderAllTxList);

function renderYearly() {
  const year = parseInt(document.getElementById('yearlyYear').value);
  if (!year) return;

  const typeLabel = yearlyType === 'income' ? 'Income' : 'Expenses';
  document.getElementById('yearlyLabel').textContent = `Monthly ${typeLabel} by Category`;

  const yearlyData = transactions.filter(t => { const d = toDate(t.selectedDate); return t.type===yearlyType && d && d.getFullYear()===year; });
  const catSet = new Set(); yearlyData.forEach(t => catSet.add(t.category));
  if (!catSet.size) {
    document.getElementById('yearlyBody').innerHTML = `<tr><td colspan="15" class="empty">No ${yearlyType} data for ${year}</td></tr>`;
    return;
  }
  const data = {};
  catSet.forEach(c => { data[c] = Array(12).fill(0); });
  yearlyData.forEach(t => { const d = toDate(t.selectedDate); if (d) data[t.category][d.getMonth()] += t.amount; });
  const sorted = Object.keys(data).sort((a,b) => data[b].reduce((s,v)=>s+v,0) - data[a].reduce((s,v)=>s+v,0));

  const tbody = document.getElementById('yearlyBody');
  tbody.innerHTML = '';
  sorted.forEach(cat => {
    const months = data[cat];
    const total  = months.reduce((s,v)=>s+v,0);
    const avg    = total / 12;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${cat}</td>${months.map(v=>`<td>${v>0?fmt(v):'—'}</td>`).join('')}<td class="total-col">${fmt(total)}</td><td class="avg-col">${fmt(avg)}</td>`;
    tbody.appendChild(tr);
  });
}
document.getElementById('yearlyYear').addEventListener('change', renderYearly);

function renderCashflow() {
  const year = parseInt(document.getElementById('cashflowYear').value);
  if (!year) return;

  const yearTx = transactions.filter(t => { const d = toDate(t.selectedDate); return d && d.getFullYear() === year; });

  const monthInc = Array(12).fill(0);
  const monthExp = Array(12).fill(0);
  yearTx.forEach(t => {
    const d = toDate(t.selectedDate);
    if (!d) return;
    const mo = d.getMonth();
    if (t.type === 'income')  monthInc[mo] += t.amount;
    if (t.type === 'expense') monthExp[mo] += t.amount;
  });

  const hasData = monthInc.some(v=>v>0) || monthExp.some(v=>v>0);
  if (!hasData) {
    document.getElementById('cashflowBody').innerHTML =
      `<tr><td colspan="5" class="empty">No data for ${year}</td></tr>`;
    return;
  }

  const yearStart = new Date(year, 0, 1);
  const priorNet = transactions.reduce((sum, t) => {
    const d = toDate(t.selectedDate);
    if (d && d < yearStart) {
      return sum + (t.type === 'income' ? t.amount : -t.amount);
    }
    return sum;
  }, 0);
  const openingBalance = startingBalance + priorNet;

  const tbody = document.getElementById('cashflowBody');
  tbody.innerHTML = '';
  let runningBalance = openingBalance;

  const _now = new Date();
  const _curYear = _now.getFullYear();
  const _curMonth = _now.getMonth(); // 0-indexed

  MONTHS.forEach((mo, i) => {
    const inc = monthInc[i];
    const exp = monthExp[i];
    const net = inc - exp;
    const isFuture = year > _curYear || (year === _curYear && i > _curMonth);

    if (!isFuture) runningBalance += net;

    const netClass   = net >= 0 ? 'cf-pos' : 'cf-neg';
    const balClass   = runningBalance >= 0 ? 'cf-pos' : 'cf-neg';
    const netSign    = net >= 0 ? '+' : '';

    const tr = document.createElement('tr');
    tr.className = (inc===0 && exp===0) ? 'cf-empty-row' : '';
    tr.innerHTML = `
      <td style="text-align:left;font-weight:600">${mo} ${year}</td>
      <td class="cf-income">${inc > 0 ? fmt(inc) : '—'}</td>
      <td class="cf-expense">${exp > 0 ? fmt(exp) : '—'}</td>
      <td class="${netClass}">${inc===0&&exp===0 ? '—' : netSign + fmt(net)}</td>
      <td class="total-col ${isFuture ? '' : balClass}">${isFuture ? '—' : fmt(runningBalance)}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('cashflowYear').addEventListener('change', renderCashflow);

const _chartThemeCallbacks = new Map();
const _chartThemeObserver = new MutationObserver(() => {
  _chartThemeCallbacks.forEach(cb => cb());
});
_chartThemeObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});
// Key by the stable wrap-element id (a string), not the transient container
// node. Map.set overwrites the previous entry for the same key, so stale
// references to detached DOM nodes are released automatically on each redraw.
function registerChartThemeCallback(key, cb) {
  _chartThemeCallbacks.set(key, cb);
}

function renderMonthlyLineChart(year, month, txList, type) {
  const wrap = document.getElementById('monthlyLineWrap');
  if (!wrap) return;

  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyTotals = new Array(daysInMonth).fill(0);

  txList.forEach(t => {
    const d = toDate(t.selectedDate);
    if (d && d.getFullYear() === year && d.getMonth() === month - 1) {
      dailyTotals[d.getDate() - 1] += t.amount;
    }
  });

  const hasData = dailyTotals.some(v => v > 0);
  if (!hasData) {
    wrap.innerHTML = '<div class="empty">No daily data for this month</div>';
    return;
  }

  const xLabels = Array.from({length: daysInMonth}, (_, i) => {
    const d = new Date(year, month - 1, i + 1);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  });
  const yValues = dailyTotals;

  const maxVal = Math.max(...yValues);
  const yMin   = -(maxVal * 0.04);
  const yMax   = maxVal * 1.15;

  const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#9A9A9A' : '#9A9A9A';
  const lineColor = isDark ? '#E8E6E1' : '#1c1c1c';
  const bgColor   = isDark ? '#1c1c1c' : '#ffffff';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const typeColor = type === 'income' ? '#0FA974' : '#E84545';

  wrap.innerHTML = '<div style="width:100%;height:100%;min-height:260px;"></div>';
  const container = wrap.firstChild;

  const trace = [{
    x: xLabels,
    y: yValues,
    type: 'scatter',
    mode: 'lines+markers',
    line: { color: lineColor, width: 2.5, shape: 'spline', smoothing: 0.4 },
    marker: {
      color: typeColor,
      size: 6,
      opacity: 0,
      line: { width: 0 },
    },
    selected: { marker: { opacity: 1, size: 8 } },
    hovertemplate: '<b>%{x}</b><br>₹%{y:,.2f}<extra></extra>',
  }];

  const layout = {
    paper_bgcolor: bgColor,
    plot_bgcolor: bgColor,
    margin: { t: 20, b: 48, l: 58, r: 20 },
    autosize: true,
    dragmode: false,       // disables zoom/pan drag
    hovermode: 'closest',  // snap tooltip to nearest point
    hoverlabel: {
      bgcolor: isDark ? '#3a3a3a' : '#1c1c1c',
      bordercolor: 'transparent',
      font: { size: 12, color: '#ffffff', family: 'DM Sans, sans-serif' },
    },
    xaxis: {
      tickfont: { size: 10, color: textColor, family: 'DM Sans, sans-serif' },
      gridcolor: gridColor,
      linecolor: 'transparent',
      tickangle: -35,
      nticks: 8,
      zeroline: false,
      fixedrange: true,    // prevents x-axis zoom
    },
    yaxis: {
      tickfont: { size: 10, color: textColor, family: 'DM Sans, sans-serif' },
      gridcolor: gridColor,
      linecolor: 'transparent',
      zeroline: false,
      tickprefix: '₹',
      range: [yMin, yMax],
      fixedrange: true,    // prevents y-axis zoom
    },
  };

  const config = {
    responsive: true,
    displayModeBar: false,
    scrollZoom: false,     // disables scroll-to-zoom
    doubleClick: false,    // disables double-click reset
    showTips: false,
  };

  Plotly.react(container, trace, layout, config);

  registerChartThemeCallback('monthlyLineWrap', () => {
    const nowDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const nl = nowDark ? '#E8E6E1' : '#1c1c1c';
    const nb = nowDark ? '#1c1c1c' : '#ffffff';
    const ng = nowDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const hl = nowDark ? '#3a3a3a' : '#1c1c1c';
    Plotly.update(container,
      { 'line.color': [nl] },
      { 'paper_bgcolor': nb, 'plot_bgcolor': nb,
        'xaxis.gridcolor': ng, 'yaxis.gridcolor': ng,
        'hoverlabel.bgcolor': hl }
    );
  });
}

function renderPieChart(wrapId, txList, type) {
  const wrap = document.getElementById(wrapId);
  if (!txList.length) {
    wrap.innerHTML=`<div class="empty">No ${type} for this period</div>`;
    return;
  }

  const totals = {};
  const colors = {};
  txList.forEach(t => {
    totals[t.category] = (totals[t.category]||0) + t.amount;
    colors[t.category] = catColorByName(type, t.category);
  });

  const labels = Object.keys(totals);
  const values = Object.values(totals);
  const colorArray = Object.values(colors);
  const pull = labels.map(() => 0.04);
  const n = labels.length;

  const isMobile = window.matchMedia('(max-width: 768px)').matches || 'ontouchstart' in window;

  // Remove any previous hint
  const _prevHint = wrap.previousElementSibling;
  if (_prevHint && _prevHint.classList.contains('pie-mobile-hint')) _prevHint.remove();

  // Use legend layout when: mobile (always) OR many categories on desktop (>7).
  // Outside labels work fine for small counts; beyond that they collide and clip.
  const useLegend = isMobile || n > 7;

  // For outside-label mode show the mobile tap hint; legend is self-explanatory.
  if (isMobile && !useLegend) {
    const hint = document.createElement('p');
    hint.className = 'pie-mobile-hint';
    hint.textContent = 'Tap a slice to see details';
    hint.style.cssText = 'text-align:center;font-size:.8rem;color:var(--text-3);margin:0 0 6px;letter-spacing:.01em;';
    wrap.parentNode.insertBefore(hint, wrap);
  }

  // ── Dynamic height ────────────────────────────────────────────────────────
  // Legend mode: pie gets ~340 px; each horizontal legend row (~3 items wide on
  // desktop, ~2 on mobile) adds ~26 px.  Outside-label mode: scale with n so
  // labels at 12 o'clock and 6 o'clock always have room.
  let minHeight;
  if (useLegend) {
    const itemsPerRow = isMobile ? 2 : 3;
    const legendRows  = Math.ceil(n / itemsPerRow);
    minHeight = Math.max(400, 320 + legendRows * 28 + 40);
  } else {
    // Outside labels: each extra category beyond 4 needs ~20 px more clearance
    minHeight = Math.max(450, 300 + n * 24);
  }

  wrap.innerHTML = `<div style="width:100%;min-height:${minHeight}px;"></div>`;
  const container = wrap.firstChild;

  const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor  = isDark ? '#E8E6E1' : '#2D2D2D';
  const bgColor    = isDark ? '#1c1c1c' : '#ffffff';
  const borderColor= isDark ? '#3a3a3a' : '#ffffff';

  // ── Trace ─────────────────────────────────────────────────────────────────
  const data = [{
    type: 'pie',
    labels,
    values,
    marker: {
      colors: colorArray,
      line: { color: borderColor, width: 2 }
    },
    // Legend mode: show % inside each slice; outside-label mode: label+percent.
    textposition: useLegend ? 'inside' : 'outside',
    textinfo:     useLegend ? 'percent' : 'label+percent',
    pull,
    hole: 0,
    hovertemplate: '<b>%{label}</b><br>₹%{value:,.2f}<br>%{percent}<extra></extra>',
    sort: false,
    insidetextfont: {
      size: 11,
      family: 'DM Sans, sans-serif',
      color: '#ffffff',
    },
    textfont: {
      size: 13,
      family: 'DM Sans, sans-serif',
      color: textColor,
    },
    outsidetextfont: {
      size: 13,
      family: 'DM Sans, sans-serif',
      color: textColor,
    },
  }];

  // ── Margins ───────────────────────────────────────────────────────────────
  // Outside-label mode: scale horizontal margin to the longest label text, and
  // vertical margin to the category count so top/bottom labels never clip.
  let margin;
  if (useLegend) {
    // Bottom margin accommodates the horizontal legend rows.
    const itemsPerRow  = isMobile ? 2 : 3;
    const legendRows   = Math.ceil(n / itemsPerRow);
    const legendHeight = legendRows * 28 + 20;
    margin = { t: 20, b: legendHeight, l: 20, r: 20 };
  } else {
    const maxLabelLen = labels.reduce((m, l) => Math.max(m, l.length), 0);
    const hm = Math.max(120, Math.min(220, maxLabelLen * 7 + 40));
    const vm = Math.max(80,  Math.min(180, n * 10 + 30));
    margin = { t: vm, b: vm, l: hm, r: hm };
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  const layout = {
    showlegend: useLegend,
    ...(useLegend && {
      legend: {
        orientation: 'h',
        x: 0.5,
        xanchor: 'center',
        // Negative y pushes it below the plot area; paper coords go 0→1 top→bottom.
        y: -0.02,
        yanchor: 'top',
        font: { size: 12, family: 'DM Sans, sans-serif', color: textColor },
        bgcolor: 'transparent',
        borderwidth: 0,
        itemclick: 'toggleothers',
        itemdoubleclick: 'toggle',
        tracegroupgap: 4,
      },
    }),
    margin,
    paper_bgcolor: bgColor,
    plot_bgcolor:  bgColor,
    font: { family: 'DM Sans, sans-serif', size: 13, color: textColor },
    autosize: true,
    uniformtext: { minsize: 9, mode: 'hide' },
  };

  const config = {
    responsive: true,
    displayModeBar: false,
  };

  Plotly.react(container, data, layout, config);

  registerChartThemeCallback(wrapId, () => {
    const nowDark      = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTextColor  = nowDark ? '#E8E6E1' : '#2D2D2D';
    const newBgColor    = nowDark ? '#1c1c1c' : '#ffffff';
    const newBorderColor= nowDark ? '#3a3a3a' : '#ffffff';
    Plotly.update(container, {
      'marker.line.color':     newBorderColor,
      'textfont.color':        newTextColor,
      'outsidetextfont.color': newTextColor,
      'insidetextfont.color':  '#ffffff',
    }, {
      'paper_bgcolor':   newBgColor,
      'plot_bgcolor':    newBgColor,
      'font.color':      newTextColor,
      'legend.font.color': newTextColor,
    });
  });
}

registerChartThemeCallback('sparklines', () => renderSparklines());

const DEFAULT_CATEGORIES = {
  expense: [
    { name: 'Food & Dining',     color: '#E84545', budget: null },
    { name: 'Transport',         color: '#f97316', budget: null },
    { name: 'Shopping',          color: '#ec4899', budget: null },
    { name: 'Bills & Utilities', color: '#f59e0b', budget: null },
    { name: 'Entertainment',     color: '#a855f7', budget: null },
    { name: 'Healthcare',        color: '#14b8a6', budget: null },
    { name: 'Education',         color: '#3b82f6', budget: null },
    { name: 'Travel',            color: '#06b6d4', budget: null },
    { name: 'Other Expenses',    color: '#6b7280', budget: null },
  ],
  income: [
    { name: 'Salary',      color: '#0FA974', budget: null },
    { name: 'Freelance',   color: '#3b82f6', budget: null },
    { name: 'Business',    color: '#8b5cf6', budget: null },
    { name: 'Investment',  color: '#06b6d4', budget: null },
    { name: 'Gift',        color: '#ec4899', budget: null },
    { name: 'Other Income',color: '#6366f1', budget: null },
  ],
};

async function migrateLegacyData() {
  const userMeta = await window.getDoc(window.doc(window.db, 'users', uid, 'meta', 'accounts'));
  if (userMeta.exists() && userMeta.data().migrated) return null;

  const legacyCatSnap  = await window.getDoc(window.doc(window.db, 'users', uid, 'settings', 'categories'));
  const legacySettSnap = await window.getDoc(window.doc(window.db, 'users', uid, 'settings', 'general'));
  const legacyTxSnap   = await _once(window.query(window.collection(window.db, 'users', uid, 'transactions')));
  const legacyPendSnap = await _once(window.query(window.collection(window.db, 'users', uid, 'pending')));

  const hasLegacy = legacyCatSnap.exists() || legacyTxSnap.docs.length > 0;
  if (!hasLegacy) {
    await window.setDoc(window.doc(window.db, 'users', uid, 'meta', 'accounts'), { migrated: true });
    return null;
  }

  console.log('[Accounts] Migrating legacy data → "Main Account"');

  const acctRef = window.doc(acctColRef());
  await window.setDoc(acctRef, {
    name: 'Main Account',
    createdAt: window.serverTimestamp(),
    isDefault: true,
  });
  const acctId = acctRef.id;

  const catData = legacyCatSnap.exists()
    ? legacyCatSnap.data()
    : { income: DEFAULT_CATEGORIES.income, expense: DEFAULT_CATEGORIES.expense };
  await window.setDoc(window.doc(window.db, 'users', uid, 'accounts', acctId, 'categories', 'data'), {
    income: catData.income || [],
    expense: catData.expense || [],
    migratedAt: window.serverTimestamp(),
  });

  if (legacySettSnap.exists()) {
    await window.setDoc(window.doc(window.db, 'users', uid, 'accounts', acctId, 'settings', 'general'), {
      ...legacySettSnap.data(),
      migratedAt: window.serverTimestamp(),
    });
  }

  const BATCH_SIZE = 500;
  const txDocs = legacyTxSnap.docs;
  for (let i = 0; i < txDocs.length; i += BATCH_SIZE) {
    const batch = window.writeBatch(window.db);
    txDocs.slice(i, i + BATCH_SIZE).forEach(d => {
      const newRef = window.doc(window.db, 'users', uid, 'accounts', acctId, 'transactions', d.id);
      batch.set(newRef, { ...d.data(), migratedAt: window.serverTimestamp() });
    });
    await batch.commit();
  }

  if (legacyPendSnap.docs.length) {
    const batch = window.writeBatch(window.db);
    legacyPendSnap.docs.forEach(d => {
      const newRef = window.doc(window.db, 'users', uid, 'accounts', acctId, 'pending', d.id);
      batch.set(newRef, d.data());
    });
    await batch.commit();
  }

  await window.setDoc(window.doc(window.db, 'users', uid, 'meta', 'accounts'), {
    migrated: true,
    mainAccountId: acctId,
    migratedAt: window.serverTimestamp(),
  });

  console.log('[Accounts] Migration complete, accountId =', acctId);
  return acctId;
}

async function initAccounts() {
  const migratedId = await migrateLegacyData();

  const snap = await _once(acctColRef());
  accounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const saved = localStorage.getItem('activeAccountId_' + uid);
  let chosen = accounts.find(a => a.id === saved) || accounts[0];

  if (!chosen) {
    const newId = await promptCreateFirstAccount();
    // Re-fetch accounts, but also build a fallback object from newId in case
    // the Firestore snapshot hasn't propagated to the client yet.
    const newSnap = await _once(acctColRef());
    accounts = newSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    chosen = accounts.find(a => a.id === newId)
          || accounts[0]
          || { id: newId, name: 'Main Account' }; // safe fallback
  }

  activeAccountId = chosen.id;
  localStorage.setItem('activeAccountId_' + uid, activeAccountId);
  updateAccountBadge();

  // Start real-time listener so accounts added/renamed/deleted on any
  // device or tab are reflected immediately without a page reload.
  listenAccounts();
}

function listenAccounts() {
  if (_unsubAccounts) { _unsubAccounts(); _unsubAccounts = null; }

  _unsubAccounts = window.onSnapshot(acctColRef(), snap => {
    const updated = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    accounts = updated;

    // Keep the badge / sidebar name current for renames.
    updateAccountBadge();

    // If the account switcher panel is currently open, refresh its list
    // so the user sees changes without closing and reopening.
    const switcherBg = document.getElementById('acctSwitcherBg');
    if (switcherBg && switcherBg.classList.contains('open')) {
      renderAccountList();
    }

    // If our active account was deleted from another device, auto-switch
    // to the first remaining account so the app does not break.
    if (activeAccountId && !accounts.find(a => a.id === activeAccountId)) {
      const fallback = accounts[0];
      if (fallback) switchAccount(fallback.id);
    }
  });
}

function promptCreateFirstAccount() {
  return new Promise(resolve => {
    const modal = document.getElementById('firstAccountModal');
    const input = document.getElementById('firstAccountNameInput');
    const btn   = document.getElementById('firstAccountSaveBtn');
    if (!modal) { resolve(_createAccount('Main Account')); return; }
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    input.value = '';
    setTimeout(() => input.focus(), 300);

    async function save() {
      const name = input.value.trim() || 'Main Account';
      btn.disabled = true;
      btn.textContent = 'Creating…';
      const id = await _createAccount(name);
      modal.classList.remove('open');
      document.body.style.overflow = '';
      resolve(id);
    }
    btn.onclick = save;
    input.onkeydown = e => { if (e.key === 'Enter') save(); };
  });
}

async function _createAccount(name) {
  const ref = window.doc(acctColRef());
  await window.setDoc(ref, { name, createdAt: window.serverTimestamp() });
  await window.setDoc(window.doc(window.db, 'users', uid, 'accounts', ref.id, 'categories', 'data'), {
    income: DEFAULT_CATEGORIES.income.map(c => ({ ...c })),
    expense: DEFAULT_CATEGORIES.expense.map(c => ({ ...c })),
  });
  return ref.id;
}

async function switchAccount(id) {
  if (id === activeAccountId) return;

  const container = document.querySelector('.container');
  if (container) {
    container.style.transition = 'opacity .18s ease';
    container.style.opacity = '0';
  }
  await new Promise(r => setTimeout(r, 180));

  if (_unsubTransactions) { _unsubTransactions(); _unsubTransactions = null; }
  if (_unsubPending)      { _unsubPending(); _unsubPending = null; }

  transactions   = [];
  pendingAmounts = [];
  categories     = { income: [], expense: [] };
  startingBalance = 0;
  isFirstLoad    = true;
  window._allDataLoaded = false;

  activeAccountId = id;
  localStorage.setItem('activeAccountId_' + uid, id);
  updateAccountBadge();

  window._dataLoaded = { categories: false, settings: false, transactions: false, pending: false };

  renderTxList();
  renderStats();

  const _origCheck = window._checkAllDataLoaded;
  window._checkAllDataLoaded = function() {
    _origCheck && _origCheck();
    if (window._allDataLoaded && container) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        container.style.transition = 'opacity .3s ease';
        container.style.opacity = '1';
      }));
      window._checkAllDataLoaded = _origCheck;
    }
  };

  await loadCategories();
  await loadSettings();
  listenPending();
  listenTransactions();
}

function updateAccountBadge() {
  const acct = accounts.find(a => a.id === activeAccountId);
  const name = acct ? acct.name : '—';
  document.querySelectorAll('.active-account-name').forEach(el => {
    el.textContent = name;
  });
  const pill = document.getElementById('acctGreetingPill');
  if (pill) {
    pill.textContent = name;
    pill.style.opacity = name && name !== '—' ? '1' : '0';
  }
  if (window._recalcSidebarWidth) window._recalcSidebarWidth();
}

function wireAccountSwitcher() {
  const bg    = document.getElementById('acctSwitcherBg');
  const panel = document.getElementById('acctSwitcherPanel');
  if (!bg || !panel) return;

  function openSwitcher() {
    renderAccountList();
    bg.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeSwitcher() {
    bg.classList.remove('open');
    document.body.style.overflow = '';
  }
  window.openAccountSwitcher  = openSwitcher;
  window.closeAccountSwitcher = closeSwitcher;

  bg.addEventListener('click', e => { if (e.target === bg) closeSwitcher(); });
  document.getElementById('acctSwitcherCloseBtn')?.addEventListener('click', closeSwitcher);
  wireBottomSheetDrag(panel, closeSwitcher);

  document.getElementById('btnChangeAccount')?.addEventListener('click', () => {
    closeSidebarIfOpen();
    openSwitcher();
  });

  document.getElementById('btnChangeAccountMobile')?.addEventListener('click', () => {
    document.getElementById('settingsDrawer')?.classList.remove('open');
    document.getElementById('settingsBackdrop')?.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(openSwitcher, 180);
  });

  document.getElementById('acctSwitcherAddBtn')?.addEventListener('click', () => {
    closeSwitcher();
    setTimeout(openNewAccountModal, 180);
  });
}

function closeSidebarIfOpen() {
  const sb = document.getElementById('sidebar');
  if (sb && !sb.classList.contains('collapsed')) {
    sb.classList.add('collapsed');
    document.body.classList.remove('sidebar-expanded');
  }
}

function renderAccountList() {
  const list = document.getElementById('acctSwitcherList');
  if (!list) return;
  list.innerHTML = '';
  accounts.forEach(acct => {
    const isActive = acct.id === activeAccountId;
    const div = document.createElement('div');
    div.className = 'acct-switcher-item' + (isActive ? ' active' : '');
    div.innerHTML = `
      <span class="acct-switcher-check">${isActive ? '✓' : ''}</span>
      <span class="acct-switcher-name">${esc(acct.name)}</span>
      <div class="acct-switcher-actions">
        <button class="btn-sm" onclick="openRenameAccount('${acct.id}','${esc(acct.name).replace(/'/g,"\\'")}')">Rename</button>
        ${accounts.length > 1 ? `<button class="btn-sm del" onclick="confirmDeleteAccount('${acct.id}')">Delete</button>` : ''}
      </div>
    `;
    if (!isActive) {
      div.style.cursor = 'pointer';
      div.addEventListener('click', async e => {
        if (e.target.closest('.acct-switcher-actions')) return;
        window.closeAccountSwitcher();
        const acctList = await _once(acctColRef());
        accounts = acctList.docs.map(d => ({ id: d.id, ...d.data() }));
        await switchAccount(acct.id);
      });
    }
    list.appendChild(div);
  });
}

function openNewAccountModal() {
  const modal = document.getElementById('newAccountModal');
  const input = document.getElementById('newAccountNameInput');
  const btn   = document.getElementById('newAccountSaveBtn');
  if (!modal) return;
  input.value = '';
  document.getElementById('newAccountErr').textContent = '';
  btn.disabled = false;
  btn.textContent = 'Create Account';
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => input.focus(), 300);
}
window.openNewAccountModal = openNewAccountModal;

function closeNewAccountModal() {
  document.getElementById('newAccountModal')?.classList.remove('open');
  document.body.style.overflow = '';
}
window.closeNewAccountModal = closeNewAccountModal;

document.getElementById('newAccountSaveBtn')?.addEventListener('click', async () => {
  const input = document.getElementById('newAccountNameInput');
  const errEl = document.getElementById('newAccountErr');
  const btn   = document.getElementById('newAccountSaveBtn');
  const name  = input.value.trim();
  if (!name) { errEl.textContent = 'Please enter an account name.'; return; }
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Creating…';
  const newId = await _createAccount(name);
  const snap = await _once(acctColRef());
  accounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  closeNewAccountModal();
  await switchAccount(newId);
});

document.getElementById('newAccountNameInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('newAccountSaveBtn')?.click();
});

document.getElementById('newAccountModal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('newAccountModal')) closeNewAccountModal();
});

window.openRenameAccount = function(id, currentName) {
  window.closeAccountSwitcher();
  const modal = document.getElementById('renameAccountModal');
  const input = document.getElementById('renameAccountInput');
  const btn   = document.getElementById('renameAccountSaveBtn');
  if (!modal) return;
  input.value = currentName;
  document.getElementById('renameAccountErr').textContent = '';
  btn.disabled = false;
  btn.textContent = 'Save';
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => { input.focus(); input.select(); }, 300);

  btn.onclick = async () => {
    const name = input.value.trim();
    if (!name) { document.getElementById('renameAccountErr').textContent = 'Enter a name.'; return; }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    await window.setDoc(acctDocRef(id), { name }, { merge: true });
    const snap = await _once(acctColRef());
    accounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateAccountBadge();
    closeRenameAccountModal();
    setTimeout(() => window.openAccountSwitcher(), 180);
  };

  input.onkeydown = e => { if (e.key === 'Enter') btn.click(); };
  modal.onclick = e => { if (e.target === modal) closeRenameAccountModal(); };
};

function closeRenameAccountModal() {
  document.getElementById('renameAccountModal')?.classList.remove('open');
  document.body.style.overflow = '';
}
window.closeRenameAccountModal = closeRenameAccountModal;

window.confirmDeleteAccount = function(id) {
  if (accounts.length <= 1) { alert('You must have at least one account.'); return; }
  const acct = accounts.find(a => a.id === id);
  const name = acct ? acct.name : 'this account';
  if (!confirm(`Delete "${name}"?\n\nAll transactions and categories in this account will be permanently deleted. This cannot be undone.`)) return;
  _deleteAccount(id);
};

async function _deleteAccount(id) {
  if (id === activeAccountId) {
    const other = accounts.find(a => a.id !== id);
    if (other) await switchAccount(other.id);
  }

  const subColNames = ['transactions', 'pending'];
  for (const col of subColNames) {
    const q = window.query(window.collection(window.db, 'users', uid, 'accounts', id, col));
    const snap = await _once(q);
    const BATCH = 500;
    for (let i = 0; i < snap.docs.length; i += BATCH) {
      const batch = window.writeBatch(window.db);
      snap.docs.slice(i, i + BATCH).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  }
  await window.deleteDoc(acctDocRef(id));

  const snap = await _once(acctColRef());
  accounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  updateAccountBadge();
  window.openAccountSwitcher();
}