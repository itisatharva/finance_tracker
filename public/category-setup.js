// ES module — DOM is always ready. Never use DOMContentLoaded here.

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

const cats = {
  expense: DEFAULTS.expense.map(c => ({ ...c })),
  income:  DEFAULTS.income.map(c => ({ ...c })),
};

function renderLists() {
  ['expense', 'income'].forEach(type => {
    const el = document.getElementById(type === 'expense' ? 'expenseList' : 'incomeList');
    el.innerHTML = '';
    cats[type].forEach((cat, i) => {
      const div = document.createElement('div');
      div.className = 'cat-item';
      div.innerHTML = `
        <div class="cat-color-wrap" title="Click to change colour">
          <input type="color" value="${cat.color}" oninput="updateColor('${type}',${i},this.value)">
          <span class="cat-color-swatch" style="background:${cat.color}"></span>
        </div>
        <span class="cat-name">${cat.name}</span>
        <button class="btn-sm del" onclick="removeCat('${type}',${i})">Remove</button>
      `;
      el.appendChild(div);
    });
  });
}

window.updateColor = function(type, idx, color) {
  cats[type][idx].color = color;
  const list = document.getElementById(type === 'expense' ? 'expenseList' : 'incomeList');
  const swatches = list.querySelectorAll('.cat-color-swatch');
  if (swatches[idx]) swatches[idx].style.background = color;
};

window.removeCat = function(type, idx) {
  cats[type].splice(idx, 1);
  renderLists();
};

window.addCat = function(type) {
  const nameId  = type === 'expense' ? 'newExpName'  : 'newIncName';
  const colorId = type === 'expense' ? 'newExpColor' : 'newIncColor';
  const name    = document.getElementById(nameId).value.trim();
  const color   = document.getElementById(colorId).value;
  if (!name) { document.getElementById(nameId).focus(); return; }
  cats[type].push({ name, color });
  renderLists();
  document.getElementById(nameId).value = '';
};

window.saveAndContinue = async function() {
  if (!cats.expense.length && !cats.income.length) {
    alert('Please add at least one category.');
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
    if (++attempts > 100) { alert('Firebase not ready — please reload.'); return; }
    await new Promise(r => setTimeout(r, 50));
  }

  try {
    const uid = window.auth.currentUser.uid;
    await window.setDoc(
      window.doc(window.db, 'users', uid, 'settings', 'categories'),
      { income: incomeList, expense: expenseList, setupCompleted: true, createdAt: window.serverTimestamp() }
    );
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