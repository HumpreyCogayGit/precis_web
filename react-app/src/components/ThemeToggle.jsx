import { useEffect, useState } from 'react';

const THEME_STORAGE_KEY = 'precis-theme';
const THEMES = new Set(['light', 'dark']);

const safeStorage = () => {
  try {
    return window.localStorage;
  } catch (err) {
    return null;
  }
};

export const readStoredTheme = () => {
  if (typeof window === 'undefined') {
    return 'light';
  }

  const stored = safeStorage()?.getItem(THEME_STORAGE_KEY);
  return THEMES.has(stored) ? stored : 'light';
};

export const applyTheme = (theme) => {
  if (typeof document === 'undefined') {
    return;
  }

  const nextTheme = THEMES.has(theme) ? theme : 'light';
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;
};

export const initTheme = () => {
  applyTheme(readStoredTheme());
};

const ThemeToggle = () => {
  const [theme, setTheme] = useState(readStoredTheme);
  const isDark = theme === 'dark';

  useEffect(() => {
    applyTheme(theme);
    safeStorage()?.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      aria-pressed={isDark}
      onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
    >
      <span className="theme-toggle-icon" aria-hidden="true">{isDark ? '☾' : '☼'}</span>
      <span className="theme-toggle-label">{isDark ? 'Dark' : 'Light'}</span>
    </button>
  );
};

export default ThemeToggle;
