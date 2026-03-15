// app.js — Finance Tracker

// ─── State ───────────────────────────────────────────────────────────────────
let uid             = null;
let transactions    = [];
let prevTransactionIds = new Set();
let isFirstLoad = true;
let pendingAmounts  = [];
let categories      = { income: [], expense: [] };
let startingBalance = 0;
let editTxId        = null;
// ── Pending-sync pill tracking ────────────────────────────────────────────────
let _pendingTxIds    = new Set();   // IDs currently hasPendingWrites
let _justSyncedIds   = new Set();   // IDs that just confirmed — show green briefly
const _syncTimers    = {};          // cleanup timers per txId
let activeView      = 'dashboard';

// ── Desktop Sidebar toggle ────────────────────────────────────────────────────
(function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle  = document.getElementById('sidebarToggle');
  if (!sidebar || !toggle) return;

  toggle.addEventListener('click', () => {
    const isCollapsed = sidebar.classList.contains('collapsed');
    if (isCollapsed) {
      sidebar.classList.remove('collapsed');
      document.body.classList.add('sidebar-expanded');
    } else {
      sidebar.classList.add('collapsed');
      document.body.classList.remove('sidebar-expanded');
    }
  });
})();
let activePeriod    = 'daily';
let monthlyType     = 'expense';
let yearlyType      = 'expense';

// Set to true only when all four data sources are confirmed loaded.
// renderStats() is gated on this so stat cards never flash ₹0.
window._allDataLoaded = false;

// ── Undo-delete state ─────────────────────────────────────────────────────────
let _undoPendingId   = null;   // ID currently held back from Firestore delete
let _undoTimer       = null;   // 4s countdown before hard-delete fires
let _undoTxSnapshot  = null;   // snapshot of deleted tx data (for re-adds if needed)

// ─── Init ────────────────────────────────────────────────────────────────────
function hideLoader() {
  const l = document.getElementById('pageLoader');
  if (l) { l.style.opacity = '0'; setTimeout(() => l.remove(), 300); }
}

// ── Undo snackbar engine ──────────────────────────────────────────────────────
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
    // Reset progress animation by toggling class
    this._el.classList.remove('show');
    void this._el.offsetWidth; // reflow to restart animation
    this._msg.textContent = msg;
    this._el.classList.add('show');
  },

  hide() {
    this._init();
    if (!this._el) return;
    this._el.classList.remove('show');
  }
};

window.firebaseReady.then(() => {
  window.onAuthStateChanged(window.auth, async user => {
    if (!user) return;
    uid = user.uid;
    isFirstLoad = true; // reset per session so animations fire correctly on re-login
    window._allDataLoaded = false; // reset so stat cards show skeleton on re-login
    
    // Track what data needs to load before hiding loader
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
        // Unlock renderStats so it can now write real values
        window._allDataLoaded = true;
        // Trigger the skeleton → value fade-in on stat cards with correct data
        renderStats();
        // Ensure tx list also reflects the final server data
        renderTxList();
        // Delay loader hide slightly so the fade-in animation has started
        // before the loader clears, giving a seamless hand-off
        setTimeout(hideLoader, 300);
      }
    };

    // Account info
    document.getElementById('acctEmail').textContent = user.email || '—';

    // Profile panel — populate avatar, name, email
    (function populateProfile() {
      const photo = user.photoURL;
      const email = user.email || '';
      const savedName = localStorage.getItem('profileName_' + user.uid) || '';
      const displayName = savedName || user.displayName || '';
      const initials = (displayName || email).replace(/[@+].*/, '').slice(0, 2).toUpperCase() || '?';

      // Settings drawer avatar
      const panelImg = document.getElementById('profilePanelImg');
      const panelIni = document.getElementById('profilePanelInitials');
      if (photo) { panelImg.src = photo; panelImg.style.display = ''; panelIni.style.display = 'none'; }
      else { panelIni.textContent = initials; panelIni.style.display = ''; panelImg.style.display = 'none'; }

      // Settings drawer name/email
      document.getElementById('profilePanelName').textContent = displayName || email.split('@')[0];
      document.getElementById('profilePanelEmail').textContent = email;
      document.getElementById('profileNameInput').value = displayName;

      // Dashboard greeting bar avatar
      const dashImg = document.getElementById('dashAvatarImg');
      const dashIni = document.getElementById('dashAvatarInitials');
      if (dashImg && dashIni) {
        if (photo) { dashImg.src = photo; dashImg.style.display = ''; dashIni.style.display = 'none'; }
        else { dashIni.textContent = initials; dashIni.style.display = ''; dashImg.style.display = 'none'; }
      }
    })();

    // Personalised greeting
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
      // Old combined greeting (hidden on mobile, kept for any desktop use)
      _greetEl.textContent = _tod;
      // New split greeting bar
      const _nameEl = document.getElementById('dashGreetingName');
      if (_nameEl) _nameEl.textContent = _name || 'there';
    }
    const ts = user.metadata.creationTime;
    if (ts) document.getElementById('acctJoined').textContent =
      new Date(ts).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

    // Default dates
    const today = new Date();
    document.getElementById('txDate').valueAsDate  = today;
    document.getElementById('dailyDate').value     = toInputDate(today);
    initMonthDropdown(today);
    document.getElementById('yearlyYear').value    = today.getFullYear();
    document.getElementById('cashflowYear').value  = today.getFullYear();

    await loadCategories();
    await loadSettings();
    listenPending();
    listenTransactions();
    wireSettingsDrawer();
    wireAddTxForm();
    wireAddPending();
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

// ─── Drag-to-close for mobile bottom sheets ───────────────────────────────────
// Injects a visual drag pill and wires touch events.
// Closes when dragged down > 80px; snaps back otherwise.
// Only active on mobile (≤599px).
function wireBottomSheetDrag(panel, closeFn) {
  if (!panel) return;

  // Inject drag handle pill as first child (hidden on desktop via CSS)
  const handle = document.createElement("div");
  handle.className = "drag-handle";
  panel.insertBefore(handle, panel.firstChild);

  let startY = 0;
  let lastY  = 0;
  let dragging = false;

  panel.addEventListener("touchstart", function(e) {
    if (window.innerWidth >= 600) return;
    startY   = e.touches[0].clientY;
    lastY    = startY;
    dragging = false;
  }, { passive: true });

  panel.addEventListener("touchmove", function(e) {
    if (window.innerWidth >= 600) return;
    lastY = e.touches[0].clientY;
    var dy = lastY - startY;
    // Only start drag when swiping down AND panel is scrolled to top
    if (!dragging && dy > 8 && panel.scrollTop <= 0) {
      dragging = true;
    }
    if (!dragging) return;
    var offset = Math.max(0, dy);
    panel.style.transition = "none";
    panel.style.transform  = "translateY(" + offset + "px)";
  }, { passive: true });

  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    var dy = lastY - startY;
    panel.style.transition = "";
    panel.style.transform  = "";
    if (dy > 80) closeFn();
  }

  panel.addEventListener("touchend",    onDragEnd);
  panel.addEventListener("touchcancel", function() {
    dragging = false;
    panel.style.transition = "";
    panel.style.transform  = "";
  });
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// Initialize month dropdown
function initMonthDropdown(currentDate, txList) {
  const select = document.getElementById('monthlyDate');
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  // Preserve currently selected value so we don't lose the user's position on refresh
  const prevSelected = select.value;

  // Find the earliest year across all transactions; fall back to currentYear - 2
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

  // Restore previous selection if it still exists, otherwise default to current month
  if (prevSelected && select.querySelector(`option[value="${prevSelected}"]`)) {
    select.value = prevSelected;
  } else {
    const defaultVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    select.value = defaultVal;
  }
}



// ─── Settings Drawer ─────────────────────────────────────────────────────────
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

  // Mobile bottom nav settings button
  const bnSettingsBtn = document.getElementById('bnSettings');
  if (bnSettingsBtn) {
    bnSettingsBtn.addEventListener('click', () => {
      // Mark active visually
      ['bnDash','bnAnalytics','bnTransactions','bnSettings'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      bnSettingsBtn.classList.add('active');
      openDrawer();
    });
  }

  // When drawer closes, restore nav active state
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

  // Drag-to-close on mobile (pill + swipe-down, same as other bottom sheets)
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
          if (!d) return; // skip transactions with no date rather than crashing
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


  // Name save
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
      // Also update dashboard greeting bar avatar initials
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

  // ── Sign-out toast ───────────────────────────────────────────────────────────
  const _signOutToast      = document.getElementById('signOutToast');
  const _signOutConfirmBtn = document.getElementById('signOutConfirmBtn');
  const _signOutCancelBtn  = document.getElementById('signOutCancelBtn');
  let _signOutTimer = null;

  function _showSignOutToast() {
    if (_signOutTimer) { clearTimeout(_signOutTimer); _signOutTimer = null; }
    _signOut_hideUndo(); // hide undo snackbar if visible
    _signOutToast.classList.add('show');
    // Auto-dismiss after 6s if no action
    _signOutTimer = setTimeout(_hideSignOutToast, 6000);
  }

  function _hideSignOutToast() {
    _signOutToast.classList.remove('show');
    if (_signOutTimer) { clearTimeout(_signOutTimer); _signOutTimer = null; }
  }

  function _signOut_hideUndo() {
    const undo = document.getElementById('undoSnackbar');
    if (undo) undo.classList.remove('show');
  }

  _signOutCancelBtn.addEventListener('click', _hideSignOutToast);

  _signOutConfirmBtn.addEventListener('click', async () => {
    _hideSignOutToast();
    // Reset delete-confirmation preference on every sign-out so it defaults to asking again on next login
    localStorage.removeItem('skipDeleteConfirm');
    await window.fbSignOut(window.auth).catch(console.error);
    window.location.replace('login.html');
  });

  btnCats.addEventListener('click', () => { closeDrawer(); openCatsModal(); });

  // ── Change Password ──────────────────────────────────────────────────────────
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
    // Reset all states
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

    // Detect Google-only user
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

  // Show/hide password toggle buttons
  document.querySelectorAll('.pwd-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.target);
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      btn.classList.toggle('active', inp.type === 'text');
    });
  });

  // Password strength meter
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

  // Submit change password
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

        // Success
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

    // Allow Enter key in confirm field to submit
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

// ─── View switching ──────────────────────────────────────────────────────────
window.showView = function(v) {
  activeView = v;

  // Close settings drawer if open (e.g. user tapped another nav tab)
  const _drawer   = document.getElementById('settingsDrawer');
  const _backdrop = document.getElementById('settingsBackdrop');
  if (_drawer && _drawer.classList.contains('open')) {
    _drawer.classList.remove('open');
    _backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  // Close add tx sheet if open
  if (window.closeAddTxSheet) window.closeAddTxSheet();

  // Close pending sheet if open
  if (window.closePendingSheet) window.closePendingSheet();

  // Close categories modal if open
  const _catsBg = document.getElementById('catsModalBg');
  if (_catsBg && _catsBg.classList.contains('open')) {
    window.closeCatsModal();
  }

  // Close transaction detail panel if open
  const _txBg = document.getElementById('txDetailBg');
  if (_txBg && _txBg.classList.contains('open')) {
    window.closeTxDetail && window.closeTxDetail();
  }

  document.getElementById('viewDashboard').classList.toggle('hidden', v !== 'dashboard');
  document.getElementById('viewAnalytics').classList.toggle('hidden', v !== 'analytics');
  document.getElementById('viewTransactions').classList.toggle('hidden', v !== 'transactions');
  // Sync bottom nav
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
  // Sync sidebar active state
  ['sidebarDash','sidebarAnalytics','sidebarTransactions'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const sidebarMap = { dashboard: 'sidebarDash', analytics: 'sidebarAnalytics', transactions: 'sidebarTransactions' };
  if (sidebarMap[v]) { const el = document.getElementById(sidebarMap[v]); if (el) el.classList.add('active'); }
};

// ─── Period switching ─────────────────────────────────────────────────────────
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


// ─── Monthly/Yearly Type Toggle ──────────────────────────────────────────────
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

// ─── Categories ──────────────────────────────────────────────────────────────
async function loadCategories() {
  const snap = await window.getDoc(window.doc(window.db, 'users', uid, 'settings', 'categories'));
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

// Trigger animations for new transactions
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
    window.doc(window.db, 'users', uid, 'settings', 'categories'),
    { income: categories.income, expense: categories.expense, updatedAt: window.serverTimestamp() }
  );
}

// ─── General Settings ────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const snap = await window.getDoc(window.doc(window.db, 'users', uid, 'settings', 'general'));
    if (snap.exists()) startingBalance = Number(snap.data().startingBalance) || 0;
    const inp = document.getElementById('startingBalanceInput');
    if (inp) inp.value = startingBalance > 0 ? startingBalance : '';
  } catch(e) { console.error('loadSettings', e); }
  if (window._dataLoaded) { window._dataLoaded.settings = true; window._checkAllDataLoaded(); }
}

async function saveSettings() {
  await window.setDoc(
    window.doc(window.db, 'users', uid, 'settings', 'general'),
    { startingBalance, updatedAt: window.serverTimestamp() }
  );
}

// ─── Category helpers ─────────────────────────────────────────────────────────
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

// Expense first, then Income — per user request
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


// ─── Quick Category Pills ─────────────────────────────────────────────────────
// Shows the 3 most-used expense categories as fast-tap pills on the desktop
// Add Transaction card. Falls back to the first 3 expense categories if there
// are not enough transactions yet.
function renderQuickCats() {
  const el = document.getElementById('quickCats');
  if (!el) return;
  el.style.cursor = 'pointer';

  // Count usage per expense category from all transactions
  const counts = {};
  transactions.forEach(tx => {
    if (tx.type === 'expense') counts[tx.category] = (counts[tx.category] || 0) + 1;
  });

  // Rank expense categories; fall back to first 3 if not enough data
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

  // Clicking the pills area itself (but not a pill) → open sheet with no pre-selection
  el.addEventListener('click', e => {
    if (!e.target.closest('.quick-cat-pill')) {
      e.stopPropagation();
      window.openAddTxSheet && window.openAddTxSheet();
    }
  });

  // Wire pill clicks — open sheet with that category pre-selected
  el.querySelectorAll('.quick-cat-pill').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const selectedCat = btn.dataset.cat;
      window.openAddTxSheet && window.openAddTxSheet();
      // Pre-select category after sheet opens (DOM must be visible first)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const sel = document.getElementById('txCategory');
          if (sel) sel.value = selectedCat;
          // Focus the amount field so the user can type immediately
          const amt = document.getElementById('txAmount');
          if (amt) amt.focus();
        });
      });
    });
  });
}
// ─── Categories Modal ────────────────────────────────────────────────────────
window.openCatsModal = function() {
  renderCatLists();
  document.getElementById('catsModalBg').classList.add('open');
  document.body.style.overflow = 'hidden';
  // Hide navbar so modal is the only interactive layer
  const nav = document.getElementById('bottomNav');
  if (nav) nav.style.display = 'none';
};
// drag-to-close on mobile (wired once)
(function() {
  var panel = document.querySelector('#catsModalBg .modal');
  if (panel && !panel._dragWired) {
    panel._dragWired = true;
    wireBottomSheetDrag(panel, function() { window.closeCatsModal(); });
  }
})();
window.closeCatsModal = function() {
  document.getElementById('catsModalBg').classList.remove('open');
  document.body.style.overflow = '';
  // Restore navbar
  const nav = document.getElementById('bottomNav');
  if (nav) nav.style.display = '';
  // Re-sync bottom nav highlight to whichever view is actually on screen
  const bnMap = { dashboard: 'bnDash', analytics: 'bnAnalytics', transactions: 'bnTransactions' };
  ['bnDash','bnAnalytics','bnTransactions','bnSettings'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const activeEl = document.getElementById(bnMap[activeView] || 'bnDash');
  if (activeEl) activeEl.classList.add('active');
  populateCategoryDropdowns();
  saveCategories().catch(e => console.error('auto-save categories failed:', e));
};

// ─── CSV Import ──────────────────────────────────────────────────────────────
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

  // expose for settings button
  window.openImportModal  = openImport;
  window.closeImportModal = closeImport;

  // drag-to-close on mobile
  wireBottomSheetDrag(document.getElementById("importPanel"), closeImport);

  closeBtn.addEventListener('click', closeImport);
  cancelBtn.addEventListener('click', closeImport);

  // close on backdrop click (not panel click)
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

    // Firestore batches are capped at 500 ops each.
    // All docs in a batch commit atomically — if the tab closes mid-import
    // only whole batches are lost, never individual rows from a batch.
    const BATCH_SIZE = 500;
    let ok = 0, fail = 0, errs = [];

    for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
      const chunk = rows.slice(batchStart, batchStart + BATCH_SIZE);
      const batch = window.writeBatch(window.db);
      chunk.forEach(r => {
        const ref = window.doc(window.collection(window.db, 'users', uid, 'transactions'));
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
      // Yield between batches to keep UI responsive
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
    // Format: MM/DD/YYYY
    const month = parseInt(dateParts[0]), day = parseInt(dateParts[1]), year = parseInt(dateParts[2]);
    if (isNaN(month)||isNaN(day)||isNaN(year)) continue;
    if (month<1||month>12||day<1||day>31) continue;
    results.push({ date: dateStr, type, category, amount, description: description||'',
      dateObj: new Date(year, month-1, day, 12, 0, 0) });
  }
  return results;
}
window.addCat = async function(type) {
  const nameEl  = document.getElementById(type === 'income' ? 'newIncName'  : 'newExpName');
  const colorEl = document.getElementById(type === 'income' ? 'newIncColor' : 'newExpColor');
  const name = nameEl.value.trim();
  if (!name) { alert('Enter a category name'); return; }
  
  const newCat = { name, color: colorEl.value, budget: null };
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
  // Toggle off if already showing
  const existing = btn.parentNode.querySelector('.tx-confirm-row');
  if (existing) { existing.remove(); btn.style.display = ''; return; }
  // Close any others
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
window.syncSwatch = function(inputId, swatchId) {
  document.getElementById(swatchId).style.background = document.getElementById(inputId).value;
};
window.updateCatColor = async function(type, name, color) {
  const idx = categories[type].findIndex(c => catName(c) === name);
  if (idx === -1) return;
  if (typeof categories[type][idx] === 'string') categories[type][idx] = { name: categories[type][idx], color };
  else categories[type][idx].color = color;
  const listEl = document.getElementById(type === 'income' ? 'incomeList' : 'expenseList');
  const item = listEl.querySelector(`[data-cat-name="${CSS.escape(name)}"] .cat-color-swatch`);
  if (item) item.style.background = color;
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
      const color = catColor(c);
      const name  = catName(c);
      const budget = typeof c === 'object' ? c.budget : null;
      const div = document.createElement('div');
      div.className = 'cat-item';
      div.dataset.catName = name;

      const safeName = name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const budgetInput = type === 'expense'
        ? `<input type="number" value="${budget || ''}" placeholder="Budget" class="cat-budget-input" min="0" step="0.01" onchange="updateCatBudget('${type}','${safeName}',this.value)">`
        : '';

      div.innerHTML = `
        <div class="cat-color-wrap" title="Click to change color">
          <input type="color" value="${color}" onchange="updateCatColor('${type}','${safeName}',this.value)">
          <span class="cat-color-swatch" style="background:${color}"></span>
        </div>
        <div class="cat-info">
          <span class="cat-name">${esc(name)}</span>
          ${budgetInput}
        </div>
        <button class="btn-sm del" onclick="showCatDeleteConfirm(this,'${type}','${safeName}')">Remove</button>
      `;
      el.appendChild(div);
    });
  });
}

// ─── Transactions ─────────────────────────────────────────────────────────────
function listenTransactions() {
  const q = window.query(
    window.collection(window.db, 'users', uid, 'transactions'),
    window.orderBy('selectedDate', 'desc')
  );
  let firstLoad = true;
  window.onSnapshot(q, snap => {
    // ── Track pending-write transitions for the sync pill ──
    snap.docs.forEach(d => {
      const isPending = d.metadata.hasPendingWrites;
      if (_pendingTxIds.has(d.id) && !isPending) {
        // Just confirmed by server → show "Synced" pill briefly
        _justSyncedIds.add(d.id);
        clearTimeout(_syncTimers[d.id]);
        _syncTimers[d.id] = setTimeout(() => {
          _justSyncedIds.delete(d.id);
          delete _syncTimers[d.id];
        }, 3500); // matches animation hold + fade-out
      }
      if (isPending) _pendingTxIds.add(d.id);
      else           _pendingTxIds.delete(d.id);
    });
    transactions = snap.docs.map(d => ({ id: d.id, ...d.data(), hasPendingWrites: d.metadata.hasPendingWrites }));

    // Rebuild month dropdown only when the set of transaction years/months changes,
    // not on every snapshot tick (e.g. hasPendingWrites flip).
    const _newMonthKey = transactions.map(t => {
      const d = toDate(t.selectedDate); return d ? `${d.getFullYear()}-${d.getMonth()}` : '';
    }).sort().join('|');
    if (_newMonthKey !== (listenTransactions._lastMonthKey || '')) {
      listenTransactions._lastMonthKey = _newMonthKey;
      initMonthDropdown(new Date(), transactions);
    }

    // Track new transactions for render functions
    const currentIds = new Set(transactions.map(t => t.id));
    const newIds = [...currentIds].filter(id => !prevTransactionIds.has(id));
    prevTransactionIds = currentIds;
    
    // Store new IDs for render functions
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
    
    if (firstLoad && window._dataLoaded) {
      firstLoad = false;
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

  // Auto-close timer handle + success-mode flag — used to intercept taps
  // during the 3-second success window and reset to add-another instead of closing
  let _autoCloseTimer = null;
  let _txSuccessMode  = false;

  let _openOverflowTimer = null; // tracks the deferred overflow=hidden

  function openAddTxSheet() {
    bg.classList.add('open');
    if (fab) fab.classList.add('open');
    // Defer overflow=hidden until after the slide-up animation (≈400ms).
    // Setting it synchronously forces a layout recalculation on frame 1
    // of the translateY transition, stealing compositor budget and causing
    // the visible chop on mobile.
    clearTimeout(_openOverflowTimer);
    _openOverflowTimer = setTimeout(() => {
      document.body.style.overflow = 'hidden';
    }, 420);
    // Deactivate all nav tabs while sheet is open
    ['bnDash','bnAnalytics','bnTransactions','bnSettings'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });
  }

  function closeAddTxSheet() {
    // Cancel any pending auto-close and the deferred overflow timer
    clearTimeout(_autoCloseTimer);
    clearTimeout(_openOverflowTimer);
    _autoCloseTimer = null;
    _txSuccessMode  = false;
    bg.classList.remove('open');
    if (fab) fab.classList.remove('open');
    document.body.style.overflow = '';
    // Restore nav tab for active view
    const bnMap = { dashboard: 'bnDash', analytics: 'bnAnalytics', transactions: 'bnTransactions' };
    const activeEl = document.getElementById(bnMap[activeView] || 'bnDash');
    if (activeEl) activeEl.classList.add('active');
  }

  // Resets button/done state so the user can immediately add another transaction.
  // Called when the user explicitly signals "add another" (FAB, backdrop, submit button).
  // Does NOT steal focus on its own — caller decides whether to focus.
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
    // Focus category first — it was cleared after submit, so the correct
    // flow is category → amount → note.  Only focus when the caller wants it
    // (not when the user already tapped a specific field).
    if (shouldFocus) {
      const catField = document.getElementById('txCategory');
      if (catField) setTimeout(() => catField.focus(), 60);
    }
  }

  // Expose so post-submit can close it
  window.openAddTxSheet  = openAddTxSheet;
  window.closeAddTxSheet = closeAddTxSheet;

  // ── Keyboard-lift: scroll focused field into view above keyboard ─────────────
  // Single-pass getBoundingClientRect at 80ms fails for amount→note because
  // Android briefly reports stale layout values during the focus handoff while
  // the keyboard is already open (no visualViewport resize fires to re-trigger).
  // Two-pass fix:
  //   Pass 1 — native scrollIntoView to bring the field into the panel's
  //             scroll container (handles all cases cleanly).
  //   Pass 2 — rAF after pass 1 to measure the real post-keyboard position
  //             and add any remaining offset above the keyboard edge.
  if (window.visualViewport && window.innerWidth < 600) {
    const panel = document.getElementById('addTxSheet');

    function scrollFieldIntoView(field) {
      if (!bg.classList.contains('open')) return;
      // Wait for Android to finish its own focus-scroll attempt before we measure
      setTimeout(() => {
        // For the note field, scroll to the submit button (below note) so both
        // the field AND the button are visible above the keyboard in one scroll.
        const scrollTarget = (field.id === 'txNote')
          ? (document.getElementById('addTxBtn') || field)
          : field;

        // Pass 1: let the browser scroll the panel so the target is in its
        // scroll viewport (doesn't account for on-screen keyboard yet)
        scrollTarget.scrollIntoView({ behavior: 'instant', block: 'nearest' });

        // Pass 2: after pass 1 settles, check if target is still behind the
        // keyboard and push panel scroll by the exact remaining gap
        requestAnimationFrame(() => {
          const vvHeight   = window.visualViewport.height;
          const targetRect = scrollTarget.getBoundingClientRect();
          const PADDING    = 28; // breathing room above keyboard edge
          if (targetRect.bottom > vvHeight - PADDING) {
            panel.scrollTop += targetRect.bottom - (vvHeight - PADDING);
          }
        });
      }, 150); // 150ms lets keyboard + focus animation fully settle on Android
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

    // Wire all four fields — covers both "keyboard just opened" and
    // "keyboard already open, moving between fields" (the amount→note case)
    ['txDate', 'txCategory', 'txAmount', 'txNote'].forEach(fId => {
      const el = document.getElementById(fId);
      if (el) el.addEventListener('focus', () => scrollFieldIntoView(el));
    });
  }

  if (fab) fab.addEventListener('click', () => {
    // Priority 1: close settings drawer if it's open
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
    // Priority 2: close pending sheet if open
    if (window.closePendingSheet && document.getElementById('pendingSheetBg')?.classList.contains('open')) {
      window.closePendingSheet();
    } else if (bg.classList.contains('open')) {
      // If we're in the success window, tap = "add another" not "close"
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
  // Also wire the quickCats container's parent card if it sits outside btnOpenAddTx
  // so the entire card area (header, empty space, pills zone) is always clickable.
  const addTxCard = desktopTrigger ? desktopTrigger.closest('.add-tx-card, .stat-card, [data-card], .card') || desktopTrigger.parentElement : null;
  if (addTxCard && addTxCard !== desktopTrigger) {
    addTxCard.style.cursor = 'pointer';
    addTxCard.addEventListener('click', e => {
      // Don't double-fire if the desktopTrigger itself or a pill already handled it
      if (e.target.closest('.quick-cat-pill')) return;
      if (!document.getElementById('addTxSheetBg')?.classList.contains('open')) openAddTxSheet();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', closeAddTxSheet);
  // Close on any click that lands outside the panel (works on desktop & mobile)
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

  // Drag-to-close on mobile
  wireBottomSheetDrag(document.getElementById('addTxSheet'), function() {
    if (_txSuccessMode) {
      resetToAddForm();
    } else {
      closeAddTxSheet();
    }
  });

  // Cancel auto-close the moment the user touches/clicks anywhere inside the
  // panel during the 3-second success window. Without this, tapping a form
  // field to start the next entry wouldn't clear the timer.
  // shouldFocus=false: whatever the user actually tapped gets its own natural
  // focus — we must not call amtField/catField.focus() here because pointerdown
  // fires BEFORE the element receives focus, so a setTimeout focus would fire
  // 60ms later and yank the caret away from wherever the user tapped.
  document.getElementById('addTxSheet').addEventListener('pointerdown', () => {
    if (_txSuccessMode) resetToAddForm(false);
  });

  document.getElementById('addTxForm').addEventListener('submit', async e => {
    e.preventDefault();

    // If in success window, tapping the button = "add another" — reset the form
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
        window.collection(window.db, 'users', uid, 'transactions'),
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
      // Re-enable so the button is full opacity and tappable (tapping resets to add-another)
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

// Sort helper: selectedDate desc, then createdAt desc for same-day ties
function txSorted(list) {
  return list.slice().sort((a, b) => {
    const da = toDate(a.selectedDate);
    const db = toDate(b.selectedDate);
    // Transactions with no date sort to the bottom
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    const selDiff = db - da;
    if (selDiff !== 0) return selDiff;
    // null createdAt = pending server write (just added) → sort to top
    if (!a.createdAt && !b.createdAt) return 0;
    if (!a.createdAt) return -1;
    if (!b.createdAt) return 1;
    return toDate(b.createdAt) - toDate(a.createdAt);
  });
}


// ── Sync-pill HTML builder + animator ────────────────────────────────────────
function _txPillHtml(txId, hasPending) {
  if (hasPending) {
    return `<span class="tx-queue-wrap" id="tqw-${txId}"><span class="tx-queue-pill tqp-queued" id="tqp-${txId}"><span class="tqp-dot"></span><span class="tqp-text">Queued</span></span></span>`;
  }
  if (_justSyncedIds.has(txId)) {
    return `<span class="tx-queue-wrap" id="tqw-${txId}"><span class="tx-queue-pill tqp-synced" id="tqp-${txId}"><span class="tqp-dot tqp-dot-synced"></span><span class="tqp-text">Synced</span></span></span>`;
  }
  return '';
}
// Triggers the GPU transitions on a pill that was just rendered.
// Call once per tx after the div is appended to the DOM.
function _animateTxPill(txId, hasPending) {
  if (hasPending) {
    // Fade in: snap wrapper open → next rAF → add show class
    const w = document.getElementById(`tqw-${txId}`);
    const p = document.getElementById(`tqp-${txId}`);
    if (!w || !p) return;
    w.classList.add('tqw-show');
    requestAnimationFrame(() => requestAnimationFrame(() => p.classList.add('tqp-show')));
  } else if (_justSyncedIds.has(txId)) {
    // Already visible green — snap wrapper + show, then fade out after hold
    const w = document.getElementById(`tqw-${txId}`);
    const p = document.getElementById(`tqp-${txId}`);
    if (!w || !p) return;
    w.classList.add('tqw-show');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      p.classList.add('tqp-show');
      // Hold 2s, then fade out
      setTimeout(() => {
        p.classList.remove('tqp-show');
        setTimeout(() => w.classList.remove('tqw-show'), 650);
      }, 2000);
    }));
  }
}

function buildTxDiv(tx) {
  const d     = toDate(tx.selectedDate);
  const dateLabel = d
    ? d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
    : 'No date';
  const color = catColorByName(tx.type, tx.category);

  // .tx-row is the height-collapsing wrapper (owns the 10px gap via margin-bottom).
  // data-tx-id lives here so confirmDeleteTx can find and collapse the whole wrapper.
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
    <div class="tx-amount ${tx.type}">${tx.type==='income'?'+':'-'}${fmt(tx.amount)}</div>
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
  // Detach any currently-animating .removing rows before the rebuild wipes them,
  // then re-attach so their CSS transition can finish naturally.
  // They are already height:0 / opacity:0 / pointer-events:none — completely
  // invisible — so position in the list doesn't matter.
  const live = [...el.querySelectorAll('.tx-row.removing')];
  live.forEach(r => r.remove()); // detach (preserves element + inline styles)
  rebuildFn();
  live.forEach(r => el.appendChild(r)); // re-attach at end (invisible, harmless)
}

function renderTxList() {
  const el = document.getElementById('txList');
  let sorted = txSorted(transactions).slice(0, 5);
  // Hide the undo-pending row during the 4-second grace window
  if (_undoPendingId) sorted = sorted.filter(t => t.id !== _undoPendingId);

  if (!sorted.length) {
    el.innerHTML = '<div class="empty">No transactions yet</div>';
    return;
  }

  const isFirstRender = el.children.length === 0 || el.querySelector('.empty') !== null || el.querySelector('.tx-skel') !== null;
  const newIds = window._newTxIds || new Set();

  if (isFirstRender) {
    // First load: cascade fade-in
    el.innerHTML = '';
    sorted.forEach((tx, index) => {
      const div = buildTxDiv(tx);
      div.style.opacity = '0';
      div.style.transition = 'opacity 0.3s ease';
      el.appendChild(div);
      setTimeout(() => { div.style.opacity = '1'; }, 600 + (index * 80));
    });
  } else if (newIds.size > 0) {
    // New transaction(s) added: animate new items sliding in at top
    _preserveRemovingRows(el, () => {
      el.innerHTML = '';
      sorted.forEach(tx => {
        const div = buildTxDiv(tx);
        if (newIds.has(tx.id)) div.classList.add('tx-adding');
        el.appendChild(div);
      });
    });
  } else {
    // Regular update (delete/edit): rebuild without animation
    _preserveRemovingRows(el, () => {
      el.innerHTML = '';
      sorted.forEach(tx => el.appendChild(buildTxDiv(tx)));
    });
  }

  // IDs cleared by snapshot handler after brief window
}

function populateTxCategoryFilter() {
  const sel = document.getElementById('txCategoryFilter');
  if (!sel) return;
  const current = sel.value;
  // Gather all unique categories present in transactions
  const cats = [...new Set(transactions.map(t => t.category).filter(Boolean))].sort();
  // Skip rebuild if the option set hasn't changed
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
  // Restore selection if still valid
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

  // Read filter state
  const searchQ    = (document.getElementById('txSearchInput')?.value || '').trim().toLowerCase();
  const catFilter  = document.getElementById('txCategoryFilter')?.value || '';
  const typeFilter = document.getElementById('txTypeFilter')?.value || '';

  let sorted = txSorted(transactions);
  // Hide undo-pending row during grace window
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

  _preserveRemovingRows(el, () => {
    el.innerHTML = '';
    sorted.forEach(tx => el.appendChild(buildTxDiv(tx)));
  });
}

// ─── Inline delete confirmation ───────────────────────────────────────────────
// Uses pre-rendered .txa-normal / .txa-confirm divs inside .tx-actions.
// Toggle class .confirming on .tx-actions — pure CSS animation, zero DOM churn.

// Helper to show/hide confirm panels via inline style (bypasses SW-cached CSS issues)
function _txConfirmShow(actions) {
  const normal  = actions.querySelector('.txa-normal');
  const confirm = actions.querySelector('.txa-confirm');
  if (!normal || !confirm) return;
  normal.style.display  = 'none';
  confirm.style.display = 'flex';
  // Re-trigger animation
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
  // Scope to the currently visible list to avoid matching the same tx-id
  // in both #txList (dashboard) and #allTxList (transactions tab) simultaneously.
  const activeList = activeView === 'transactions'
    ? document.getElementById('allTxList')
    : document.getElementById('txList');
  const txEl   = activeList ? activeList.querySelector('[data-tx-id="' + id + '"]')
                             : document.querySelector('[data-tx-id="' + id + '"]');
  const actions = txEl ? txEl.querySelector('.tx-actions') : null;
  if (!actions) return;

  // Close any other open confirms
  document.querySelectorAll('.tx-actions.confirming').forEach(a => {
    if (a !== actions) _txConfirmHide(a);
  });

  // Toggle this one
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

// Called by the pre-rendered Yes button in .txa-confirm
window.doConfirmDeleteTx = function(id, btn) {
  const confirm = btn.closest('.txa-confirm');
  const chk = confirm ? confirm.querySelector('.dont-ask-chk') : null;
  if (chk && chk.checked) localStorage.setItem('skipDeleteConfirm', '1');
  window.confirmDeleteTx(id);
};

// Collapses a single .tx-row element out of the list.
// - Searches BOTH lists so the correct visible row is always found.
// - vibrate() fires inside the second rAF so haptic is in sync with the visual.
// - transitionend removes the element from the DOM so no ghost rows linger.
// - Safe to call multiple times on the same id (idempotent via _removingIds guard).
const _removingIds = new Set();
function _animateRowOut(id) {
  if (_removingIds.has(id)) return;

  // Search both lists — both exist in the DOM simultaneously.
  // activeView-only targeting misses rows when the wrong tab is assumed.
  const row = (document.getElementById('txList')    || { querySelector: () => null })
                .querySelector('[data-tx-id="' + id + '"]')
           || (document.getElementById('allTxList') || { querySelector: () => null })
                .querySelector('[data-tx-id="' + id + '"]');
  if (!row) return;

  _removingIds.add(id);

  // Lock the measured height so CSS has a concrete from-value to transition from.
  const h = row.getBoundingClientRect().height;
  row.style.height = h + 'px';
  row.classList.add('removing');

  // Double-rAF: frame 1 commits the locked height to the CSSOM,
  // frame 2 sets the target values and starts the GPU transition.
  // vibrate() lives here so haptic fires the instant the visual starts.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    row.style.height       = '0';
    row.style.marginBottom = '0';
    vibrate();
    // Self-remove after the longest transition (height: 0.32s).
    // 'height' is the property we animate; listening for it avoids
    // double-firing from the inner .tx-item opacity transition.
    row.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName !== 'height') return;
      row.removeEventListener('transitionend', onEnd);
      _removingIds.delete(id);
      row.remove();
    });
    // Safety net: if transitionend never fires (display:none, tab hidden, etc.)
    // clean up after 600ms so ghost rows can't accumulate.
    setTimeout(() => {
      _removingIds.delete(id);
      if (row.parentNode) row.remove();
    }, 600);
  }));
}

window.confirmDeleteTx = async function(id) {
  // If there's already an undo pending for a different tx, hard-delete it now.
  if (_undoPendingId && _undoPendingId !== id) {
    clearTimeout(_undoTimer);
    _undoTimer = null;
    const staleId = _undoPendingId;
    _undoPendingId = null;
    _undoTxSnapshot = null;
    await window.deleteDoc(window.doc(window.db, 'users', uid, 'transactions', staleId)).catch(console.error);
  }

  // Snapshot the tx data before we "delete" it (for undo re-add)
  const tx = transactions.find(t => t.id === id);
  _undoTxSnapshot = tx ? { ...tx } : null;
  _undoPendingId  = id;

  // Kick off the collapse animation immediately.
  _animateRowOut(id);

  // Show snackbar — description first, then category as fallback
  const label = (tx && (tx.description || tx.category)) || 'Transaction';
  _snack.show(`"${label}" deleted`);

  // Start 4-second countdown before actual Firestore delete
  clearTimeout(_undoTimer);
  _undoTimer = setTimeout(async () => {
    _undoTimer = null;
    if (_undoPendingId !== id) return; // already undone or superseded
    _undoPendingId  = null;
    _undoTxSnapshot = null;
    _snack.hide();
    await window.deleteDoc(window.doc(window.db, 'users', uid, 'transactions', id)).catch(console.error);
  }, 4000);
};

// Called by the Undo button in the snackbar
async function _undoDelete() {
  if (!_undoPendingId) return;
  clearTimeout(_undoTimer);
  _undoTimer      = null;
  const id        = _undoPendingId;
  _undoPendingId  = null;
  _undoTxSnapshot = null;
  _snack.hide();
  // The doc still exists in Firestore — just re-render with the filter lifted.
  // Mark the ID so buildTxDiv / renderAllTxList can give it the restore animation.
  window._restoringTxId = id;
  renderTxList();
  if (activeView === 'transactions') renderAllTxList();
  setTimeout(() => { window._restoringTxId = null; }, 500);
}

// ── Transaction Detail Panel ──────────────────────────────────────────────────
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

  // Populate view
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

  // Show view, hide edit
  document.getElementById('txdView').style.display = '';
  document.getElementById('txdEdit').style.display = 'none';

  // Open
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
// drag-to-close on mobile (wired once at startup)
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

// Close on Escape
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

  // Populate edit fields
  document.getElementById('txdEditDate').value = toInputDate(d);
  document.getElementById('txdEditAmount').value = tx.amount;
  document.getElementById('txdEditNote').value = tx.description || '';

  // Populate category dropdown
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
    window.doc(window.db, 'users', uid, 'transactions', _txDetailId),
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
    // Close the detail panel first
    document.getElementById('txDetailBg').classList.remove('open');
    document.body.style.overflow = '';
    _txDetailId = null;
    // Route through undo-aware delete
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

  // Show saving state
  const saveBtn = document.querySelector('#editModalBg .btn-primary');
  const origHtml = saveBtn ? saveBtn.innerHTML : null;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="btn-spinner"></span> Saving…';
  }

  try {
    await window.setDoc(
      window.doc(window.db, 'users', uid, 'transactions', editTxId),
      { type, category, amount, description: note, selectedDate: new Date(dateVal + 'T00:00:00'), updatedAt: window.serverTimestamp() },
      { merge: true }
    );
    vibrate();
    // Show green saved state
    if (saveBtn) {
      saveBtn.innerHTML = '✓ Saved';
      saveBtn.style.background = 'var(--green)';
      saveBtn.style.color = '#fff';
      saveBtn.style.borderColor = 'var(--green)';
    }
    // Auto-close after brief confirmation
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

// ─── Stats (all-time) ─────────────────────────────────────────────────────────
function renderStats() {
  // Don't render until all data sources are confirmed ready.
  // This prevents stat cards from flashing ₹0 on the first (possibly cached/empty) snapshot.
  if (!window._allDataLoaded) return;

  // Update profile tx count
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

  // Check if skeleton spinners are still present (first reveal)
  const hasSpinners = incomeEl && incomeEl.querySelector('.loading-spinner') !== null;
  
  if (hasSpinners) {
    // Fade out spinners, swap in correct values, then fade back in
    elements.forEach(el => {
      el.style.transition = 'opacity 0.2s ease';
      el.style.opacity = '0';
    });
    setTimeout(() => {
      elements.forEach(el => {
        el.innerHTML = valueMap.get(el);
        el.style.opacity = '0'; // ensure we start from invisible
      });
      // Double rAF guarantees the browser has committed the new DOM
      // before starting the opacity transition (avoids instant-snap)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        elements.forEach(el => { el.style.opacity = '1'; });
      }));
    }, 200);
  } else {
    // Subsequent updates (edit/delete/etc.): instant update, no flash
    elements.forEach(el => el.innerHTML = valueMap.get(el));
  }

  // Update cash flow starting balance label
  const cfEl = document.getElementById('cfStartBal');
  if (cfEl) cfEl.textContent = fmt(startingBalance);

  // Highest pending item sub-line
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

// ─── Stat Card Sparklines ─────────────────────────────────────────────────────
// Pure SVG area charts, fully contained inside each card via overflow:hidden.
// No axes, no labels — just the shape of the data over the last 30 days.

// ─── Top Spending Categories ──────────────────────────────────────────────────
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

  // Sum per category
  const totals = {};
  monthExpenses.forEach(t => {
    const cat = t.category || 'Other';
    totals[cat] = (totals[cat] || 0) + t.amount;
  });

  // Sort descending, take top 5
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

  // Daily totals for income or expense over last N days
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

  // Rolling daily balance for last N days
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

  // Use the actual rendered pixel width so viewBox === element size.
  // This means no SVG scaling occurs and stroke-width is always exactly
  // the specified number of CSS pixels — no thinning/thickening on mobile.
  const W = Math.round(svg.getBoundingClientRect().width) || 300;
  const H = 56;
  const PAD_T = 8;   // gap above the peak so the line isn't clipped
  const PAD_B = 4;   // enough room for stroke-width/2 so zero values aren't clipped
  const range = (max - min) || 1;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  // Map each data point → SVG coordinate
  const pts = data.map((v, i) => [
    (i / (n - 1)) * W,
    PAD_T + (1 - (v - min) / range) * (H - PAD_T - PAD_B)
  ]);

  // Smooth cubic-bezier path
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

  // Fill opacity: soft in light mode, slightly stronger in dark
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

// ─── Pending Amounts ──────────────────────────────────────────────────────────
function listenPending() {
  const q = window.query(
    window.collection(window.db, 'users', uid, 'pending'),
    window.orderBy('createdAt', 'desc')
  );
  let firstLoad = true;
  window.onSnapshot(q, snap => {
    pendingAmounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPendingList();
    renderStats();
    
    if (firstLoad && window._dataLoaded) {
      firstLoad = false;
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
      window.collection(window.db, 'users', uid, 'pending'),
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
  if (!pendingAmounts.length) { el.innerHTML = '<div class="empty">No pending amounts</div>'; return; }
  el.innerHTML = '';

  // Hint message
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
  await window.deleteDoc(window.doc(window.db, 'users', uid, 'pending', id));
  vibrate();
};

// ─── Analytics: Daily ─────────────────────────────────────────────────────────
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

// ─── Analytics: Monthly ───────────────────────────────────────────────────────
// ── Smart description suggestions ─────────────────────────────────────────────
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

// ── Monthly Spending Insights ────────────────────────────────────────────────
function renderMonthlyInsights(y, m, monthTx, prevMonthTx, monthInc, monthExp, monthIncTotal, monthExpTotal, prevIncTotal, prevExpTotal) {
  const el = document.getElementById('monthlyInsights');
  if (!el) return;

  const cards = [];
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === y && today.getMonth() === m - 1;
  const daysPassed = isCurrentMonth ? today.getDate() : daysInMonth;

  // 1. Total Spending
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

  // 2. Net Savings
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

  // 3. Income Change
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

  // 4. Top Spending Category
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

  // 5. Biggest Category Increase
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

  // 6. Budget Utilization
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

  // 7. Daily Average
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

  // 8. Transaction Count
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

// ─── Transaction search & filter listeners ────────────────────────────────────
// Debounce the free-text search so we don't rebuild the full list on every keystroke.
let _txSearchDebounceTimer = null;
document.getElementById('txSearchInput').addEventListener('input', () => {
  clearTimeout(_txSearchDebounceTimer);
  _txSearchDebounceTimer = setTimeout(renderAllTxList, 200);
});
document.getElementById('txCategoryFilter').addEventListener('change', renderAllTxList);
document.getElementById('txTypeFilter').addEventListener('change', renderAllTxList);

// ─── Analytics: Yearly ───────────────────────────────────────────────────────
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

// ─── Analytics: Cash Flow ────────────────────────────────────────────────────
// Income - Expense per month, carrying balance forward from startingBalance
function renderCashflow() {
  const year = parseInt(document.getElementById('cashflowYear').value);
  if (!year) return;

  const yearTx = transactions.filter(t => { const d = toDate(t.selectedDate); return d && d.getFullYear() === year; });

  // Build monthly income + expense
  const monthInc = Array(12).fill(0);
  const monthExp = Array(12).fill(0);
  yearTx.forEach(t => {
    const d = toDate(t.selectedDate);
    if (!d) return;
    const mo = d.getMonth();
    if (t.type === 'income')  monthInc[mo] += t.amount;
    if (t.type === 'expense') monthExp[mo] += t.amount;
  });

  // Also check if there are any months with data at all
  const hasData = monthInc.some(v=>v>0) || monthExp.some(v=>v>0);
  if (!hasData) {
    document.getElementById('cashflowBody').innerHTML =
      `<tr><td colspan="5" class="empty">No data for ${year}</td></tr>`;
    return;
  }

  // Opening balance for the selected year = startingBalance + all net from transactions
  // that occurred strictly before Jan 1 of the selected year.
  const yearStart = new Date(year, 0, 1);
  const priorNet = transactions.reduce((sum, t) => {
    const d = toDate(t.selectedDate);
    if (d && d < yearStart) {
      return sum + (t.type === 'income' ? t.amount : -t.amount);
    }
    return sum;
  }, 0);
  const openingBalance = startingBalance + priorNet;

  // Rolling balance: starts with opening balance for the year, carries month-to-month
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

// ─── Shared theme-change observer for charts ─────────────────────────────────
// A single MutationObserver shared across all chart renderers.
// Each chart registers its update callback by container element.
// Re-rendering a chart simply overwrites the previous entry — no leak.
const _chartThemeCallbacks = new Map();
const _chartThemeObserver = new MutationObserver(() => {
  _chartThemeCallbacks.forEach(cb => cb());
});
_chartThemeObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});
function registerChartThemeCallback(container, cb) {
  _chartThemeCallbacks.set(container, cb);
}

// ─── Analytics: Monthly Daily Line Chart ─────────────────────────────────────
function renderMonthlyLineChart(year, month, txList, type) {
  const wrap = document.getElementById('monthlyLineWrap');
  if (!wrap) return;

  // Build day-by-day totals for the month
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

  // Y-axis always starts at 0 so zero days sit flat at the bottom.
  // Top is padded 15% above the peak so the highest bar has breathing room.
  const maxVal = Math.max(...yValues);
  // Small negative bottom padding so the line isn't clipped when it
  // touches zero — gives just enough room for the curve to land cleanly.
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
    // Small invisible markers on every point so hover snaps cleanly
    marker: {
      color: typeColor,
      size: 6,
      opacity: 0,
      line: { width: 0 },
    },
    // On hover, marker becomes visible
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

  // Register theme-sync callback in the shared observer (replaces any previous entry for this container)
  registerChartThemeCallback(container, () => {
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
  
  // Slightly explode slices
  const pull = labels.map(() => 0.04);

  const isMobile = window.matchMedia('(max-width: 768px)').matches || 'ontouchstart' in window;

  // Remove any previous hint so re-renders don't stack them
  const _prevHint = wrap.previousElementSibling;
  if (_prevHint && _prevHint.classList.contains('pie-mobile-hint')) _prevHint.remove();

  if (isMobile) {
    const hint = document.createElement('p');
    hint.className = 'pie-mobile-hint';
    hint.textContent = 'Tap a slice to see details';
    hint.style.cssText = 'text-align:center;font-size:.8rem;color:var(--text-3);margin:0 0 6px;letter-spacing:.01em;';
    wrap.parentNode.insertBefore(hint, wrap);
  }

  wrap.innerHTML = '<div style="width:100%;height:100%;min-height:450px;"></div>';
  const container = wrap.firstChild;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#E8E6E1' : '#2D2D2D';
  const bgColor = isDark ? '#1c1c1c' : '#ffffff';
  const borderColor = isDark ? '#3a3a3a' : '#ffffff';

  // On mobile (touch) devices hide labels — they become too cramped.
  // Labels show only via the hover/tap tooltip instead.
  // On desktop, show labels outside as normal.

  const data = [{
    type: 'pie',
    labels: labels,
    values: values,
    marker: {
      colors: colorArray,
      line: { color: borderColor, width: 2 }
    },
    textposition: isMobile ? 'none' : 'outside',
    textinfo: isMobile ? 'none' : 'label+percent',
    pull: pull,
    hole: 0,
    hovertemplate: '<b>%{label}</b><br>' +
                   '₹%{value:,.2f}<br>' +
                   '%{percent}<extra></extra>',
    sort: false,
    textfont: {
      size: 13,
      family: 'DM Sans, sans-serif',
      color: textColor
    },
    outsidetextfont: {
      size: 13,
      family: 'DM Sans, sans-serif',
      color: textColor
    }
  }];

  const layout = {
    showlegend: false,
    // Mobile: no outside labels so no margin needed for text overflow
    margin: isMobile
      ? { t: 20, b: 20, l: 20, r: 20 }
      : { t: 80, b: 80, l: 120, r: 120 },
    paper_bgcolor: bgColor,
    plot_bgcolor: bgColor,
    font: {
      family: 'DM Sans, sans-serif',
      size: 13,
      color: textColor
    },
    autosize: true,
    uniformtext: isMobile ? {} : {
      minsize: 10,
      mode: 'hide'
    }
  };

  const config = {
    responsive: true,
    displayModeBar: false
  };

  Plotly.react(container, data, layout, config);

  // Register theme-sync callback in the shared observer (replaces any previous entry for this container)
  registerChartThemeCallback(container, () => {
    const nowDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTextColor = nowDark ? '#E8E6E1' : '#2D2D2D';
    const newBgColor = nowDark ? '#1c1c1c' : '#ffffff';
    const newBorderColor = nowDark ? '#3a3a3a' : '#ffffff';
    Plotly.update(container, {
      'marker.line.color': newBorderColor,
      'textfont.color': newTextColor,
      'outsidetextfont.color': newTextColor
    }, {
      'paper_bgcolor': newBgColor,
      'plot_bgcolor': newBgColor,
      'font.color': newTextColor
    });
  });
}

// Re-render sparklines on theme toggle (balance line color is theme-dependent)
registerChartThemeCallback('sparklines', () => renderSparklines());