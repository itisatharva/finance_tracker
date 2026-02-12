// app.js — Finance Tracker main logic

// ─── State ─────────────────────────────────────────────────────────────────
let uid            = null;
let transactions   = [];
let pendingAmounts = [];
let categories     = { income: [], expense: [] };
let editTxId       = null;
let activeView     = 'dashboard';
let activePeriod   = 'daily';
let dailyChartInst = null;
let monthlyChartInst = null;

// ─── Init ───────────────────────────────────────────────────────────────────
window.firebaseReady.then(() => {
  window.onAuthStateChanged(window.auth, async user => {
    if (!user) return; // firebase-config.js handles redirect

    uid = user.uid;

    // Account info in settings
    document.getElementById('acctEmail').textContent  = user.email;
    const ts = user.metadata.creationTime;
    if (ts) document.getElementById('acctJoined').textContent =
      new Date(ts).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

    // Default dates
    const today = new Date();
    document.getElementById('txDate').valueAsDate   = today;
    document.getElementById('dailyDate').value      = toInputDate(today);
    document.getElementById('monthlyDate').value    = today.toISOString().slice(0,7);
    document.getElementById('yearlyYear').value     = today.getFullYear();

    await loadCategories();
    listenPending();
    listenTransactions();
    wireSettingsDrawer();
    wireAddTxForm();
    wireAddPending();
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────
function toInputDate(d) {
  return d.toISOString().split('T')[0];
}
function toDate(v) {
  return v && v.toDate ? v.toDate() : (v instanceof Date ? v : new Date(v));
}
function fmt(n) {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
}
function vibrate() { if (navigator.vibrate) navigator.vibrate(40); }

// ─── Settings Drawer ────────────────────────────────────────────────────────
function wireSettingsDrawer() {
  const btn      = document.getElementById('btnSettings');
  const backdrop = document.getElementById('settingsBackdrop');
  const drawer   = document.getElementById('settingsDrawer');
  const close    = document.getElementById('btnCloseSettings');
  const signOut  = document.getElementById('btnSignOut');
  const openCats = document.getElementById('btnOpenCats');

  function open()  { drawer.classList.add('open'); backdrop.classList.add('open'); }
  function close_() { drawer.classList.remove('open'); backdrop.classList.remove('open'); }

  btn.addEventListener('click', open);
  close.addEventListener('click', close_);
  backdrop.addEventListener('click', close_);
  signOut.addEventListener('click', async () => {
    if (!confirm('Sign out?')) return;
    await window.fbSignOut(window.auth).catch(console.error);
  });
  openCats.addEventListener('click', () => { close_(); openCatsModal(); });
}

// ─── View switching ──────────────────────────────────────────────────────────
window.showView = function(v) {
  activeView = v;
  document.getElementById('viewDashboard').classList.toggle('hidden', v !== 'dashboard');
  document.getElementById('viewAnalytics').classList.toggle('hidden', v !== 'analytics');
  document.getElementById('tabDash').classList.toggle('active', v === 'dashboard');
  document.getElementById('tabAnalytics').classList.toggle('active', v === 'analytics');
  if (v === 'analytics') refreshCurrentPeriod();
};

// ─── Period switching ────────────────────────────────────────────────────────
window.showPeriod = function(p) {
  activePeriod = p;
  ['daily','monthly','yearly'].forEach(id => {
    document.getElementById('period' + id[0].toUpperCase() + id.slice(1)).classList.toggle('hidden', id !== p);
    document.getElementById('pt' + id[0].toUpperCase() + id.slice(1)).classList.toggle('active', id === p);
  });
  refreshCurrentPeriod();
};

function refreshCurrentPeriod() {
  if (activePeriod === 'daily')   renderDaily();
  if (activePeriod === 'monthly') renderMonthly();
  if (activePeriod === 'yearly')  renderYearly();
}

// ─── Categories ──────────────────────────────────────────────────────────────
async function loadCategories() {
  const ref  = window.doc(window.db, 'users', uid, 'settings', 'categories');
  const snap = await window.getDoc(ref);
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
}

async function saveCategories() {
  await window.setDoc(
    window.doc(window.db, 'users', uid, 'settings', 'categories'),
    { income: categories.income, expense: categories.expense, updatedAt: window.serverTimestamp() }
  );
}

function catName(c)  { return typeof c === 'string' ? c : c.name;  }
function catColor(c) { return typeof c === 'string' ? '#999' : c.color; }

function catType(name) {
  if (categories.income.some(c  => catName(c)  === name)) return 'income';
  if (categories.expense.some(c => catName(c) === name)) return 'expense';
  return null;
}

function catColorByName(type, name) {
  const list = categories[type] || [];
  const found = list.find(c => catName(c) === name);
  return found ? catColor(found) : (type === 'income' ? '#0FA974' : '#E84545');
}

function populateCategoryDropdowns() {
  ['txCategory', 'editCategory'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">Select category</option>';

    const ig = document.createElement('optgroup');
    ig.label = 'Income';
    categories.income.forEach(c => {
      const o = document.createElement('option'); o.value = catName(c); o.textContent = catName(c); ig.appendChild(o);
    });
    sel.appendChild(ig);

    const eg = document.createElement('optgroup');
    eg.label = 'Expense';
    categories.expense.forEach(c => {
      const o = document.createElement('option'); o.value = catName(c); o.textContent = catName(c); eg.appendChild(o);
    });
    sel.appendChild(eg);

    if (prev) sel.value = prev;
  });
}

// Categories modal
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
  if (!confirm('Remove category?')) return;
  categories[type].splice(idx, 1);
  await saveCategories();
  renderCatLists();
};
window.syncSwatch = function(inputId, swatchId) {
  const color = document.getElementById(inputId).value;
  document.getElementById(swatchId).style.background = color;
};

window.updateCatColor = async function(type, idx, color) {
  if (typeof categories[type][idx] === 'string') {
    categories[type][idx] = { name: categories[type][idx], color };
  } else {
    categories[type][idx].color = color;
  }
  // Live-update the swatch without full re-render
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

// ─── Transactions ────────────────────────────────────────────────────────────
function listenTransactions() {
  const q = window.query(
    window.collection(window.db, 'users', uid, 'transactions'),
    window.orderBy('selectedDate', 'desc')
  );
  window.onSnapshot(q, snap => {
    transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTxList();
    renderStats();
    if (activeView === 'analytics') refreshCurrentPeriod();
  });
}

function wireAddTxForm() {
  document.getElementById('addTxForm').addEventListener('submit', async e => {
    e.preventDefault();

    const category = document.getElementById('txCategory').value;
    const amount   = parseFloat(document.getElementById('txAmount').value);
    const dateVal  = document.getElementById('txDate').value;
    const note     = document.getElementById('txNote').value.trim();

    if (!category) { alert('Please select a category'); return; }
    if (!amount || amount <= 0) { alert('Please enter a valid amount'); return; }

    const type = catType(category);
    if (!type) { alert('Unknown category — please re-select'); return; }

    // Show loading state
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
        {
          type,
          category,
          amount,
          description: note,
          selectedDate: new Date(dateVal),
          createdAt: window.serverTimestamp()
        }
      );

      // Success state
      spinner.classList.add('hidden');
      done.classList.remove('hidden');
      btn.style.background = 'var(--green)';
      vibrate();

      // Reset form
      document.getElementById('txAmount').value   = '';
      document.getElementById('txNote').value     = '';
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
      alert('Failed to save transaction.');
      spinner.classList.add('hidden');
      label.classList.remove('hidden');
      btn.disabled = false;
    }
  });
}

function renderTxList() {
  const el = document.getElementById('txList');
  if (!transactions.length) {
    el.innerHTML = '<div class="empty">No transactions yet</div>';
    return;
  }
  el.innerHTML = '';
  transactions.slice(0, 15).forEach(tx => {
    const d     = toDate(tx.selectedDate);
    const color = catColorByName(tx.type, tx.category);
    const div = document.createElement('div');
    div.className = 'tx-item';
    div.innerHTML = `
      <div class="tx-meta">
        <div class="tx-cat">
          <span class="tx-badge" style="background:${color}22;color:${color}">${tx.category}</span>
        </div>
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

window.deleteTx = async function(id) {
  if (!confirm('Delete this transaction?')) return;
  await window.deleteDoc(window.doc(window.db, 'users', uid, 'transactions', id));
  vibrate();
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
  const amount   = parseFloat(document.getElementById('editAmount').value);
  const dateVal  = document.getElementById('editDate').value;
  const note     = document.getElementById('editNote').value.trim();
  const type     = catType(category);

  if (!category || !amount || !dateVal || !type) {
    alert('Please fill all fields');
    return;
  }
  await window.setDoc(
    window.doc(window.db, 'users', uid, 'transactions', editTxId),
    { type, category, amount, description: note, selectedDate: new Date(dateVal), updatedAt: window.serverTimestamp() },
    { merge: true }
  );
  closeEditModal();
  vibrate();
};

// ─── Stats ───────────────────────────────────────────────────────────────────
function renderStats() {
  const income  = transactions.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const expense = transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const pending = pendingAmounts.reduce((s,p)=>s+p.amount,0);
  const balance = income - expense - pending;

  document.getElementById('sIncome').textContent  = fmt(income);
  document.getElementById('sExpense').textContent = fmt(expense);
  document.getElementById('sBalance').textContent = fmt(balance);
  document.getElementById('sPending').textContent = fmt(pending);
}

// ─── Pending Amounts ─────────────────────────────────────────────────────────
function listenPending() {
  const q = window.query(
    window.collection(window.db, 'users', uid, 'pending'),
    window.orderBy('createdAt', 'desc')
  );
  window.onSnapshot(q, snap => {
    pendingAmounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPendingList();
    renderStats();
  });
}

function wireAddPending() {
  document.getElementById('addPendingBtn').addEventListener('click', async () => {
    const name   = document.getElementById('pendingName').value.trim();
    const amount = parseFloat(document.getElementById('pendingAmt').value);
    if (!name || !amount || amount <= 0) { alert('Enter name and amount'); return; }
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
  if (!pendingAmounts.length) {
    el.innerHTML = '<div class="empty">No pending amounts</div>';
    return;
  }
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

// ─── Analytics: Daily ────────────────────────────────────────────────────────
function renderDaily() {
  const dateVal = document.getElementById('dailyDate').value;
  if (!dateVal) return;

  const sel  = new Date(dateVal);
  const prev = new Date(sel); prev.setDate(prev.getDate() - 1);

  const selExp = transactions.filter(t => {
    const d = toDate(t.selectedDate);
    return t.type === 'expense' && d.toDateString() === sel.toDateString();
  });
  const prevExp = transactions.filter(t => {
    const d = toDate(t.selectedDate);
    return t.type === 'expense' && d.toDateString() === prev.toDateString();
  });

  const selTotal  = selExp.reduce((s,t)=>s+t.amount,0);
  const prevTotal = prevExp.reduce((s,t)=>s+t.amount,0);

  document.getElementById('cmpToday').textContent     = fmt(selTotal);
  document.getElementById('cmpYesterday').textContent = fmt(prevTotal);

  const diff = selTotal - prevTotal;
  const resultEl = document.getElementById('cmpResult');
  const arrowEl  = document.getElementById('cmpArrow');

  if (diff > 0) {
    resultEl.textContent = `${fmt(diff)} more than the previous day`;
    resultEl.className = 'cmp-result neg';
    arrowEl.textContent = '↑';
    arrowEl.className = 'cmp-arrow up';
  } else if (diff < 0) {
    resultEl.textContent = `${fmt(Math.abs(diff))} less than the previous day`;
    resultEl.className = 'cmp-result pos';
    arrowEl.textContent = '↓';
    arrowEl.className = 'cmp-arrow down';
  } else {
    resultEl.textContent = selTotal === 0 ? 'No spending on either day' : 'Same as previous day';
    resultEl.className = 'cmp-result';
    arrowEl.textContent = '=';
    arrowEl.className = 'cmp-arrow flat';
  }

  renderPieChart('dailyChartWrap', selExp, 'dailyChart', dailyChartInst, inst => dailyChartInst = inst);
}

document.getElementById('dailyDate').addEventListener('change', renderDaily);

// ─── Analytics: Monthly ──────────────────────────────────────────────────────
function renderMonthly() {
  const val = document.getElementById('monthlyDate').value;
  if (!val) return;
  const [y, m] = val.split('-').map(Number);

  const monthExp = transactions.filter(t => {
    const d = toDate(t.selectedDate);
    return t.type === 'expense' && d.getFullYear() === y && d.getMonth() === m - 1;
  });

  renderPieChart('monthlyChartWrap', monthExp, 'monthlyChart', monthlyChartInst, inst => monthlyChartInst = inst);

  // Breakdown list
  const totals = {};
  const colors = {};
  monthExp.forEach(t => {
    totals[t.category] = (totals[t.category] || 0) + t.amount;
    colors[t.category] = catColorByName('expense', t.category);
  });

  const sorted = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  const el = document.getElementById('breakdownList');

  if (!sorted.length) {
    el.innerHTML = '<div class="empty">No expenses this month</div>';
    return;
  }
  el.innerHTML = '';
  sorted.forEach(([name, amt]) => {
    const div = document.createElement('div');
    div.className = 'breakdown-item';
    div.innerHTML = `
      <div class="b-name">
        <div class="b-dot" style="background:${colors[name]}"></div>
        ${name}
      </div>
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

  const yearlyExp = transactions.filter(t => {
    const d = toDate(t.selectedDate);
    return t.type === 'expense' && d.getFullYear() === year;
  });

  // Collect all expense categories
  const catSet = new Set();
  yearlyExp.forEach(t => catSet.add(t.category));

  if (!catSet.size) {
    document.getElementById('yearlyBody').innerHTML =
      '<tr><td colspan="15" class="empty">No expense data for ' + year + '</td></tr>';
    return;
  }

  // Build data: {category: [jan..dec]}
  const data = {};
  catSet.forEach(c => { data[c] = Array(12).fill(0); });
  yearlyExp.forEach(t => {
    const m = toDate(t.selectedDate).getMonth();
    data[t.category][m] += t.amount;
  });

  // Sort categories by annual total desc
  const sorted = Object.keys(data).sort((a,b) =>
    data[b].reduce((s,v)=>s+v,0) - data[a].reduce((s,v)=>s+v,0)
  );

  const tbody = document.getElementById('yearlyBody');
  tbody.innerHTML = '';
  sorted.forEach(cat => {
    const months = data[cat];
    const total  = months.reduce((s,v)=>s+v,0);
    const avg    = total / 12;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${cat}</td>
      ${months.map(v=>`<td>${fmt(v)}</td>`).join('')}
      <td class="total-col">${fmt(total)}</td>
      <td class="avg-col">${fmt(avg)}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('yearlyYear').addEventListener('change', renderYearly);

// ─── Shared Chart Renderer ────────────────────────────────────────────────────
function renderPieChart(wrapId, expenses, chartId, existingInst, setInst) {
  const wrap = document.getElementById(wrapId);

  if (existingInst) { existingInst.destroy(); setInst(null); }

  if (!expenses.length) {
    wrap.innerHTML = '<div class="empty">No expenses for this period</div>';
    return;
  }

  const totals = {};
  const colors = {};
  expenses.forEach(t => {
    totals[t.category] = (totals[t.category] || 0) + t.amount;
    colors[t.category] = catColorByName('expense', t.category);
  });

  wrap.innerHTML = `<canvas id="${chartId}"></canvas>`;

  const textColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--text-2').trim() || '#666';

  const inst = new Chart(document.getElementById(chartId).getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(totals),
      datasets: [{ data: Object.values(totals), backgroundColor: Object.values(colors), borderWidth: 2, borderColor: 'transparent' }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 16, font: { size: 13, family: 'DM Sans, sans-serif' }, color: textColor }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a,b)=>a+b,0);
              const pct   = ((ctx.parsed/total)*100).toFixed(1);
              return ` ${ctx.label}: ${fmt(ctx.parsed)} (${pct}%)`;
            }
          }
        }
      },
      cutout: '62%'
    }
  });

  setInst(inst);
}