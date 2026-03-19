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

// ── Color palette (mirrors app.js palette, self-contained for this page) ──
const _SETUP_COLORS = [
  '#E84545','#f97316','#ec4899','#f59e0b','#a855f7',
  '#14b8a6','#3b82f6','#06b6d4','#0FA974','#8b5cf6',
  '#fca5a5','#fdba74','#f9a8d4','#fde68a','#e9d5ff',
  '#99f6e4','#bfdbfe','#a5f3fc','#bbf7d0','#c7d2fe',
];

// ── Singleton popover for existing cat items ──────────────────────────────
let _setupPopoverTarget = null; // { type, idx }

function _initSetupPopover() {
  if (document.getElementById('catColorPalette')) return;
  const div = document.createElement('div');
  div.id = 'catColorPalette';
  div.setAttribute('role', 'dialog');
  div.setAttribute('aria-label', 'Pick a colour');
  div.innerHTML =
    _SETUP_COLORS.map(c =>
      `<button type="button" class="cat-palette-swatch" data-color="${c}"
               style="background:${c}" title="${c}"></button>`
    ).join('') +
    `<div class="cat-palette-custom-wrap" title="Custom colour">
       <input type="color" id="catPaletteCustom">
       <span class="cat-palette-custom-circle"></span>
     </div>`;
  document.body.appendChild(div);

  div.querySelectorAll('.cat-palette-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      if (_setupPopoverTarget !== null) {
        const { type, idx } = _setupPopoverTarget;
        cats[type][idx].color = btn.dataset.color;
        _refreshSwatchBtn(type, idx, btn.dataset.color);
      }
      _closeSetupPopover();
    });
  });

  const custom = div.querySelector('#catPaletteCustom');
  if (custom) {
    custom.addEventListener('input', () => {
      if (_setupPopoverTarget !== null) {
        const { type, idx } = _setupPopoverTarget;
        cats[type][idx].color = custom.value;
        _refreshSwatchBtn(type, idx, custom.value);
        div.querySelectorAll('.cat-palette-swatch').forEach(s => s.classList.remove('active'));
      }
    });
    custom.addEventListener('change', _closeSetupPopover);
  }

  document.addEventListener('pointerdown', e => {
    const pal = document.getElementById('catColorPalette');
    if (!pal || !pal.classList.contains('open')) return;
    if (!pal.contains(e.target) && !e.target.closest('.cat-color-swatch-btn')) {
      _closeSetupPopover();
    }
  }, true);
}

function _refreshSwatchBtn(type, idx, color) {
  const list = document.getElementById(type === 'expense' ? 'expenseList' : 'incomeList');
  const btns = list && list.querySelectorAll('.cat-color-swatch-btn');
  if (btns && btns[idx]) btns[idx].style.background = color;
}

function _popoverMarkActive(color) {
  const pal = document.getElementById('catColorPalette');
  if (!pal) return;
  pal.querySelectorAll('.cat-palette-swatch').forEach(s => {
    s.classList.toggle('active', color !== null && s.dataset.color === color);
  });
}

window._openSetupColorPopover = function(btnEl, type, idx, currentColor) {
  _initSetupPopover();
  _setupPopoverTarget = { type, idx };
  const pal = document.getElementById('catColorPalette');
  if (!pal) return;

  const r = btnEl.getBoundingClientRect();
  const PAL_W = 236, PAL_H = 110;
  let top  = r.bottom + 8;
  let left = r.left - 10;
  if (top  + PAL_H > window.innerHeight - 12) top  = r.top - PAL_H - 8;
  if (left + PAL_W > window.innerWidth  - 8)  left = window.innerWidth - PAL_W - 8;
  if (left < 8) left = 8;
  pal.style.top  = top  + 'px';
  pal.style.left = left + 'px';
  pal.classList.add('open');

  _popoverMarkActive(currentColor);
  const custom = document.getElementById('catPaletteCustom');
  if (custom) custom.value = currentColor;
};

function _closeSetupPopover() {
  const pal = document.getElementById('catColorPalette');
  if (pal) pal.classList.remove('open');
  _setupPopoverTarget = null;
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
                onclick="_openSetupColorPopover(this,'${type}',${i},'${cat.color}')"></button>
        <div class="cat-info">
          <span class="cat-name">${cat.name}</span>
          ${budgetInput}
        </div>
        <button class="btn-sm del" onclick="removeCat('${type}',${i})">Remove</button>
      `;
      el.appendChild(div);
    });
  });
}

window.updateColor = function(type, idx, color) {
  cats[type][idx].color = color;
  _refreshSwatchBtn(type, idx, color);
};

window.updateBudget = function(type, idx, budget) {
  cats[type][idx].budget = budget ? parseFloat(budget) : null;
};

window.removeCat = function(type, idx) {
  cats[type].splice(idx, 1);
  renderLists();
};

window.addCat = function(type) {
  const nameId  = type === 'expense' ? 'newExpName' : 'newIncName';
  const colorId = type === 'expense' ? 'newExpColor' : 'newIncColor';
  const name    = document.getElementById(nameId).value.trim();
  // Read color from the hidden sync input (kept in sync by the palette script below)
  const colorEl = document.getElementById(colorId);
  const color   = colorEl ? colorEl.value : _SETUP_COLORS[0];
  if (!name) { document.getElementById(nameId).focus(); return; }

  const newCat = { name, color, budget: null };
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