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

// ── Compact colour-picker (shared singleton popover) ─────────────────────────
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

let _openPopover = null;
let _openPickBtn = null;

function _closeSetupPicker() {
  if (_openPopover) { _openPopover.remove(); _openPopover = null; }
  if (_openPickBtn) { _openPickBtn.classList.remove('open'); _openPickBtn = null; }
}

function _buildPopoverContent(popover, initialColor, onPick) {
  function applyColor(c) {
    onPick(c);
    popover.querySelectorAll('.cat-palette-dot').forEach(d =>
      d.classList.toggle('active', d.dataset.color === c));
    hexInput.value = c;
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
      btn.style.background = c; btn.dataset.color = c; btn.title = c;
      btn.addEventListener('click', e => { e.stopPropagation(); applyColor(c); });
      row.appendChild(btn);
    });
    popover.appendChild(row);
  }

  makeRow(_VIVID,  'Vivid');
  makeRow(_PASTEL, 'Pastel');

  const footer = document.createElement('div');
  footer.className = 'cat-color-panel-footer';

  const hexRow = document.createElement('div');
  hexRow.className = 'color-pick-hex-row';

  const hexPreview = document.createElement('span');
  hexPreview.className = 'color-pick-hex-preview';
  hexPreview.style.background = initialColor;
  hexRow.appendChild(hexPreview);

  const hexInput = document.createElement('input');
  hexInput.type = 'text'; hexInput.className = 'cat-color-hex-input';
  hexInput.placeholder = '#000000'; hexInput.maxLength = 7; hexInput.value = initialColor;
  hexInput.addEventListener('input', () => {
    const v = hexInput.value.trim();
    const ok = /^#[0-9a-fA-F]{6}$/.test(v);
    hexInput.classList.toggle('invalid', !ok && v.length >= 2);
    if (ok) {
      onPick(v);
      hexPreview.style.background = v;
      popover.querySelectorAll('.cat-palette-dot').forEach(d => d.classList.toggle('active', d.dataset.color === v));
      nativeInput.value = v;
    }
  });
  hexRow.appendChild(hexInput);

  const nativeWrap = document.createElement('div');
  nativeWrap.className = 'cat-color-native-wrap'; nativeWrap.title = 'Custom colour';
  nativeWrap.addEventListener('pointerdown', e => e.stopPropagation());
  const nativeInput = document.createElement('input');
  nativeInput.type = 'color'; nativeInput.value = initialColor;
  nativeInput.addEventListener('pointerdown', e => e.stopPropagation());
  const _applyNative = () => {
    const nc = nativeInput.value; onPick(nc);
    hexInput.value = nc; hexPreview.style.background = nc; hexInput.classList.remove('invalid');
    popover.querySelectorAll('.cat-palette-dot').forEach(d => d.classList.toggle('active', d.dataset.color === nc));
  };
  nativeInput.addEventListener('input', _applyNative);
  nativeInput.addEventListener('change', _applyNative);
  const circle = document.createElement('span'); circle.className = 'cat-color-native-circle';
  nativeWrap.appendChild(nativeInput); nativeWrap.appendChild(circle);
  hexRow.appendChild(nativeWrap);
  footer.appendChild(hexRow);

  const doneRow = document.createElement('div');
  doneRow.className = 'color-pick-done-row';
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button'; doneBtn.className = 'color-pick-done-btn'; doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', e => { e.stopPropagation(); _closeSetupPicker(); });
  doneRow.appendChild(doneBtn);
  footer.appendChild(doneRow);

  popover.appendChild(footer);
}

/**
 * Make a compact colour-picker button.
 * Returns { wrap, setColor(c) }.
 */
function _makeSetupColorBtn(initialColor, onPick) {
  let currentColor = initialColor;

  const wrap = document.createElement('div');
  wrap.className = 'color-pick-wrap';

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'color-pick-btn';

  const dot = document.createElement('span');
  dot.className = 'color-pick-dot'; dot.style.background = initialColor;

  btn.appendChild(dot);
  wrap.appendChild(btn);

  function _updateDot(c) {
    currentColor = c; dot.style.background = c; onPick(c);
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = btn.classList.contains('open');
    _closeSetupPicker();
    if (isOpen) return;

    btn.classList.add('open');
    _openPickBtn = btn;

    const popover = document.createElement('div');
    popover.className = 'color-pick-popover';
    _buildPopoverContent(popover, currentColor, c => { dot.style.background = c; currentColor = c; onPick(c); });
    document.body.appendChild(popover);
    _openPopover = popover;

    function _position() {
      const br = btn.getBoundingClientRect();
      const pw = popover.offsetWidth;
      const ph = popover.offsetHeight;
      const margin = 8;
      let left = br.left;
      if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
      left = Math.max(margin, left);
      let top = br.bottom + 6;
      if (top + ph > window.innerHeight - margin) top = br.top - ph - 6;
      top = Math.max(margin, top);
      popover.style.left = left + 'px';
      popover.style.top  = top  + 'px';
    }
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(_position, 0)));
  });

  return { wrap, setColor: _updateDot };
}

document.addEventListener('pointerdown', e => {
  if (!_openPopover) return;
  if (_openPopover.contains(e.target)) return;
  if (e.target.closest('.color-pick-btn')) return;
  _closeSetupPicker();
}, true);
window.addEventListener('scroll', (e) => {
  if (document.activeElement && document.activeElement.type === 'color') return;
  _closeSetupPicker();
}, true);
window.addEventListener('resize', _closeSetupPicker);

// Tracks chosen "add new" color per type (color-pick button nodes stored here)
const _addColorBtns = { expense: null, income: null };
const _addColor     = { expense: '#E84545', income: '#0FA974' };

function renderLists() {
  ['expense', 'income'].forEach(type => {
    const el = document.getElementById(type === 'expense' ? 'expenseList' : 'incomeList');
    el.innerHTML = '';
    cats[type].forEach((cat, i) => {
      const div = document.createElement('div');
      div.className = 'cat-item';

      // Compact colour-picker button
      const { wrap: colorWrap } = _makeSetupColorBtn(cat.color, (newColor) => {
        cats[type][i].color = newColor;
      });
      div.appendChild(colorWrap);

      // Info + optional budget
      const infoEl = document.createElement('div');
      infoEl.className = 'cat-info';
      if (type === 'expense') {
        infoEl.innerHTML = `<span class="cat-name">${cat.name}</span>
          <input type="number" value="${cat.budget || ''}" placeholder="Budget" class="cat-budget-input" min="0" step="0.01"
                 oninput="updateBudget('${type}',${i},this.value)">`;
      } else {
        infoEl.innerHTML = `<span class="cat-name">${cat.name}</span>`;
      }
      div.appendChild(infoEl);

      // Remove button
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-sm del';
      delBtn.textContent = 'Remove';
      delBtn.addEventListener('click', () => window.removeCat(type, i));
      div.appendChild(delBtn);

      el.appendChild(div);
    });
  });

  // Render the add-new palette buttons
  ['expense', 'income'].forEach(type => {
    const palId = type === 'expense' ? 'expAddPalette' : 'incAddPalette';
    const pal   = document.getElementById(palId);
    if (!pal) return;
    pal.innerHTML = '';
    const { wrap, setColor } = _makeSetupColorBtn(_addColor[type], (c) => {
      _addColor[type] = c;
    });
    _addColorBtns[type] = { wrap, setColor };
    pal.appendChild(wrap);
  });
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