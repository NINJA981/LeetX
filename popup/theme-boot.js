// Runs synchronously before first paint so the popup never flashes the wrong theme.
// "system" is resolved to light or dark here; the stylesheet only knows light | dark | neon.
let pref = 'system';
try { pref = localStorage.getItem('leetx_theme') || 'system'; } catch { /* storage disabled */ }
const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.dataset.theme = pref === 'system' ? (dark ? 'dark' : 'light') : pref;
