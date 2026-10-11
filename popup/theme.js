/** Applies the theme and caches it for the synchronous boot script (theme-boot.js). */
export const THEMES = ['system', 'light', 'dark', 'neon'];

export function applyTheme(theme) {
  const value = THEMES.includes(theme) ? theme : 'system';
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem('leetx_theme', value); } catch { /* storage disabled */ }
}
