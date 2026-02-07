// Theme Toggle Functionality

function toggleTheme(event) {
    event.preventDefault();
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Animate the theme transition
    const circle = document.getElementById('themeCircle');
    const rect = event.target.closest('button').getBoundingClientRect();
    circle.style.left = rect.left + rect.width / 2 + 'px';
    circle.style.top = rect.top + rect.height / 2 + 'px';
    circle.classList.add('animate');
    
    setTimeout(() => circle.classList.remove('animate'), 600);
}

// Load theme on page load
function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

loadTheme();

// Expose to global scope
window.toggleTheme = toggleTheme;
