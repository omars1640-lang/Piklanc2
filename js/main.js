// Dark Mode
function initDarkMode() {
  const themeToggle = document.getElementById('themeToggle');
  if (!themeToggle) return;

  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    themeToggle.textContent = next === 'dark' ? '☀️' : '🌙';
  });
}

// Mobile Menu
function initMobileMenu() {
  const toggle = document.querySelector('.mobile-toggle');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    const navLinks = document.querySelector('.nav-links');
    if (navLinks.style.display === 'flex') {
      navLinks.style.display = 'none';
    } else {
      navLinks.style.display = 'flex';
      navLinks.style.flexDirection = 'column';
      navLinks.style.position = 'absolute';
      navLinks.style.top = '100%';
      navLinks.style.right = '0';
      navLinks.style.background = 'var(--navbar-bg)';
      navLinks.style.width = '100%';
      navLinks.style.padding = '1rem';
      navLinks.style.backdropFilter = 'blur(20px)';
    }
  });
}

// تشغيل كل شي عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  initMobileMenu();
});