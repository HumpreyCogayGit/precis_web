import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';

import ThemeToggle, { initTheme } from './ThemeToggle.jsx';

const THEME_STORAGE_KEY = 'precis-theme';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = '';
});

describe('ThemeToggle', () => {
  test('applies a previously saved dark mode before the app renders', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    initTheme();

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  test('saves the selected mode so the next visit reuses it', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');

    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});