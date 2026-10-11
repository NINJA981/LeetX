/**
 * LeetX Presentation & Interaction Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initToast();
  initThemeSwitcher();
  initRoadmapFilters();
  initSquadInteractions();
  initDuelInteractions();
  initGitHubSync();
  initActionButtons();
});

/* ==========================================================================
   1. NAVIGATION
   ========================================================================== */
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const pages = document.querySelectorAll('.page');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetPage = item.getAttribute('data-page');
      if (!targetPage) return;

      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      pages.forEach(page => page.classList.remove('active'));
      const targetEl = document.getElementById(`page-${targetPage}`);
      if (targetEl) {
        targetEl.classList.add('active');
      }
    });
  });
}

/* ==========================================================================
   2. TOAST SYSTEM
   ========================================================================== */
let toastTimeout = null;

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('show');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

function initToast() {
  // Ensure initial state
}

/* ==========================================================================
   3. THEME SWITCHER (Light, Dark, LeetX)
   ========================================================================== */
function initThemeSwitcher() {
  const themeButtons = document.querySelectorAll('.theme-selector button');

  themeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.textContent.trim().toLowerCase();

      if (theme === 'light') {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', theme);
      }

      themeButtons.forEach(b => {
        b.className = 'btn-secondary';
      });
      btn.className = 'btn-primary';

      showToast(`Theme set to ${btn.textContent.trim()}`);
    });
  });
}

/* ==========================================================================
   4. ROADMAP FILTERING
   ========================================================================== */
function initRoadmapFilters() {
  const chips = document.querySelectorAll('.filter-chips .chip');
  const problemRows = document.querySelectorAll('.problem-list .problem-row');

  // Problem category mapping
  const categoryMap = {
    '1': 'arrays',
    '217': 'arrays',
    '242': 'arrays',
    '49': 'arrays',
    '347': 'arrays',
    '15': 'pointers',
    '11': 'pointers',
    '121': 'window',
    '3': 'window',
    '20': 'stack',
    '704': 'binary'
  };

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      const filter = chip.textContent.trim().toLowerCase();

      problemRows.forEach(row => {
        const numEl = row.querySelector('.num');
        const num = numEl ? numEl.textContent.replace('#', '').trim() : '';
        const cat = categoryMap[num] || 'arrays';

        if (filter === 'all') {
          row.style.display = 'flex';
        } else if (filter === 'arrays' && cat === 'arrays') {
          row.style.display = 'flex';
        } else if (filter === 'pointers' && cat === 'pointers') {
          row.style.display = 'flex';
        } else if (filter === 'window' && cat === 'window') {
          row.style.display = 'flex';
        } else if (filter === 'stack' && cat === 'stack') {
          row.style.display = 'flex';
        } else if (filter === 'binary' && cat === 'binary') {
          row.style.display = 'flex';
        } else {
          // Default fallback matching text
          const title = row.querySelector('.title')?.textContent.toLowerCase() || '';
          if (title.includes(filter)) {
            row.style.display = 'flex';
          } else {
            row.style.display = 'none';
          }
        }
      });
    });
  });
}

/* ==========================================================================
   5. SQUAD INTERACTIONS
   ========================================================================== */
function initSquadInteractions() {
  const copyBtn = document.querySelector('.room-actions .icon-btn[title="Copy"]');
  const refreshBtn = document.querySelector('.room-actions .icon-btn[title="Refresh"]');
  const leaveBtn = document.querySelector('.room-actions .btn-secondary');
  const joinInput = document.querySelector('.join-room input');
  const joinBtn = document.querySelector('.join-room .btn-primary');

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText('#GZZSNR').catch(() => {});
      showToast('✓ Copied room code: #GZZSNR');
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      showToast('↻ Squad room refreshed');
    });
  }

  if (leaveBtn) {
    leaveBtn.addEventListener('click', () => {
      if (confirm('Leave squad #GZZSNR?')) {
        showToast('Left squad room');
      }
    });
  }

  if (joinBtn && joinInput) {
    joinBtn.addEventListener('click', () => {
      const code = joinInput.value.trim();
      if (code) {
        showToast(`Joined squad ${code.toUpperCase()}`);
        joinInput.value = '';
      } else {
        showToast('Please enter a squad code');
      }
    });
  }
}

/* ==========================================================================
   6. DUEL INTERACTIONS
   ========================================================================== */
function initDuelInteractions() {
  const startDuelBtn = document.querySelector('#page-duels .btn-primary');
  if (startDuelBtn) {
    startDuelBtn.addEventListener('click', () => {
      showToast('⚔️ Duel match started with @Mano2409!');
    });
  }
}

/* ==========================================================================
   7. GITHUB SYNC
   ========================================================================== */
function initGitHubSync() {
  const syncButtons = document.querySelectorAll('.github-utility .btn-secondary, .github-actions .btn-primary');

  syncButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const original = btn.textContent;
      btn.textContent = 'Syncing...';
      btn.style.pointerEvents = 'none';

      setTimeout(() => {
        btn.textContent = original;
        btn.style.pointerEvents = 'auto';
        showToast('✓ 115 solutions synced to GitHub');
      }, 1000);
    });
  });

  const disconnectBtn = document.querySelector('.github-actions .danger-text');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', () => {
      if (confirm('Disconnect GitHub repository?')) {
        showToast('GitHub disconnected');
      }
    });
  }
}

/* ==========================================================================
   8. ACTION BUTTONS & DATA MANAGEMENT
   ========================================================================== */
function initActionButtons() {
  // Review Buttons
  document.querySelectorAll('.surface-section .btn-primary').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.textContent.includes('Review')) {
        showToast('Opening review for #70 Climbing Stairs...');
      } else if (btn.textContent.includes('Solve')) {
        showToast('Opening #15 3Sum on LeetCode...');
      }
    });
  });

  // Next Challenge solve button
  const challengeBtn = document.querySelector('.challenge-row .btn-primary');
  if (challengeBtn) {
    challengeBtn.addEventListener('click', () => {
      showToast('Loading Lexicographically Smallest Permutation...');
    });
  }

  // Find matching DP problems
  const findDpBtn = document.querySelector('.challenge-surface .btn-secondary');
  if (findDpBtn) {
    findDpBtn.addEventListener('click', () => {
      showToast('Filtering 1-D DP problems...');
    });
  }

  // Row actions (Edit & Open)
  document.querySelectorAll('.row-actions button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.textContent.trim();
      const row = btn.closest('.problem-row');
      const title = row ? row.querySelector('.title')?.textContent : 'Problem';

      if (action === '✎') {
        showToast(`Editing note for ${title}`);
      } else {
        showToast(`Opening ${title} on LeetCode ↗`);
      }
    });
  });

  // Danger zone in Settings
  document.querySelectorAll('.danger-zone .danger-text').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.textContent.trim();
      if (confirm(`Are you sure you want to ${action.toLowerCase()}?`)) {
        showToast(`${action} completed`);
      }
    });
  });
}
