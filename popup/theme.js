/** Applies the theme and caches the preference for the synchronous boot script (theme-boot.js). */
export const THEMES = ['system', 'light', 'dark', 'neon'];

const scheme = window.matchMedia('(prefers-color-scheme: dark)');
let preference = 'system';

function paint() {
  document.documentElement.dataset.theme = preference === 'system' ? (scheme.matches ? 'dark' : 'light') : preference;
}

// Follow the OS while the popup is open and the preference is "system".
scheme.addEventListener('change', () => { if (preference === 'system') paint(); });

export function applyTheme(theme) {
  preference = THEMES.includes(theme) ? theme : 'system';
  paint();
  try { localStorage.setItem('leetx_theme', preference); } catch { /* storage disabled */ }
}
