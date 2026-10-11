// Runs synchronously before first paint so the popup never flashes the wrong theme.
try {
  document.documentElement.dataset.theme = localStorage.getItem('leetx_theme') || 'system';
} catch {
  document.documentElement.dataset.theme = 'system';
}
