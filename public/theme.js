// Apply saved theme before paint to avoid flash
(function() {
  const t = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
})();

function _updateThemeLabel() {
  const el = document.getElementById('themeLabelText');
  if (!el) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  el.textContent = isDark ? 'Toggle Light Mode' : 'Toggle Dark Mode';
}

window.toggleTheme = function() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  _updateThemeLabel();
};

// Set correct label once DOM is ready
document.addEventListener('DOMContentLoaded', _updateThemeLabel);