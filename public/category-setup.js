// ES module — DOM is always ready. Never use DOMContentLoaded here.

const DEFAULTS = {
  expense: [
    { name: 'Food & Dining',    color: '#E84545', budget: null },
    { name: 'Transport',        color: '#f97316', budget: null },
    { name: 'Shopping',         color: '#ec4899', budget: null },
    { name: 'Bills & Utilities',color: '#f59e0b', budget: null },
    { name: 'Entertainment',    color: '#a855f7', budget: null },
    { name: 'Healthcare',       color: '#14b8a6', budget: null },
    { name: 'Education',        color: '#3b82f6', budget: null },
    { name: 'Travel',           color: '#06b6d4', budget: null },
    { name: 'Other Expenses',            color: '#6b7280', budget: null },
  ],
  income: [
    { name: 'Salary',     color: '#0FA974', budget: null },
    { name: 'Freelance',  color: '#3b82f6', budget: null },
    { name: 'Business',   color: '#8b5cf6', budget: null },
    { name: 'Investment', color: '#06b6d4', budget: null },
    { name: 'Gift',       color: '#ec4899', budget: null },
    { name: 'Other Income',      color: '#6366f1', budget: null },
  ],
};

const cats = {
  expense: DEFAULTS.expense.map(c => ({ ...c })),
  income:  DEFAULTS.income.map(c => ({ ...c })),
};

// ── Color palette ──────────────────────────────────────────────────────────
const _VIVID = [
  '#E84545','#f97316','#ec4899','#f59e0b','#a855f7',
  '#14b8a6','#3b82f6','#06b6d4','#0FA974','#8b5cf6',
  '#6366f1','#ef4444','#22c55e','#eab308','#64748b',
];
const _PASTEL = [
  '#fca5a5','#fdba74','#f9a8d4','#fde68a','#e9d5ff',
  '#99f6e4','#bfdbfe','#a5f3fc','#bbf7d0','#c7d2fe',
  '#ddd6fe','#fecaca','#d9f99d','#fef08a','#e2e8f0',
];

// Tracks chosen "add new" color per type
const _addColor = { expense: '#E84545', income: '#0FA974' };

// Currently open inline panel
let _openPanel = null;

/** Build an inline color panel. onPick(color) fires on every change. */
function _buildPanel(initialColor, onPick) {
  const panel = document.createElement('div');
  panel.className = 'cat-color-panel';

  function applyColor(c) {
    onPick(c);
    panel.querySelectorAll('.cat-palette-dot').forEach(s =>
      s.classList.toggle('active', s.dataset.color === c));
    hexInput.value = c;
    hexInput.classList.remove('invalid');
    nativeInput.value = c;
  }

  function makeRow(colors, label) {
    const lbl = document.createElement('p');
    lbl.className = 'cat-color-panel-row-label';
    lbl.textContent = label;
    panel.appendChild(lbl);
    const row = document.createElement('div');
    row.className = 'cat-color-panel-row';
    colors.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-palette-dot' + (c === initialColor ? ' active' : '');
      btn.style.background = c;
      btn.dataset.color = c;
      btn.title = c;
      btn.addEventListener('click', () => applyColor(c));
      row.appendChild(btn);
    });
    panel.appendChild(row);
  }

  makeRow(_VIVID,  'Vivid');
  makeRow(_PASTEL, 'Pastel');

  const footer = document.createElement('div');
  footer.className = 'cat-color-panel-footer';

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
      onPick(v);
      panel.querySelectorAll('.cat-palette-dot').forEach(s =>
        s.classList.toggle('active', s.dataset.color === v));
      nativeInput.value = v;
    }
  });
  footer.appendChild(hexInput);

  const nativeWrap = document.createElement('div');
  nativeWrap.className = 'cat-color-native-wrap';
  nativeWrap.title = 'Custom colour';
  const nativeInput = document.createElement('input');
  nativeInput.type = 'color';
  nativeInput.value = initialColor;
  nativeInput.addEventListener('input', () => {
    onPick(nativeInput.value);
    hexInput.value = nativeInput.value;
    hexInput.classList.remove('invalid');
    panel.querySelectorAll('.cat-palette-dot').forEach(s =>
      s.classList.toggle('active', s.dataset.color === nativeInput.value));
  });
  const circle = document.createElement('span');
  circle.className = 'cat-color-native-circle';
  nativeWrap.appendChild(nativeInput);
  nativeWrap.appendChild(circle);
  footer.appendChild(nativeWrap);
  panel.appendChild(footer);

  return panel;
}

/** Toggle inline panel on an existing cat-item. */
window._toggleSetupPanel = function(swatchBtn, type, idx) {
  const item = swatchBtn.closest('.cat-item');
  if (!item) return;

  // Always read live color from state — not from a stale argument
  const liveColor = cats[type][idx] ? cats[type][idx].color : '#999';

  if (_openPanel && _openPanel.parentElement === item) {
    _openPanel.remove(); _openPanel = null;
    swatchBtn.classList.remove('panel-open');
    return;
  }
  if (_openPanel) {
    const prev = _openPanel.parentElement &&
                 _openPanel.parentElement.querySelector('.cat-color-swatch-btn');
    if (prev) prev.classList.remove('panel-open');
    _openPanel.remove(); _openPanel = null;
  }

  const panel = _buildPanel(liveColor, (c) => {
    cats[type][idx].color = c;
    swatchBtn.style.background = c;
  });
  item.appendChild(panel);
  _openPanel = panel;
  swatchBtn.classList.add('panel-open');
};

// Close on outside click
document.addEventListener('pointerdown', e => {
  if (!_openPanel) return;
  const item = _openPanel.parentElement;
  if (item && !item.contains(e.target)) {
    const btn = item.querySelector('.cat-color-swatch-btn');
    if (btn) btn.classList.remove('panel-open');
    _openPanel.remove(); _openPanel = null;
  }
}, true);

/** Render the always-visible add-new palette. */
function _renderAddPalette(type) {
  const id   = type === 'expense' ? 'expAddPalette' : 'incAddPalette';
  const wrap = document.getElementById(id);
  if (!wrap) return;
  wrap.innerHTML = '';

  const current  = _addColor[type];
  const inputId  = type === 'expense' ? 'newExpColor' : 'newIncColor';

  function applyColor(c) {
    _addColor[type] = c;
    const inp = document.getElementById(inputId);
    if (inp) inp.value = c;
    wrap.querySelectorAll('.cat-palette-dot').forEach(s =>
      s.classList.toggle('active', s.dataset.color === c));
    const hex = wrap.querySelector('.cat-color-hex-input');
    if (hex) { hex.value = c; hex.classList.remove('invalid'); }
    const nat = wrap.querySelector('input[type="color"]');
    if (nat) nat.value = c;
  }

  function makeRow(colors, label) {
    const lbl = document.createElement('p');
    lbl.className = 'cat-color-panel-row-label';
    lbl.textContent = label;
    wrap.appendChild(lbl);
    const row = document.createElement('div');
    row.className = 'cat-color-panel-row';
    colors.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-palette-dot' + (c === current ? ' active' : '');
      btn.style.background = c; btn.dataset.color = c; btn.title = c;
      btn.addEventListener('click', () => applyColor(c));
      row.appendChild(btn);
    });
    wrap.appendChild(row);
  }

  makeRow(_VIVID,  'Vivid');
  makeRow(_PASTEL, 'Pastel');

  const footer = document.createElement('div');
  footer.className = 'cat-color-panel-footer';

  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.className = 'cat-color-hex-input';
  hexInput.placeholder = '#000000';
  hexInput.maxLength = 7;
  hexInput.value = current;
  hexInput.addEventListener('input', () => {
    const v = hexInput.value.trim();
    const ok = /^#[0-9a-fA-F]{6}$/.test(v);
    hexInput.classList.toggle('invalid', !ok && v.length >= 2);
    if (ok) applyColor(v);
  });
  footer.appendChild(hexInput);

  const nativeWrap = document.createElement('div');
  nativeWrap.className = 'cat-color-native-wrap';
  nativeWrap.title = 'Custom colour';
  const nativeInput = document.createElement('input');
  nativeInput.type = 'color';
  nativeInput.id = inputId; // addCat reads this as fallback
  nativeInput.value = current;
  nativeInput.addEventListener('input', () => applyColor(nativeInput.value));
  const circle = document.createElement('span');
  circle.className = 'cat-color-native-circle';
  nativeWrap.appendChild(nativeInput);
  nativeWrap.appendChild(circle);
  footer.appendChild(nativeWrap);
  wrap.appendChild(footer);
}

function renderLists() {
  ['expense', 'income'].forEach(type => {
    const el = document.getElementById(type === 'expense' ? 'expenseList' : 'incomeList');
    el.innerHTML = '';
    cats[type].forEach((cat, i) => {
      const div = document.createElement('div');
      div.className = 'cat-item';
      const budgetInput = type === 'expense'
        ? `<input type="number" value="${cat.budget || ''}" placeholder="Budget" class="cat-budget-input" min="0" step="0.01" oninput="updateBudget('${type}',${i},this.value)">`
        : '';
      div.innerHTML = `
        <button type="button" class="cat-color-swatch-btn" style="background:${cat.color}"
                title="Change colour"
                onclick="_toggleSetupPanel(this,'${type}',${i})"></button>
        <div class="cat-info">
          <span class="cat-name">${cat.name}</span>
          ${budgetInput}
        </div>
        <button class="btn-sm del" onclick="removeCat('${type}',${i})">Remove</button>
      `;
      el.appendChild(div);
    });
  });
  _renderAddPalette('expense');
  _renderAddPalette('income');
}

window.updateBudget = function(type, idx, budget) {
  cats[type][idx].budget = budget ? parseFloat(budget) : null;
};

window.removeCat = function(type, idx) {
  cats[type].splice(idx, 1);
  renderLists();
};

window.addCat = function(type) {
  const nameId = type === 'expense' ? 'newExpName' : 'newIncName';
  const name   = document.getElementById(nameId).value.trim();
  if (!name) { document.getElementById(nameId).focus(); return; }

  const newCat = { name, color: _addColor[type], budget: null };
  if (type === 'expense') {
    const budgetVal = document.getElementById('newExpBudget').value;
    if (budgetVal) newCat.budget = parseFloat(budgetVal);
  }

  cats[type].push(newCat);
  renderLists();
  document.getElementById(nameId).value = '';
  if (type === 'expense') document.getElementById('newExpBudget').value = '';
};

window.saveAndContinue = async function() {
  if (!cats.expense.length) {
    alert('Please add at least one expense category.');
    return;
  }
  if (!cats.income.length) {
    alert('Please add at least one income category.');
    return;
  }
  await persist(cats.expense, cats.income);
};

window.skipSetup = async function() {
  await persist(DEFAULTS.expense, DEFAULTS.income);
};

async function persist(expenseList, incomeList) {
  const btn = document.getElementById('continueBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  let attempts = 0;
  while (!(window.auth && window.auth.currentUser && window.setDoc && window.db)) {
    if (++attempts > 100) {
      alert('Firebase not ready — please reload.');
      if (btn) { btn.disabled = false; btn.textContent = 'Continue →'; }
      return;
    }
    await new Promise(r => setTimeout(r, 50));
  }

  try {
    const uid = window.auth.currentUser.uid;

    // Determine whether we're editing an existing account or creating first account
    // After migration, accounts live at users/{uid}/accounts/{acctId}/categories/data
    // We look for a pending account ID passed via sessionStorage (set by initAccounts → promptCreateFirstAccount flow)
    // OR fall back to creating/using the legacy path for the initial setup page.
    const pendingAcctId = sessionStorage.getItem('pendingSetupAccountId');

    if (pendingAcctId) {
      // Save to the specific account already created
      await window.setDoc(
        window.doc(window.db, 'users', uid, 'accounts', pendingAcctId, 'categories', 'data'),
        { income: incomeList, expense: expenseList, setupCompleted: true, createdAt: window.serverTimestamp() }
      );
      sessionStorage.removeItem('pendingSetupAccountId');
    } else {
      // Legacy path: first-time setup before account system existed
      // Create a "Main Account" and save categories there, plus the old path for compatibility
      const { addDoc, collection, serverTimestamp, doc, setDoc } = window;
      const acctRef = doc(collection(window.db, 'users', uid, 'accounts'));
      await setDoc(acctRef, { name: 'Main Account', createdAt: serverTimestamp(), isDefault: true });
      await setDoc(
        doc(window.db, 'users', uid, 'accounts', acctRef.id, 'categories', 'data'),
        { income: incomeList, expense: expenseList, setupCompleted: true, createdAt: serverTimestamp() }
      );
      // Also save migration marker so initAccounts won't try to migrate
      await setDoc(doc(window.db, 'users', uid, 'meta', 'accounts'), {
        migrated: true,
        mainAccountId: acctRef.id,
        migratedAt: serverTimestamp(),
      });
    }

    window._authHandled = true;
    window.location.replace('index.html');
  } catch (e) {
    console.error('category-setup save failed:', e);
    alert('Could not save: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Continue →'; }
  }
}

document.getElementById('newExpName').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); window.addCat('expense'); }
});
document.getElementById('newIncName').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); window.addCat('income'); }
});

renderLists();