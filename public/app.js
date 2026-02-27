// ─────────────────────────────────────────────────────────
// Finance Tracker — Clean Optimized Version
// ─────────────────────────────────────────────────────────

// ====================== STATE ============================
const App = {
  uid: null,
  transactions: [],
  pending: [],
  categories: { income: [], expense: [] },
  startingBalance: 0,
  activeView: 'dashboard',
  activePeriod: 'daily',
  monthlyType: 'expense',
  yearlyType: 'expense',
  newTxIds: new Set(),
  prevTxIds: new Set(),
  chartObserver: null
};

// ====================== HELPERS ==========================
const $ = id => document.getElementById(id);

const toDate = v => v?.toDate ? v.toDate() : new Date(v);

const fmt = n => {
  const abs = Math.abs(n);
  const str = '₹' + abs.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return n < 0 ? '-' + str : str;
};

const vibrate = () => navigator.vibrate?.(40);

// ====================== INIT =============================
window.firebaseReady.then(() => {
  window.onAuthStateChanged(window.auth, async user => {
    if (!user) return;

    App.uid = user.uid;
    initUI(user);
    await loadInitialData();
    attachListeners();
  });
});

// ====================== UI INIT ==========================
function initUI(user) {
  $('acctEmail').textContent = user.email || '—';
  $('acctJoined').textContent = new Date(
    user.metadata.creationTime
  ).toLocaleDateString('en-IN');
}

// ====================== DATA LOAD ========================
async function loadInitialData() {
  await Promise.all([
    loadCategories(),
    loadSettings()
  ]);
  listenTransactions();
  listenPending();
}

// ====================== CATEGORIES =======================
async function loadCategories() {
  const snap = await window.getDoc(
    window.doc(window.db, 'users', App.uid, 'settings', 'categories')
  );

  if (snap.exists()) {
    App.categories = snap.data();
  } else {
    App.categories = {
      income: [{ name: 'Salary', color: '#0FA974' }],
      expense: [{ name: 'Food', color: '#E84545' }]
    };
    await saveCategories();
  }
}

async function saveCategories() {
  await window.setDoc(
    window.doc(window.db, 'users', App.uid, 'settings', 'categories'),
    App.categories
  );
}

// ====================== SETTINGS =========================
async function loadSettings() {
  const snap = await window.getDoc(
    window.doc(window.db, 'users', App.uid, 'settings', 'general')
  );
  if (snap.exists()) {
    App.startingBalance = snap.data().startingBalance || 0;
  }
}

// ====================== TRANSACTIONS =====================
function listenTransactions() {
  const q = window.query(
    window.collection(window.db, 'users', App.uid, 'transactions'),
    window.orderBy('selectedDate', 'desc')
  );

  window.onSnapshot(q, snap => {
    const newData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    detectNewTransactions(newData);
    App.transactions = newData;
    renderDashboard();
  });
}

function detectNewTransactions(data) {
  const current = new Set(data.map(t => t.id));
  const newOnes = [...current].filter(id => !App.prevTxIds.has(id));
  App.newTxIds = new Set(newOnes);
  App.prevTxIds = current;
}

// ====================== PENDING ==========================
function listenPending() {
  const q = window.query(
    window.collection(window.db, 'users', App.uid, 'pending')
  );

  window.onSnapshot(q, snap => {
    App.pending = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDashboard();
  });
}

// ====================== RENDER DASHBOARD =================
function renderDashboard() {
  const stats = computeStats();
  $('sIncome').textContent = fmt(stats.monthIncome);
  $('sExpense').textContent = fmt(stats.monthExpense);
  $('sBalance').textContent = fmt(stats.balance);
  $('sPending').textContent = fmt(stats.pending);

  renderRecentTransactions();
}

// ====================== COMPUTE STATS ====================
function computeStats() {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth();

  let monthIncome = 0;
  let monthExpense = 0;
  let totalIncome = 0;
  let totalExpense = 0;

  App.transactions.forEach(t => {
    const d = toDate(t.selectedDate);
    if (t.type === 'income') totalIncome += t.amount;
    if (t.type === 'expense') totalExpense += t.amount;

    if (d.getFullYear() === curY && d.getMonth() === curM) {
      if (t.type === 'income') monthIncome += t.amount;
      if (t.type === 'expense') monthExpense += t.amount;
    }
  });

  const pending = App.pending.reduce((s, p) => s + p.amount, 0);

  return {
    monthIncome,
    monthExpense,
    balance: App.startingBalance + totalIncome - totalExpense - pending,
    pending
  };
}

// ====================== TRANSACTION LIST =================
function renderRecentTransactions() {
  const el = $('txList');
  el.innerHTML = '';

  App.transactions.slice(0, 5).forEach(tx => {
    const div = document.createElement('div');
    div.className = 'tx-item fade-in';
    div.innerHTML = `
      <span>${tx.category}</span>
      <span class="${tx.type}">
        ${tx.type === 'income' ? '+' : '-'}${fmt(tx.amount)}
      </span>
    `;
    el.appendChild(div);
  });
}

// ====================== PIE CHART ========================
function renderPieChart(wrapId, txList, type) {
  const wrap = $(wrapId);
  if (!txList.length) {
    wrap.innerHTML = `<div class="empty">No ${type}</div>`;
    return;
  }

  const totals = {};
  txList.forEach(t => {
    totals[t.category] = (totals[t.category] || 0) + t.amount;
  });

  const labels = Object.keys(totals);
  const values = Object.values(totals);

  Plotly.newPlot(wrap, [{
    type: 'pie',
    labels,
    values,
    hole: 0.4
  }], { showlegend: false }, { displayModeBar: false });

  attachThemeObserver(wrap);
}

// ====================== THEME OBSERVER ===================
function attachThemeObserver(container) {
  if (App.chartObserver) App.chartObserver.disconnect();

  App.chartObserver = new MutationObserver(() => {
    const dark = document.documentElement.dataset.theme === 'dark';
    Plotly.relayout(container, {
      paper_bgcolor: dark ? '#2a2a2a' : '#ffffff'
    });
  });

  App.chartObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
}

// ====================== LISTENERS ========================
function attachListeners() {
  $('addTxForm').addEventListener('submit', async e => {
    e.preventDefault();

    const category = $('txCategory').value;
    const amount = parseFloat($('txAmount').value);
    const date = $('txDate').value;

    if (!category || !amount) return;

    await window.addDoc(
      window.collection(window.db, 'users', App.uid, 'transactions'),
      {
        category,
        amount,
        type: detectType(category),
        selectedDate: new Date(date),
        createdAt: window.serverTimestamp()
      }
    );

    e.target.reset();
    vibrate();
  });
}

function detectType(category) {
  if (App.categories.income.some(c => c.name === category))
    return 'income';
  return 'expense';
}