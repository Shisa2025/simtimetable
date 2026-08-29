(function () {
  'use strict';

  var THEME_KEY = 'sim-timetable-theme';
  var themes = ['system', 'light', 'dark'];
  var icons = { system: '◐', light: '☀', dark: '☾' };
  var labels = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

  function savedTheme() {
    try {
      var value = localStorage.getItem(THEME_KEY);
      return themes.indexOf(value) !== -1 ? value : 'system';
    } catch (error) {
      return 'system';
    }
  }

  function applyTheme(theme) {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-label', labels[theme] + '. Activate to change theme.');
      button.setAttribute('title', labels[theme]);
      var icon = button.querySelector('.theme-toggle-icon');
      if (icon) icon.textContent = icons[theme];
    });
  }

  var theme = savedTheme();
  applyTheme(theme);

  document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
    button.addEventListener('click', function () {
      theme = themes[(themes.indexOf(theme) + 1) % themes.length];
      try { localStorage.setItem(THEME_KEY, theme); } catch (error) { /* private browsing */ }
      applyTheme(theme);
    });
  });

  document.querySelectorAll('[data-current-year]').forEach(function (node) {
    node.textContent = String(new Date().getFullYear());
  });
})();
