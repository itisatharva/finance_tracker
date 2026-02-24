// app.js — Finance Tracker

// ─── State ───────────────────────────────────────────────────────────────────
let uid             = null;
let transactions    = [];
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
function toDate(v) { return v && v.toDate ? v.toDate() : (v instanceof Date ? v : new Date(v)); }
function fmt(n) {
  const abs = Math.abs(n);
  const str = '₹' + abs.toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
  return n < 0 ? '-' + str : str;
}
function vibrate() { if (navigator.vibrate) navigator.vibrate(40); }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// Initialize month dropdown
function initMonthDropdown(currentDate) {
  const select = document.getElementById('monthlyDate');
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  
  select.innerHTML = '';
  
  for (let year = currentYear - 2; year <= currentYear + 1; year++) {
    for (let month = 0; month < 12; month++) {
      const option = document.createElement('option');
      const value = `${year}-${String(month + 1).padStart(2, '0')}`;
      option.value = value;
      option.textContent = `${MONTHS[month]} ${year}`;
      select.appendChild(option);
      
      if (year === currentYear && month === currentMonth) {
        option.selected = true;
      }
    }
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

  function openDrawer()  { drawer.classList.add('open'); backdrop.classList.add('open'); }
  function closeDrawer() { drawer.classList.remove('open'); backdrop.classList.remove('open'); }

  btnOpen.addEventListener('click', openDrawer);
  btnClose.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);

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
  if (v === 'analytics') refreshCurrentPeriod();
  if (v === 'transactions') renderAllTxList();
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
window.addCat = async function(type) {
  const nameEl  = document.getElementById(type === 'income' ? 'newIncName'  : 'newExpName');
  const colorEl = document.getElementById(type === 'income' ? 'newIncColor' : 'newExpColor');
  const name = nameEl.value.trim();
  if (!name) { alert('Enter a category name'); return; }
  categories[type].push({ name, color: colorEl.value });
  await saveCategories();
  renderCatLists();
  nameEl.value = '';
};
window.removeCat = async function(type, idx) {
  if (!confirm('Remove this category?')) return;
  categories[type].splice(idx, 1);
  await saveCategories();
  renderCatLists();
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

function renderCatLists() {
  ['income','expense'].forEach(type => {
    const el = document.getElementById(type === 'income' ? 'incomeList' : 'expenseList');
    el.innerHTML = '';
    categories[type].forEach((c, i) => {
      const color = catColor(c);
      const div = document.createElement('div');
      div.className = 'cat-item';
      div.innerHTML = `
        <div class="cat-color-wrap" title="Click to change color">
          <input type="color" value="${color}" onchange="updateCatColor('${type}',${i},this.value)">
          <span class="cat-color-swatch" style="background:${color}"></span>
        </div>
        <span class="cat-name">${catName(c)}</span>
        <button class="btn-sm del" onclick="removeCat('${type}',${i})">Remove</button>
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
    renderTxList();
    renderStats();
    if (activeView === 'analytics') refreshCurrentPeriod();
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
        { type, category, amount, description: note, selectedDate: new Date(dateVal), createdAt: window.serverTimestamp() }
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
    const diff = toDate(b.selectedDate) - toDate(a.selectedDate);
    if (diff !== 0) return diff;
    return toDate(b.createdAt) - toDate(a.createdAt);
  });
}

function renderTxList() {
  const el = document.getElementById('txList');
  if (!transactions.length) { el.innerHTML = '<div class="empty">No transactions yet</div>'; return; }
  
  // Fade out existing items
  const existingItems = el.querySelectorAll('.tx-item');
  existingItems.forEach(item => item.style.opacity = '0');
  
  setTimeout(() => {
    el.innerHTML = '';
    
    txSorted(transactions).slice(0, 5).forEach((tx, index) => {
      const d     = toDate(tx.selectedDate);
      const color = catColorByName(tx.type, tx.category);
      const div   = document.createElement('div');
      div.className = 'tx-item';
      div.style.opacity = '0';
      div.innerHTML = `
        <div class="tx-meta">
          <div class="tx-cat"><span class="tx-badge" style="background:${color}22;color:${color}">${tx.category}</span></div>
          ${tx.description ? `<div class="tx-note">${tx.description}</div>` : ''}
          <div class="tx-date">${d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div>
        </div>
        <div class="tx-amount ${tx.type}">${tx.type==='income'?'+':'-'}${fmt(tx.amount)}</div>
        <div class="tx-actions">
          <button class="btn-sm" onclick="openEditModal('${tx.id}')">Edit</button>
          <button class="btn-sm del" onclick="deleteTx('${tx.id}')">Delete</button>
        </div>
      `;
      el.appendChild(div);
      
      // Fade in with stagger
      setTimeout(() => {
        div.style.opacity = '1';
      }, index * 50); // 50ms delay between each item
    });
  }, existingItems.length > 0 ? 200 : 0); // Wait for fade out if items exist
}

function renderAllTxList() {
  const el = document.getElementById('allTxList');
  const countEl = document.getElementById('allTxCount');
  if (!transactions.length) {
    el.innerHTML = '<div class="empty">No transactions yet</div>';
    if (countEl) countEl.textContent = '0 transactions';
    return;
  }
  const sorted = txSorted(transactions);
  if (countEl) countEl.textContent = sorted.length + ' transaction' + (sorted.length !== 1 ? 's' : '');
  el.innerHTML = '';
  sorted.forEach(tx => {
    const d     = toDate(tx.selectedDate);
    const color = catColorByName(tx.type, tx.category);
    const div   = document.createElement('div');
    div.className = 'tx-item';
    div.innerHTML = `
      <div class="tx-meta">
        <div class="tx-cat"><span class="tx-badge" style="background:${color}22;color:${color}">${tx.category}</span></div>
        ${tx.description ? `<div class="tx-note">${tx.description}</div>` : ''}
        <div class="tx-date">${d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div>
      </div>
      <div class="tx-amount ${tx.type}">${tx.type==='income'?'+':'-'}${fmt(tx.amount)}</div>
      <div class="tx-actions">
        <button class="btn-sm" onclick="openEditModal('${tx.id}')">Edit</button>
        <button class="btn-sm del" onclick="deleteTx('${tx.id}')">Delete</button>
      </div>
    `;
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
    await window.deleteDoc(window.doc(window.db, 'users', uid, 'transactions', id));
    vibrate();
  });
})();

window.deleteTx = async function(id) {
  if (localStorage.getItem('skipDeleteConfirm') === '1') {
    // Skip confirmation — delete directly
    await window.deleteDoc(window.doc(window.db, 'users', uid, 'transactions', id));
    vibrate();
    return;
  }
  // Show custom modal
  _pendingDeleteId = id;
  document.getElementById('deleteNoAsk').checked = false;
  document.getElementById('deleteModalBg').classList.add('open');
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
    { type, category, amount, description: note, selectedDate: new Date(dateVal), updatedAt: window.serverTimestamp() },
    { merge: true }
  );
  closeEditModal(); vibrate();
};

// ─── Stats (all-time) ─────────────────────────────────────────────────────────
function renderStats() {
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
  
  // Set opacity 0 first
  [incomeEl, expenseEl, balanceEl, pendingEl].forEach(el => {
    el.style.opacity = '0';
  });
  
  incomeEl.innerHTML  = fmt(income);
  expenseEl.innerHTML = fmt(expense);
  balanceEl.innerHTML = fmt(balance);
  pendingEl.innerHTML = fmt(pending);
  
  // Fade in after a tiny delay
  setTimeout(() => {
    [incomeEl, expenseEl, balanceEl, pendingEl].forEach(el => {
      el.style.opacity = '1';
    });
  }, 50);

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
    div.innerHTML = `
      <div class="b-name"><div class="b-dot" style="background:${colors[name]}"></div>${name}</div>
      <div class="b-amt">${fmt(amt)}</div>
    `;
    el.appendChild(div);
  });
}
document.getElementById('monthlyDate').addEventListener('change', renderMonthly);

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

  MONTHS.forEach((mo, i) => {
    const inc = monthInc[i];
    const exp = monthExp[i];
    const net = inc - exp;
    runningBalance += net;

    const netClass   = net >= 0 ? 'cf-pos' : 'cf-neg';
    const balClass   = runningBalance >= 0 ? 'cf-pos' : 'cf-neg';
    const netSign    = net >= 0 ? '+' : '';
    const balSign    = runningBalance >= 0 ? '' : '';

    const tr = document.createElement('tr');
    tr.className = (inc===0 && exp===0) ? 'cf-empty-row' : '';
    tr.innerHTML = `
      <td style="text-align:left;font-weight:600">${mo} ${year}</td>
      <td class="cf-income">${inc > 0 ? fmt(inc) : '—'}</td>
      <td class="cf-expense">${exp > 0 ? fmt(exp) : '—'}</td>
      <td class="${netClass}">${inc===0&&exp===0 ? '—' : netSign + fmt(net)}</td>
      <td class="total-col ${balClass}">${fmt(runningBalance)}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('cashflowYear').addEventListener('change', renderCashflow);

// ─── Shared Pie/Doughnut chart ────────────────────────────────────────────────
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

  wrap.innerHTML = '<div style="width:100%;height:100%;min-height:450px;"></div>';
  const container = wrap.firstChild;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#E8E6E1' : '#2D2D2D';
  const bgColor = isDark ? '#2a2a2a' : '#ffffff';
  const borderColor = isDark ? '#3a3a3a' : '#ffffff';

  const data = [{
    type: 'pie',
    labels: labels,
    values: values,
    marker: {
      colors: colorArray,
      line: { color: borderColor, width: 2 }
    },
    textposition: 'outside',
    textinfo: 'label+percent',
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
    margin: { t: 80, b: 80, l: 120, r: 120 },
    paper_bgcolor: bgColor,
    plot_bgcolor: bgColor,
    font: {
      family: 'DM Sans, sans-serif',
      size: 13,
      color: textColor
    },
    autosize: true,
    uniformtext: {
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
    const newBgColor = nowDark ? '#2a2a2a' : '#ffffff';
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