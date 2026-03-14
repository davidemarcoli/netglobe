export type ThemeName = 'amber' | 'cyber' | 'threat';

const STORAGE_KEY = 'netglobe-theme';

export function initTheme(onThemeChange: () => void) {
  // Restore saved theme
  const saved = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
  if (saved) applyTheme(saved);

  // Theme buttons
  document.querySelectorAll<HTMLButtonElement>('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme as ThemeName;
      applyTheme(theme);
      onThemeChange();
    });
  });
}

function applyTheme(theme: ThemeName) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);

  // Update active button
  document.querySelectorAll<HTMLButtonElement>('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

/** Read a CSS custom property from :root */
export function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function getMarkerColors() {
  return {
    primary: getCssVar('--marker-primary'),
    cluster: getCssVar('--marker-cluster'),
    me: getCssVar('--marker-me'),
  };
}
