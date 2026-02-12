// category-setup.js
// NOTE: ES modules are deferred — DOM is ALWAYS ready when this runs.
// NEVER use document.addEventListener('DOMContentLoaded', ...) here.

// ── Default categories (match app.js defaults) ─────────────────────────────
const DEFAULTS = {
  expense: [
    { name: 'Food & Dining',    color: '#E84545' },
    { name: 'Transport',        color: '#f97316' },
    { name: 'Shopping',         color: '#ec4899' },
    { name: 'Bills & Utilities',color: '#f59e0b' },
    { name: 'Entertainment',    color: '#a855f7' },
    { name: 'Healthcare',       color: '#14b8a6' },
    { name: 'Education',        color: '#3b82f6' },
    { name: 'Travel',           color: '#06b6d4' },
    { name: 'Other',            color: '#6b7280' },
  ],
  income: [
    { name: 'Salary',     color: '#0FA974' },
    { name: 'Freelance',  color: '#3b82f6' },
    { name: 'Business',   color: '#8b5cf6' },
    { name: 'Investment', color: '#06b6d4' },
    { name: 'Gift',       color: '#ec4899' },
    { name: 'Other',      color: '#6366f1' },
  ],
};

// ── Working state (start with defaults) ───────────────────────────────────
const cats = {
  expense: DEFAULTS.expense.map(c => ({ ...c })),
  income:  DEFAULTS.income.map(c => ({ ...c })),
};

// ── Render both lists ──────────────────────────────────────────────────────
function renderLists() {
  ['expense', 'income'].forEach(type => {
    const el = document.getElementById(type === 'expense' ? 'expenseList' : 'incomeList');
    el.innerHTML = '';
    cats[type].forEach((cat, i) => {
      const row = document.createElement('div');
      row.className = 'cs-cat-item';
      row.innerHTML = `
        <div class="cat-color-wrap" title="Click to change colour">
          <input type="color" value="${cat.color}"
                 oninput="updateColor('${type}',${i},this.value)">
          <span class="cat-color-swatch" style="background:${cat.color}"></span>
        </div>
        <span class="cs-cat-name">${cat.name}</span>
        <button class="cs-cat-remove" onclick="removeCat('${type}',${i})">Remove</button>
      `;
      el.appendChild(row);
    });
  });
}

// ── Window-exposed helpers (used by onclick in HTML) ──────────────────────
window.updateColor = function(type, idx, color) {
  cats[type][idx].color = color;
  const list = document.getElementById(type === 'expense' ? 'expenseList' : 'incomeList');
  const swatch = list.querySelectorAll('.cat-color-swatch')[idx];
  if (swatch) swatch.style.background = color;
};

window.removeCat = function(type, idx) {
  cats[type].splice(idx, 1);
  renderLists();
};

window.addCat = function(type) {
  const nameId  = type === 'expense' ? 'newExpName'  : 'newIncName';
  const colorId = type === 'expense' ? 'newExpColor' : 'newIncColor';
  const name  = document.getElementById(nameId).value.trim();
  const color = document.getElementById(colorId).value;
  if (!name) {
    document.getElementById(nameId).focus();
    return;
  }
  cats[type].push({ name, color });
  renderLists();
  document.getElementById(nameId).value = '';
};

// Enter key in name inputs triggers add
document.getElementById('newExpName').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); window.addCat('expense'); }
});
document.getElementById('newIncName').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); window.addCat('income'); }
});

// ── Save & Continue ────────────────────────────────────────────────────────
window.saveAndContinue = async function() {
  if (cats.expense.length === 0 && cats.income.length === 0) {
    alert('Please add at least one category to continue.');
    return;
  }
  await persist(cats.expense, cats.income);
};

// ── Skip — save defaults without waiting ──────────────────────────────────
window.skipSetup = async function() {
  await persist(DEFAULTS.expense, DEFAULTS.income);
};

// ── Persist to Firestore + redirect ──────────────────────────────────────
async function persist(expenseList, incomeList) {
  const btn = document.getElementById('continueBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  // Wait until auth + firestore are ready (firebase-config.js resolves this instantly)
  let attempts = 0;
  while (!(window.auth && window.auth.currentUser && window.setDoc && window.db)) {
    if (++attempts > 100) { alert('Firebase not ready — please reload.'); return; }
    await new Promise(r => setTimeout(r, 50));
  }

  try {
    const user = window.auth.currentUser;
    await window.setDoc(
      window.doc(window.db, 'users', user.uid, 'settings', 'categories'),
      {
        income:  incomeList,
        expense: expenseList,
        setupCompleted: true,
        createdAt: window.serverTimestamp(),
      }
    );
    window.location.replace('index.html');
  } catch (err) {
    console.error('saveCategories:', err);
    alert('Could not save categories: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Continue →'; }
  }
}

// ── Boot: render lists immediately (DOM is ready in ES modules) ───────────
renderLists();