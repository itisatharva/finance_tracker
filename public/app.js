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
let activeView      = 'dashboard';
let activePeriod    = 'daily';
let monthlyType     = 'expense';
let yearlyType      = 'expense';

// ─── Init ────────────────────────────────────────────────────────────────────
function hideLoader() {
  const l = document.getElementById('pageLoader');
  if (l) { l.style.opacity = '0'; setTimeout(() => l.remove(), 300); }
}

window.firebaseReady.then(() => {
  window.onAuthStateChanged(window.auth, async user => {
    if (!user) return;
    uid = user.uid;
    
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
        hideLoader();
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
      _greetEl.textContent = _name ? `${_tod}, ${_name}!` : `${_tod}!`;
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
function toInputDate(d) { return d.toISOString().split('T')[0]; }
function toDate(v) { return v && v.toDate ? v.toDate() : (v instanceof Date ? v : new Date(v || 0)); }
function fmt(n) {
  const abs = Math.abs(n);
  const str = '₹' + abs.toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
  return n < 0 ? '-' + str : str;
}
function vibrate() { if (navigator.vibrate) navigator.vibrate(40); }

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
    const years = txList.map(t => toDate(t.selectedDate).getFullYear()).filter(y => !isNaN(y));
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
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
  }

  btnOpen.addEventListener('click', openDrawer);
  btnClose.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);

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
  btnClose.removeEventListener('click', closeDrawer);
  btnClose.addEventListener('click', closeDrawerAndRestoreNav);
  backdrop.removeEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawerAndRestoreNav);
  const btnImportCSV = document.getElementById('btnImportCSV');
  if (btnImportCSV) {
    btnImportCSV.addEventListener('click', () => {
      const drawer = document.getElementById('settingsDrawer');
      const backdrop = document.querySelector('.drawer-backdrop');
      if (drawer) drawer.classList.remove('open');
      if (backdrop) backdrop.classList.remove('open');
      openImportModal();
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
      const greet = document.getElementById('dashGreeting');
      if (greet) {
        const text = greet.textContent;
        const comma = text.indexOf(',');
        if (comma !== -1) greet.textContent = text.slice(0, comma + 1) + ' ' + name + '!';
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

  btnOut.addEventListener('click', async () => {
    if (!confirm('Sign out?')) return;
    await window.fbSignOut(window.auth).catch(console.error);
    window.location.replace('login.html');
  });

  btnCats.addEventListener('click', () => { closeDrawer(); openCatsModal(); });

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
  document.getElementById('viewDashboard').classList.toggle('hidden', v !== 'dashboard');
  document.getElementById('viewAnalytics').classList.toggle('hidden', v !== 'analytics');
  document.getElementById('viewTransactions').classList.toggle('hidden', v !== 'transactions');
  document.getElementById('tabDash').classList.toggle('active', v === 'dashboard');
  document.getElementById('tabAnalytics').classList.toggle('active', v === 'analytics');
  document.getElementById('tabTransactions').classList.toggle('active', v === 'transactions');
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

// ─── Categories Modal ────────────────────────────────────────────────────────
window.openCatsModal = function() {
  renderCatLists();
  document.getElementById('catsModalBg').classList.add('open');
};
window.closeCatsModal = function() {
  document.getElementById('catsModalBg').classList.remove('open');
  populateCategoryDropdowns();
};

// ─── CSV Import ──────────────────────────────────────────────────────────────
window.openImportModal = function() {
  document.getElementById('csvInput').value = '';
  document.getElementById('importPreview').style.display = 'none';
  document.getElementById('importError').style.display = 'none';
  document.getElementById('importModalBg').classList.add('open');
};

window.closeImportModal = function() {
  document.getElementById('importModalBg').classList.remove('open');
};

window.previewImport = function() {
  const csvText = document.getElementById('csvInput').value.trim();
  const errorEl = document.getElementById('importError');
  const previewEl = document.getElementById('importPreview');
  const previewList = document.getElementById('importPreviewList');
  
  errorEl.style.display = 'none';
  previewEl.style.display = 'none';
  
  if (!csvText) {
    errorEl.textContent = 'Please paste CSV data first';
    errorEl.style.display = 'block';
    return;
  }
  
  try {
    const parsed = parseCSV(csvText);
    if (parsed.length === 0) {
      errorEl.textContent = 'No valid transactions found';
      errorEl.style.display = 'block';
      return;
    }
    
    previewList.innerHTML = parsed.slice(0, 10).map(tx => 
      `<div style="padding:4px 0;font-size:.85rem;">
        ${tx.date} • ${tx.type} • ${tx.category} • ₹${tx.amount} • ${tx.description}
      </div>`
    ).join('') + (parsed.length > 10 ? `<div style="padding:8px 0;color:var(--text-3);">...and ${parsed.length - 10} more</div>` : '');
    
    previewEl.style.display = 'block';
  } catch (err) {
    errorEl.textContent = 'Error: ' + err.message;
    errorEl.style.display = 'block';
  }
};

window.executeImport = async function() {
  const csvText = document.getElementById('csvInput').value.trim();
  const errorEl = document.getElementById('importError');
  const previewEl = document.getElementById('importPreview');
  const previewList = document.getElementById('importPreviewList');
  const importBtn = document.querySelector('#importModalBg .modal-foot .btn-primary');
  
  if (!csvText) {
    errorEl.textContent = 'Please paste CSV data first';
    errorEl.style.display = 'block';
    return;
  }
  
  try {
    const parsed = parseCSV(csvText);
    if (parsed.length === 0) throw new Error('No valid transactions found');
    
    importBtn.disabled = true;
    importBtn.textContent = 'Importing...';
    
    previewEl.style.display = 'block';
    previewList.innerHTML = `<div style="color:var(--text-2);">Starting import of ${parsed.length} transactions...</div>`;
    
    let imported = 0;
    let failed = 0;
    const errors = [];
    
    for (let i = 0; i < parsed.length; i++) {
      const tx = parsed[i];
      
      try {
        await window.addDoc(
          window.collection(window.db, 'users', uid, 'transactions'),
          {
            type: tx.type,
            category: tx.category,
            amount: tx.amount,
            description: tx.description,
            selectedDate: tx.dateObj,
            createdAt: window.serverTimestamp()
          }
        );
        imported++;
        
        if (i % 10 === 0 || i === parsed.length - 1) {
          importBtn.textContent = `Importing... ${imported}/${parsed.length}`;
          previewList.innerHTML = `<div style="color:var(--green);font-weight:600;">✓ Imported ${imported} of ${parsed.length}</div>`;
        }
        
        if (i % 20 === 0 && i > 0) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
      } catch (err) {
        failed++;
        errors.push(`Row ${i + 2}: ${err.message}`);
        console.error('Import error:', tx, err);
      }
    }
    
    if (failed > 0) {
      errorEl.innerHTML = `<strong>Imported ${imported}, Failed ${failed}</strong><br>${errors.slice(0, 3).join('<br>')}`;
      errorEl.style.display = 'block';
    }
    
    importBtn.textContent = `✓ Imported ${imported}!`;
    importBtn.style.background = 'var(--green)';
    previewList.innerHTML = `<div style="color:var(--green);font-weight:700;font-size:1rem;">✓ Successfully imported ${imported} transactions!</div>`;
    
    setTimeout(() => {
      closeImportModal();
      importBtn.disabled = false;
      importBtn.textContent = 'Import';
      importBtn.style.background = '';
    }, 2000);
    
  } catch (err) {
    errorEl.textContent = 'Import failed: ' + err.message;
    errorEl.style.display = 'block';
    importBtn.disabled = false;
    importBtn.textContent = 'Import';
  }
};

function parseCSV(csvText) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l);
  const results = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (i === 0 && line.toLowerCase().includes('date')) continue;
    if (!line) continue;
    
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
    
    const month = parseInt(dateParts[0]);
    const day = parseInt(dateParts[1]);
    const year = parseInt(dateParts[2]);
    
    if (isNaN(month) || isNaN(day) || isNaN(year)) continue;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    
    const dateObj = new Date(year, month - 1, day, 12, 0, 0);
    
    results.push({
      date: dateStr,
      type,
      category,
      amount,
      description: description || '',
      dateObj
    });
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
window.removeCat = async function(type, idx) {
  categories[type].splice(idx, 1);
  await saveCategories();
  renderCatLists();
};

window.showCatDeleteConfirm = function(btn, type, idx) {
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
  yesBtn.addEventListener('click', () => window.removeCat(type, idx));
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
window.updateCatColor = async function(type, idx, color) {
  if (typeof categories[type][idx] === 'string') categories[type][idx] = { name: categories[type][idx], color };
  else categories[type][idx].color = color;
  const listEl = document.getElementById(type === 'income' ? 'incomeList' : 'expenseList');
  const swatch = listEl.querySelectorAll('.cat-color-swatch')[idx];
  if (swatch) swatch.style.background = color;
  await saveCategories();
};

window.updateCatBudget = async function(type, idx, budget) {
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
    categories[type].forEach((c, i) => {
      const color = catColor(c);
      const budget = typeof c === 'object' ? c.budget : null;
      const div = document.createElement('div');
      div.className = 'cat-item';

      const budgetInput = type === 'expense'
        ? `<input type="number" value="${budget || ''}" placeholder="Budget" class="cat-budget-input" min="0" step="0.01" onchange="updateCatBudget('${type}',${i},this.value)">`
        : '';

      div.innerHTML = `
        <div class="cat-color-wrap" title="Click to change color">
          <input type="color" value="${color}" onchange="updateCatColor('${type}',${i},this.value)">
          <span class="cat-color-swatch" style="background:${color}"></span>
        </div>
        <div class="cat-info">
          <span class="cat-name">${catName(c)}</span>
          ${budgetInput}
        </div>
        <button class="btn-sm del" onclick="showCatDeleteConfirm(this,'${type}',${i})">Remove</button>
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
    transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Refresh month dropdown so all years with transactions are always reachable
    initMonthDropdown(new Date(), transactions);

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
  document.getElementById('addTxForm').addEventListener('submit', async e => {
    e.preventDefault();
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
      await window.addDoc(
        window.collection(window.db, 'users', uid, 'transactions'),
        { type, category, amount, description: note, selectedDate: new Date(dateVal + 'T00:00:00'), createdAt: window.serverTimestamp() }
      );
      spinner.classList.add('hidden');
      done.classList.remove('hidden');
      btn.style.background = 'var(--green)';
      vibrate();
      document.getElementById('txAmount').value = '';
      document.getElementById('txNote').value   = '';
      document.getElementById('txCategory').value = '';
      document.getElementById('txDate').valueAsDate = new Date();
      setTimeout(() => {
        done.classList.add('hidden');
        label.classList.remove('hidden');
        btn.style.background = '';
        btn.disabled = false;
      }, 2000);
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
    const selDiff = toDate(b.selectedDate) - toDate(a.selectedDate);
    if (selDiff !== 0) return selDiff;
    // null createdAt = pending server write (just added) → sort to top
    if (!a.createdAt && !b.createdAt) return 0;
    if (!a.createdAt) return -1;
    if (!b.createdAt) return 1;
    return toDate(b.createdAt) - toDate(a.createdAt);
  });
}

function buildTxDiv(tx) {
  const d     = toDate(tx.selectedDate);
  const color = catColorByName(tx.type, tx.category);
  const div   = document.createElement('div');
  div.className = 'tx-item';
  div.setAttribute('data-tx-id', tx.id);
  div.style.cursor = 'pointer';
  div.innerHTML = `
    <div class="tx-meta">
      <div class="tx-cat"><span class="tx-badge" style="background:${color}22;color:${color}">${tx.category}</span></div>
      ${tx.description ? `<div class="tx-note">${tx.description}</div>` : ''}
      <div class="tx-date">${d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div>
    </div>
    <div class="tx-amount ${tx.type}">${tx.type==='income'?'+':'-'}${fmt(tx.amount)}</div>
    <div class="tx-actions">
      <button class="btn-sm" onclick="event.stopPropagation();openEditModal('${tx.id}')">Edit</button>
      <button class="btn-sm del" onclick="event.stopPropagation();showDeleteConfirm(this,'${tx.id}')">Delete</button>
    </div>
  `;
  div.addEventListener('click', e => {
    if (e.target.closest('.tx-actions') || e.target.closest('.tx-confirm-row')) return;
    openTxDetail(tx.id);
  });
  return div;
}

function renderTxList() {
  const el = document.getElementById('txList');
  const sorted = txSorted(transactions).slice(0, 5);

  if (!sorted.length) {
    el.innerHTML = '<div class="empty">No transactions yet</div>';
    return;
  }

  const isFirstRender = el.children.length === 0 || el.querySelector('.empty') !== null;
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
    el.innerHTML = '';
    sorted.forEach((tx, index) => {
      const div = buildTxDiv(tx);
      if (newIds.has(tx.id)) {
        div.classList.add('tx-adding');
      }
      el.appendChild(div);
    });
  } else {
    // Regular update (delete/edit): rebuild without animation
    el.innerHTML = '';
    sorted.forEach(tx => el.appendChild(buildTxDiv(tx)));
  }

  // IDs cleared by snapshot handler after brief window
}

function populateTxCategoryFilter() {
  const sel = document.getElementById('txCategoryFilter');
  if (!sel) return;
  const current = sel.value;
  // Gather all unique categories present in transactions
  const cats = [...new Set(transactions.map(t => t.category).filter(Boolean))].sort();
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

  el.innerHTML = '';
  sorted.forEach(tx => {
    const d     = toDate(tx.selectedDate);
    const color = catColorByName(tx.type, tx.category);
    const div   = document.createElement('div');
    div.className = 'tx-item';
    div.setAttribute('data-tx-id', tx.id);
    div.style.cursor = 'pointer';
    div.innerHTML = `
      <div class="tx-meta">
        <div class="tx-cat"><span class="tx-badge" style="background:${color}22;color:${color}">${tx.category}</span></div>
        ${tx.description ? `<div class="tx-note">${tx.description}</div>` : ''}
        <div class="tx-date">${d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div>
      </div>
      <div class="tx-amount ${tx.type}">${tx.type==='income'?'+':'-'}${fmt(tx.amount)}</div>
      <div class="tx-actions">
        <button class="btn-sm" onclick="event.stopPropagation();openEditModal('${tx.id}')">Edit</button>
        <button class="btn-sm del" onclick="event.stopPropagation();showDeleteConfirm(this,'${tx.id}')">Delete</button>
      </div>
    `;
    div.addEventListener('click', e => {
      if (e.target.closest('.tx-actions') || e.target.closest('.tx-confirm-row')) return;
      openTxDetail(tx.id);
    });
    el.appendChild(div);
  });
}

// ─── Delete confirmation modal wiring ────────────────────────────────────────
let _pendingDeleteId = null;

(function wireDeleteModal() {
  const bg          = document.getElementById('deleteModalBg');
  const closeBtn    = document.getElementById('deleteModalClose');
  const cancelBtn   = document.getElementById('deleteCancelBtn');
  const confirmBtn  = document.getElementById('deleteConfirmBtn');
  const noAskChk    = document.getElementById('deleteNoAsk');

  function closeModal() {
    bg.classList.remove('open');
    _pendingDeleteId = null;
  }

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  bg.addEventListener('click', e => { if (e.target === bg) closeModal(); });

  confirmBtn.addEventListener('click', async () => {
    if (!_pendingDeleteId) return;
    const id = _pendingDeleteId;
    closeModal();
    if (noAskChk.checked) {
      localStorage.setItem('skipDeleteConfirm', '1');
    }
    
    // Simple fade out animation
    const txElement = document.querySelector(`[data-tx-id="${id}"]`);
    if (txElement) {
      txElement.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      txElement.style.opacity = '0';
      txElement.style.transform = 'scale(0.95)';
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    

    
    await window.deleteDoc(window.doc(window.db, 'users', uid, 'transactions', id));
    vibrate();
  });
})();

window.showDeleteConfirm = function(btn, id) {
  const existing = btn.parentNode.querySelector('.tx-confirm-row');
  if (existing) { existing.remove(); btn.style.display = ''; return; }
  document.querySelectorAll('.tx-confirm-row').forEach(el => {
    const ab = el.closest('.tx-actions');
    el.remove();
    if (ab) { const d = ab.querySelector('.btn-sm.del'); if (d) d.style.display = ''; }
  });
  btn.style.display = 'none';
  const row = document.createElement('div');
  row.className = 'tx-confirm-row';
  const yesBtn = document.createElement('span');
  yesBtn.className = 'tx-confirm-label';
  yesBtn.textContent = 'Delete?';
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn-sm del';
  confirmBtn.textContent = 'Yes';
  confirmBtn.addEventListener('click', () => window.confirmDeleteTx(id));
  const cancelBtn2 = document.createElement('button');
  cancelBtn2.className = 'btn-sm';
  cancelBtn2.textContent = 'No';
  cancelBtn2.addEventListener('click', () => window.cancelDeleteTx(cancelBtn2));
  row.appendChild(yesBtn);
  row.appendChild(confirmBtn);
  row.appendChild(cancelBtn2);
  btn.parentNode.appendChild(row);
};

window.cancelDeleteTx = function(btn) {
  const row = btn.closest('.tx-confirm-row');
  const actions = row ? row.closest('.tx-actions') : null;
  if (row) row.remove();
  if (actions) { const d = actions.querySelector('.btn-sm.del'); if (d) d.style.display = ''; }
};

window.confirmDeleteTx = async function(id) {
  const txEl = document.querySelector('[data-tx-id="' + id + '"]');
  if (txEl) { txEl.classList.add('removing'); await new Promise(r => setTimeout(r, 350)); }
  await window.deleteDoc(window.doc(window.db, 'users', uid, 'transactions', id));
  vibrate();
};

window.deleteTx = async function(id) {
  if (localStorage.getItem('skipDeleteConfirm') === '1') {
    // Skip confirmation — delete directly
    const txElement = document.querySelector(`[data-tx-id="${id}"]`);
    if (txElement) {
      txElement.classList.add('removing');
      // Wait for animation to complete
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    await window.deleteDoc(window.doc(window.db, 'users', uid, 'transactions', id));
    vibrate();
    return;
  }
  // Show custom modal
  _pendingDeleteId = id;
  document.getElementById('deleteNoAsk').checked = false;
  document.getElementById('deleteModalBg').classList.add('open');
};

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
  document.getElementById('txdDate').textContent =
    d.toLocaleDateString('en-IN', { weekday:'short', day:'2-digit', month:'long', year:'numeric' });

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
  document.getElementById('txDetailBg').classList.remove('open');
  document.body.style.overflow = '';
  _txDetailId = null;
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
    document.getElementById('txDetailBg').classList.remove('open');
    document.body.style.overflow = '';
    _txDetailId = null;
    const el = document.querySelector('[data-tx-id="' + id + '"]');
    if (el) { el.classList.add('removing'); await new Promise(r => setTimeout(r, 350)); }
    await window.deleteDoc(window.doc(window.db, 'users', uid, 'transactions', id));
    vibrate();
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
};
window.closeEditModal = function() {
  document.getElementById('editModalBg').classList.remove('open');
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
  await window.setDoc(
    window.doc(window.db, 'users', uid, 'transactions', editTxId),
    { type, category, amount, description: note, selectedDate: new Date(dateVal + 'T00:00:00'), updatedAt: window.serverTimestamp() },
    { merge: true }
  );
  closeEditModal(); vibrate();
};

// ─── Stats (all-time) ─────────────────────────────────────────────────────────
function renderStats() {
  // Update profile tx count
  const tcEl = document.getElementById('profileTxCount');
  if (tcEl) tcEl.textContent = transactions.length;
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth();
  const monthTx = transactions.filter(t => {
    const d = toDate(t.selectedDate || t.createdAt);
    return d.getFullYear() === curY && d.getMonth() === curM;
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
  
  const elements = [incomeEl, expenseEl, balanceEl, pendingEl];
  const values = [fmt(income), fmt(expense), fmt(balance), fmt(pending)];
  
  // Check if spinners are present (first load)
  const hasSpinners = incomeEl && incomeEl.querySelector('.loading-spinner') !== null;
  
  if (hasSpinners) {
    // First load: fade out spinners, then fade in values
    elements.forEach(el => el.style.opacity = '0');
    
    setTimeout(() => {
      elements.forEach((el, i) => el.innerHTML = values[i]);
      // Force reflow
      void incomeEl.offsetWidth;
      elements.forEach(el => el.style.opacity = '1');
    }, 300);
  } else {
    // No spinners: instant update
    elements.forEach((el, i) => el.innerHTML = values[i]);
  }

  // Update cash flow starting balance label
  const cfEl = document.getElementById('cfStartBal');
  if (cfEl) cfEl.textContent = fmt(startingBalance);
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
  document.getElementById('addPendingBtn').addEventListener('click', async () => {
    const name   = document.getElementById('pendingName').value.trim();
    const raw    = document.getElementById('pendingAmt').value.replace(/,/g,'').trim();
    const amount = parseFloat(raw);
    if (!name || !amount || amount <= 0) { alert('Enter a name and amount'); return; }
    await window.addDoc(
      window.collection(window.db, 'users', uid, 'pending'),
      { name, amount, createdAt: window.serverTimestamp() }
    );
    document.getElementById('pendingName').value = '';
    document.getElementById('pendingAmt').value  = '';
    vibrate();
  });
}

function renderPendingList() {
  const el = document.getElementById('pendingList');
  if (!pendingAmounts.length) { el.innerHTML = '<div class="empty">No pending amounts</div>'; return; }
  el.innerHTML = '';
  pendingAmounts.forEach(p => {
    const div = document.createElement('div');
    div.className = 'pending-item';
    div.innerHTML = `
      <input type="checkbox" title="Mark as cleared" onchange="clearPending('${p.id}')">
      <span class="p-name">${p.name}</span>
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

  const selExp  = transactions.filter(t => t.type==='expense' && toDate(t.selectedDate).toDateString()===sel.toDateString());
  const prevExp = transactions.filter(t => t.type==='expense' && toDate(t.selectedDate).toDateString()===prev.toDateString());
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
    return d.getFullYear()===y && d.getMonth()===m-1;
  });
  
  const prevDate = new Date(y, m-1, 1);
  prevDate.setMonth(prevDate.getMonth() - 1);
  const prevY = prevDate.getFullYear();
  const prevM = prevDate.getMonth();
  const prevMonthTx = transactions.filter(t => {
    const d = toDate(t.selectedDate);
    return d.getFullYear()===prevY && d.getMonth()===prevM;
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
document.getElementById('txSearchInput').addEventListener('input', renderAllTxList);
document.getElementById('txCategoryFilter').addEventListener('change', renderAllTxList);
document.getElementById('txTypeFilter').addEventListener('change', renderAllTxList);

// ─── Analytics: Yearly ───────────────────────────────────────────────────────
function renderYearly() {
  const year = parseInt(document.getElementById('yearlyYear').value);
  if (!year) return;
  
  const typeLabel = yearlyType === 'income' ? 'Income' : 'Expenses';
  document.getElementById('yearlyLabel').textContent = `Monthly ${typeLabel} by Category`;
  
  const yearlyData = transactions.filter(t => t.type===yearlyType && toDate(t.selectedDate).getFullYear()===year);
  const catSet = new Set(); yearlyData.forEach(t => catSet.add(t.category));
  if (!catSet.size) {
    document.getElementById('yearlyBody').innerHTML = `<tr><td colspan="15" class="empty">No ${yearlyType} data for ${year}</td></tr>`;
    return;
  }
  const data = {};
  catSet.forEach(c => { data[c] = Array(12).fill(0); });
  yearlyData.forEach(t => { data[t.category][toDate(t.selectedDate).getMonth()] += t.amount; });
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

  const yearTx = transactions.filter(t => toDate(t.selectedDate).getFullYear() === year);

  // Build monthly income + expense
  const monthInc = Array(12).fill(0);
  const monthExp = Array(12).fill(0);
  yearTx.forEach(t => {
    const mo = toDate(t.selectedDate).getMonth();
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

  // Rolling balance: starts with startingBalance, carries month-to-month
  const tbody = document.getElementById('cashflowBody');
  tbody.innerHTML = '';
  let runningBalance = startingBalance;

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

// ─── Shared Pie/Doughnut chart ────────────────────────────────────────────────

// ─── Analytics: Monthly Daily Line Chart ─────────────────────────────────────
function renderMonthlyLineChart(year, month, txList, type) {
  const wrap = document.getElementById('monthlyLineWrap');
  if (!wrap) return;

  // Build day-by-day totals for the month
  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyTotals = new Array(daysInMonth).fill(0);

  txList.forEach(t => {
    const d = toDate(t.selectedDate);
    if (d.getFullYear() === year && d.getMonth() === month - 1) {
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

  Plotly.newPlot(container, trace, layout, config);

  // Theme sync
  const obs = new MutationObserver(() => {
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
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
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

  Plotly.newPlot(container, data, layout, config);
  
  // Update chart on theme change
  const observer = new MutationObserver(() => {
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
  
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
}