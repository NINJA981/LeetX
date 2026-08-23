/**
 * LeetSync Squads - Popup Application Logic
 * Pure Light/Dark Mode Continuous Dashboard, Live Roadmaps, Squad Rooms & GitHub Sync.
 */

import { LeetCodeAPI } from '../scripts/leetcode.js';
import { FirebaseSquads } from '../scripts/firebase.js';
import { GitHubAPI } from '../scripts/github.js';

// State
let currentStreak = 0;
let currentXP = 0;
let currentTodaySolved = 0;
let currentSquadCode = '';
let currentUsername = '';
let currentRoadmapData = [];
let currentRoadmapType = 'blind75';
let userSolvedSlugs = new Set();
let activeCategoryFilter = 'all';
let isSquadManageMode = false;

// Apply saved theme immediately on DOM load
async function applyStoredTheme() {
  const data = await chrome.storage.local.get(['theme_preference']);
  const theme = data.theme_preference || 'light';
  document.body.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-theme', theme);

  document.querySelectorAll('[data-set-theme]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.setTheme === theme);
  });
}

/**
 * Gatekeeper check: Locks UI behind Onboarding Gateway until GitHub is connected.
 */
async function checkAuthAndInitialize() {
  const data = await chrome.storage.local.get(['github_token', 'github_repo_owner']);
  const onboardContainer = document.getElementById('onboarding-container');
  const appContainer = document.getElementById('app-container');

  if (!data.github_token) {
    if (onboardContainer) onboardContainer.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';
  } else {
    if (onboardContainer) onboardContainer.style.display = 'none';
    if (appContainer) appContainer.style.display = 'flex';
    await loadStoredState();
  }
}

/**
 * Handle linking token and unlocking extension.
 */
async function handleLinkToken(token) {
  const cleanToken = (token || '').trim();
  const statusEl = document.getElementById('onboard-status-msg');
  if (!cleanToken) {
    if (statusEl) {
      statusEl.innerText = 'Please paste your GitHub Personal Access Token.';
      statusEl.style.color = 'var(--color-hard)';
    }
    return;
  }

  if (statusEl) {
    statusEl.innerText = 'Verifying GitHub authorization...';
    statusEl.style.color = 'var(--accent-blue)';
  }

  try {
    const api = new GitHubAPI(cleanToken);
    const user = await api.request('/user');
    const owner = user.login;

    // Auto-create/link leetcode-submissions repository
    if (statusEl) statusEl.innerText = 'Linking leetcode-submissions repository...';
    const apiInstance = new GitHubAPI(cleanToken);
    await apiInstance.ensureRepository('leetcode-submissions');

    await chrome.storage.local.set({
      github_token: cleanToken,
      github_repo_owner: owner,
      github_repo_name: 'leetcode-submissions',
      display_name: owner,
    });

    currentUsername = owner;
    showToast(`✓ Welcome @${owner}!`);
    await checkAuthAndInitialize();
  } catch (err) {
    if (statusEl) {
      statusEl.innerText = `Auth Error: ${err.message || 'Invalid Token'}`;
      statusEl.style.color = 'var(--color-hard)';
    }
  }
}

/**
 * Fetch live LeetCode stats from GraphQL and update Donut chart & storage.
 */
async function fetchAndUpdateUserStats(username) {
  try {
    let targetUser = username;
    if (!targetUser) {
      const stored = await chrome.storage.local.get(['leetcode_username', 'display_name', 'github_repo_owner']);
      targetUser = stored.leetcode_username;
      if (!targetUser) {
        const activeUser = await LeetCodeAPI.getCurrentUser();
        if (activeUser?.username) {
          targetUser = activeUser.username;
        }
      }
      if (!targetUser && typeof chrome !== 'undefined' && chrome.tabs) {
        try {
          const tabs = await chrome.tabs.query({ url: '*://*.leetcode.com/*' });
          for (const tab of tabs) {
            const match = tab.url?.match(/\/(?:u|profile)\/([a-zA-Z0-9_-]+)/i);
            if (match && match[1]) {
              targetUser = match[1];
              break;
            }
          }
        } catch {}
      }
      if (targetUser) {
        await chrome.storage.local.set({ leetcode_username: targetUser });
        const lcInput = document.getElementById('input-leetcode-username');
        if (lcInput && !lcInput.value) lcInput.value = targetUser;
      }
    }

    if (!targetUser) return;

    const stats = await LeetCodeAPI.getUserStats(targetUser);
    if (stats) {
      const easy = stats.easy || 0;
      const med = stats.med || 0;
      const hard = stats.hard || 0;
      const total = stats.total || (easy + med + hard);

      updateProgressDonut(total, easy, med, hard);

      await chrome.storage.local.set({
        solved_easy_count: easy,
        solved_med_count: med,
        solved_hard_count: hard,
        total_solved: total,
        leetcode_username: targetUser,
      });

      const lcInput = document.getElementById('input-leetcode-username');
      if (lcInput && !lcInput.value) lcInput.value = targetUser;
    }
  } catch (err) {
    console.warn('[LeetCode Stats] Fetch notice:', err.message);
  }
}

/**
 * Render Background Sync Status to UI.
 */
function renderSyncStatusUI(syncStatus) {
  if (!syncStatus) return;

  const settingsBtn = document.getElementById('btn-settings-sync-now');
  const statsBtn = document.getElementById('btn-backfill-all');
  const settingsMsg = document.getElementById('auth-status-msg');
  const statsBox = document.getElementById('backfill-progress-box');
  const statsMsg = document.getElementById('backfill-status-msg');
  const statsBar = document.getElementById('backfill-bar');

  if (syncStatus.state === 'syncing') {
    if (settingsBtn) {
      settingsBtn.disabled = true;
      settingsBtn.innerHTML = '<span>⏳</span><span>Syncing Solutions...</span>';
    }
    if (statsBtn) {
      statsBtn.disabled = true;
      statsBtn.innerHTML = '<span>⏳</span><span>Syncing Solutions...</span>';
    }
    if (settingsMsg) {
      settingsMsg.innerText = syncStatus.message || 'Syncing in background...';
      settingsMsg.style.color = 'var(--accent-blue)';
    }
    if (statsBox) statsBox.style.display = 'flex';
    if (statsMsg) statsMsg.innerText = syncStatus.message || 'Syncing in background...';
    if (statsBar) statsBar.style.width = `${syncStatus.progress || 20}%`;
  } else if (syncStatus.state === 'idle') {
    if (settingsBtn) {
      settingsBtn.disabled = false;
      settingsBtn.innerHTML = '<span>⚡</span><span>Sync All Solutions Now</span>';
    }
    if (statsBtn) {
      statsBtn.disabled = false;
      statsBtn.innerHTML = '<span>⚡</span><span>Sync Solutions to Repository</span>';
    }
    const successText = syncStatus.successText || '✓ Solutions synced with GitHub repository!';
    if (settingsMsg) {
      settingsMsg.innerText = successText;
      settingsMsg.style.color = 'var(--color-easy)';
    }
    if (statsBar) statsBar.style.width = '100%';
    if (statsMsg) statsMsg.innerText = successText;
  } else if (syncStatus.state === 'error') {
    if (settingsBtn) {
      settingsBtn.disabled = false;
      settingsBtn.innerHTML = '<span>⚡</span><span>Sync All Solutions Now</span>';
    }
    if (statsBtn) {
      statsBtn.disabled = false;
      statsBtn.innerHTML = '<span>⚡</span><span>Sync Solutions to Repository</span>';
    }
    const errText = syncStatus.message || 'Sync error';
    if (settingsMsg) {
      settingsMsg.innerText = errText;
      settingsMsg.style.color = 'var(--color-hard)';
    }
    if (statsMsg) statsMsg.innerText = errText;
  }
}

/**
 * Trigger Asynchronous Background GitHub Solution Sync.
 */
async function performSolutionSync(source = 'manual') {
  const settingsBtn = document.getElementById('btn-settings-sync-now');
  const statsBtn = document.getElementById('btn-backfill-all');
  const settingsMsg = document.getElementById('auth-status-msg');
  const statsBox = document.getElementById('backfill-progress-box');
  const statsMsg = document.getElementById('backfill-status-msg');
  const statsBar = document.getElementById('backfill-bar');

  if (settingsBtn) {
    settingsBtn.disabled = true;
    settingsBtn.innerHTML = '<span>⏳</span><span>Syncing Solutions...</span>';
  }
  if (statsBtn) {
    statsBtn.disabled = true;
    statsBtn.innerHTML = '<span>⏳</span><span>Syncing Solutions...</span>';
  }
  if (settingsMsg) {
    settingsMsg.innerText = 'Initiating background sync...';
    settingsMsg.style.color = 'var(--accent-blue)';
  }
  if (statsBox) statsBox.style.display = 'flex';
  if (statsMsg) statsMsg.innerText = 'Initiating background sync...';
  if (statsBar) statsBar.style.width = '10%';

  showToast('Asynchronous sync started in background ⚡');

  // Immediately refresh live stats from LeetCode
  fetchAndUpdateUserStats();

  try {
    const res = await chrome.runtime.sendMessage({ type: 'START_ASYNC_SYNC' });
    if (res && !res.success) {
      showToast(res.error || 'Failed to start sync');
    }
  } catch (err) {
    console.warn('[Sync] Trigger notice:', err.message);
  }
}

/**
 * Update the SVG Donut Progress Chart with accurate problem numbers and stroke arcs.
 */
function updateProgressDonut(total = 0, easy = 0, med = 0, hard = 0) {
  const totalEl = document.getElementById('donut-total-count');
  const metaEl = document.getElementById('total-solved-meta');
  const countEasyEl = document.getElementById('count-easy');
  const countMedEl = document.getElementById('count-med');
  const countHardEl = document.getElementById('count-hard');

  if (totalEl) totalEl.innerText = total;
  if (metaEl) metaEl.innerText = `${total} Solved`;
  if (countEasyEl) countEasyEl.innerText = easy;
  if (countMedEl) countMedEl.innerText = med;
  if (countHardEl) countHardEl.innerText = hard;

  const safeTotal = total > 0 ? total : 1;
  const easyPct = (easy / safeTotal) * 100;
  const medPct = (med / safeTotal) * 100;
  const hardPct = (hard / safeTotal) * 100;

  const easyEl = document.getElementById('donut-easy');
  const medEl = document.getElementById('donut-med');
  const hardEl = document.getElementById('donut-hard');

  if (easyEl) {
    easyEl.setAttribute('stroke-dasharray', `${easyPct} ${100 - easyPct}`);
    easyEl.setAttribute('stroke-dashoffset', '0');
  }
  if (medEl) {
    medEl.setAttribute('stroke-dasharray', `${medPct} ${100 - medPct}`);
    medEl.setAttribute('stroke-dashoffset', `-${easyPct}`);
  }
  if (hardEl) {
    hardEl.setAttribute('stroke-dasharray', `${hardPct} ${100 - hardPct}`);
    hardEl.setAttribute('stroke-dashoffset', `-${easyPct + medPct}`);
  }
}

/**
 * Load Stored State from local storage and initialize all views.
 */
async function loadStoredState() {
  const data = await chrome.storage.local.get([
    'streak_count',
    'user_xp',
    'today_solved',
    'my_squad_code',
    'display_name',
    'github_repo_owner',
    'github_repo_name',
    'leetcode_username',
    'total_solved',
    'solved_easy_count',
    'solved_med_count',
    'solved_hard_count',
    'user_solved_slugs',
    'review_schedule',
  ]);

  currentStreak = data.streak_count || 0;
  currentXP = data.user_xp || 0;
  currentTodaySolved = data.today_solved || 0;
  currentSquadCode = data.my_squad_code || '';
  currentUsername = data.github_repo_owner || data.display_name || data.leetcode_username || 'Player';

  if (Array.isArray(data.user_solved_slugs)) {
    userSolvedSlugs = new Set(data.user_solved_slugs);
  }

  // Update Header Capsules
  document.getElementById('header-streak-count').innerText = currentStreak;
  document.getElementById('header-xp-val').innerText = currentXP;

  // Update Momentum Hero
  document.getElementById('momentum-streak-number').innerText = currentStreak;
  const streakDesc = document.getElementById('momentum-streak-desc');
  const todayStatus = document.getElementById('today-status-text');

  if (currentTodaySolved > 0) {
    streakDesc.innerText = 'Streak protected for today. High momentum!';
    todayStatus.innerText = 'Completed ✓';
    todayStatus.style.color = 'var(--color-easy)';
  } else {
    streakDesc.innerText = currentStreak > 0 
      ? "Solve today's challenge to keep your flame burning."
      : "Solve today's challenge to ignite your streak.";
    todayStatus.innerText = 'Pending ⏳';
    todayStatus.style.color = 'var(--color-med)';
  }

  renderWeekStrip(currentStreak, currentTodaySolved > 0);

  // Update Donut Chart from cache immediately
  updateProgressDonut(
    data.total_solved || 0,
    data.solved_easy_count || 0,
    data.solved_med_count || 0,
    data.solved_hard_count || 0
  );

  // Update Settings Connected State
  const repoOwner = data.github_repo_owner || currentUsername;
  const repoName = data.github_repo_name || 'leetcode-submissions';
  const syncRepoNameEl = document.getElementById('sync-repo-name');
  if (syncRepoNameEl) syncRepoNameEl.innerText = `${repoOwner}/${repoName}`;

  const activeRepoInput = document.getElementById('input-active-repo');
  if (activeRepoInput) activeRepoInput.value = `${repoOwner}/${repoName}`;

  const dispNameInput = document.getElementById('input-display-name');
  if (dispNameInput) dispNameInput.value = currentUsername;

  const lcUsernameInput = document.getElementById('input-leetcode-username');
  if (lcUsernameInput && data.leetcode_username) {
    lcUsernameInput.value = data.leetcode_username;
  }

  // Check Spaced Reviews Due
  checkScheduledReviews(data.review_schedule || {});

  // Load Roadmaps & Daily Challenge
  await loadDailyChallenge();
  await loadRoadmap(currentRoadmapType);
  await renderSquadView();
  await loadDuelStats();

  // Fetch live stats from LeetCode GraphQL in the background
  fetchAndUpdateUserStats(data.leetcode_username);
}

/**
 * Render 7-Day Activity Strip (Mon-Sun).
 */
function renderWeekStrip(streak, todayDone) {
  const d = new Date();
  const dayIndex = (d.getDay() + 6) % 7; // 0 for Mon, 6 for Sun

  for (let i = 0; i < 7; i++) {
    const el = document.getElementById(`dot-day-${i}`);
    if (!el) continue;

    el.className = 'day-circle';
    if (i === dayIndex) {
      el.classList.add('today-ring');
      if (todayDone) {
        el.classList.add('done');
        el.innerText = '✓';
      } else {
        el.innerText = '•';
      }
    } else if (i < dayIndex) {
      const daysAgo = dayIndex - i;
      if (streak >= daysAgo + (todayDone ? 1 : 0)) {
        el.classList.add('done');
        el.innerText = '✓';
      } else {
        el.innerText = '•';
      }
    } else {
      el.innerText = '•';
    }
  }
}

/**
 * Load Today's Daily Challenge from LeetCode.
 */
async function loadDailyChallenge() {
  const titleEl = document.getElementById('daily-problem-title');
  const badgeEl = document.getElementById('daily-diff-badge');
  const launchBtn = document.getElementById('daily-launch-btn');

  try {
    const daily = await LeetCodeAPI.getDailyChallenge();
    if (daily) {
      titleEl.innerText = `${daily.title}`;
      titleEl.href = daily.url;
      badgeEl.innerText = daily.difficulty;
      badgeEl.className = `diff-tag ${daily.difficulty}`;
      launchBtn.href = daily.url;
    }
  } catch (err) {
    titleEl.innerText = '#1 Two Sum';
    titleEl.href = 'https://leetcode.com/problems/two-sum/';
    badgeEl.innerText = 'Easy';
    badgeEl.className = 'diff-tag Easy';
    launchBtn.href = 'https://leetcode.com/problems/two-sum/';
  }
}

/**
 * Load Selected Roadmap (Blind 75 or NeetCode 150).
 */
async function loadRoadmap(type = 'blind75') {
  currentRoadmapType = type;
  const fileName = type === 'neetcode150' ? 'neetcode150.json' : 'blind75.json';
  
  const select = document.getElementById('roadmap-type-select');
  if (select) select.value = type;

  try {
    const response = await fetch(chrome.runtime.getURL(`assets/data/${fileName}`));
    currentRoadmapData = await response.json();
    renderRoadmapList(activeCategoryFilter);
    updateNextRecommendation();
  } catch (err) {
    console.error('[Popup] Failed to load roadmap dataset:', err);
  }
}

/**
 * Render Roadmap Problem List with Filters.
 */
function renderRoadmapList(category = 'all') {
  activeCategoryFilter = category;
  const container = document.getElementById('roadmap-items-list');
  if (!container) return;
  container.innerHTML = '';

  const filtered = category === 'all' 
    ? currentRoadmapData 
    : currentRoadmapData.filter(p => p.category === category || (p.category && p.category.includes(category)));

  let solvedInSet = 0;
  currentRoadmapData.forEach(p => {
    if (userSolvedSlugs.has(p.slug)) solvedInSet++;
  });

  // Update count, percentage, and progress bar
  const totalInSet = currentRoadmapData.length || 75;
  const pct = totalInSet > 0 ? Math.round((solvedInSet / totalInSet) * 100) : 0;
  const countEl = document.getElementById('blind75-count');
  const barEl = document.getElementById('blind75-bar');
  if (countEl) countEl.innerText = `${solvedInSet} / ${totalInSet} Solved (${pct}%)`;
  if (barEl) barEl.style.width = `${(solvedInSet / totalInSet) * 100}%`;

  if (!filtered || filtered.length === 0) {
    container.innerHTML = `
      <div class="roadmap-empty-state">
        <span class="empty-state-icon">🔍</span>
        <span class="empty-state-text">No problems found for "${category}"</span>
      </div>
    `;
    return;
  }

  filtered.forEach(p => {
    const isSolved = userSolvedSlugs.has(p.slug);
    const row = document.createElement('div');
    row.className = `roadmap-problem-row ${isSolved ? 'is-solved' : ''}`;
    row.innerHTML = `
      <div class="roadmap-row-left">
        <span class="roadmap-prob-id">#${p.id}</span>
        <span class="roadmap-prob-title">${p.title}</span>
        ${isSolved ? '<span class="solved-check-badge" title="Verified Solved on LeetCode">✓</span>' : ''}
      </div>
      <div class="roadmap-row-right">
        <span class="diff-tag ${p.difficulty}">${p.difficulty}</span>
        <button class="roadmap-action-btn btn-notes" data-prob-slug="${p.slug}" title="View Notes & Spaced Repetition" aria-label="View Notes">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/>
          </svg>
        </button>
        <a class="roadmap-action-btn btn-launch" href="https://leetcode.com/problems/${p.slug}/" target="_blank" title="Solve on LeetCode" aria-label="Solve on LeetCode">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 3h7v7M13 3L5 11"/>
          </svg>
        </a>
      </div>
    `;

    // Clicking problem title wrap or notes button opens drawer
    row.querySelector('.roadmap-prob-title')?.addEventListener('click', () => openProblemDrawer(p));
    row.querySelector('.btn-notes')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openProblemDrawer(p);
    });

    container.appendChild(row);
  });
}

/**
 * Update Next Recommendation Banner in Roadmap.
 */
function updateNextRecommendation() {
  const recTitle = document.getElementById('rec-prob-title');
  const recSub = document.getElementById('rec-prob-sub');
  const recBtn = document.getElementById('btn-launch-rec');
  if (!recTitle || !currentRoadmapData.length) return;

  const nextProb = currentRoadmapData.find(p => !userSolvedSlugs.has(p.slug)) || currentRoadmapData[0];
  if (nextProb) {
    recTitle.innerText = `NEXT FOR YOU: #${nextProb.id} ${nextProb.title}`;
    recSub.innerText = `${nextProb.difficulty} · ${nextProb.category}`;
    recBtn.onclick = () => window.open(`https://leetcode.com/problems/${nextProb.slug}/`, '_blank');
  }
}

/**
 * Open Problem Details Drawer.
 */
async function openProblemDrawer(problem) {
  const overlay = document.getElementById('problem-drawer-overlay');
  document.getElementById('drawer-prob-title').innerText = `#${problem.id} ${problem.title}`;
  document.getElementById('drawer-prob-diff').innerText = problem.difficulty;
  document.getElementById('drawer-prob-diff').className = `drawer-stat-val diff-tag ${problem.difficulty}`;
  document.getElementById('drawer-prob-cat').innerText = problem.category || 'Algorithms';

  const isSolved = userSolvedSlugs.has(problem.slug);
  document.getElementById('drawer-prob-status').innerText = isSolved ? 'Solved ✓' : 'Pending ⏳';
  document.getElementById('drawer-prob-status').style.color = isSolved ? 'var(--color-easy)' : 'var(--color-med)';

  // Load saved notes
  const notesKey = `notes_${problem.slug}`;
  const data = await chrome.storage.local.get(notesKey);
  const textarea = document.getElementById('drawer-notes-input');
  textarea.value = data[notesKey] || '';

  // Auto-save notes on input
  textarea.oninput = async (e) => {
    await chrome.storage.local.set({ [notesKey]: e.target.value });
  };

  // Launch link
  document.getElementById('drawer-launch-link').href = `https://leetcode.com/problems/${problem.slug}/`;

  // Schedule intervals
  document.querySelectorAll('.btn-interval').forEach(btn => {
    btn.onclick = async (e) => {
      const days = parseInt(e.target.dataset.days, 10);
      const dueDate = Date.now() + days * 24 * 60 * 60 * 1000;
      const schedData = await chrome.storage.local.get('review_schedule');
      const schedule = schedData.review_schedule || {};
      schedule[problem.slug] = { id: problem.id, title: problem.title, dueDate };
      await chrome.storage.local.set({ review_schedule: schedule });
      showToast(`Review scheduled for +${days} days!`);
    };
  });

  overlay.classList.add('open');
}

/**
 * Check if any spaced reviews are due today.
 */
function checkScheduledReviews(schedule) {
  const now = Date.now();
  const due = Object.entries(schedule).find(([slug, item]) => item.dueDate && item.dueDate <= now);
  const banner = document.getElementById('review-due-card');
  if (due && banner) {
    const item = due[1];
    banner.style.display = 'flex';
    document.getElementById('review-prob-title').innerText = `#${item.id} ${item.title}`;
    document.getElementById('btn-start-review').onclick = () => {
      window.open(`https://leetcode.com/problems/${due[0]}/`, '_blank');
    };
  }
}

// Duels & Realtime State
let activeDuelTimerInterval = null;
let duelLiveTimerSeconds = 0;
let squadPollTimer = null;

/**
 * Format seconds into MM:SS.
 */
function formatTimerDisplay(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Start live stopwatch timer for active duel.
 */
function startDuelTimer(startedAt) {
  if (activeDuelTimerInterval) clearInterval(activeDuelTimerInterval);
  const timerEl = document.getElementById('duel-live-timer');
  if (!timerEl) return;

  const startMs = startedAt ? Number(startedAt) : Date.now();

  function update() {
    const elapsed = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    timerEl.innerText = formatTimerDisplay(elapsed);
  }

  update();
  activeDuelTimerInterval = setInterval(update, 1000);
}

/**
 * Stop live duel timer.
 */
function stopDuelTimer() {
  if (activeDuelTimerInterval) {
    clearInterval(activeDuelTimerInterval);
    activeDuelTimerInterval = null;
  }
}

/**
 * Select a problem for the duel based on format option.
 */
async function getDuelProblemByFormat(format) {
  try {
    let dataset = [];
    if (format === 'random_blind75') {
      const resp = await fetch(chrome.runtime.getURL('assets/data/blind75.json'));
      dataset = await resp.json();
    } else if (format === 'random_neetcode150') {
      const resp = await fetch(chrome.runtime.getURL('assets/data/neetcode150.json'));
      dataset = await resp.json();
    } else if (format === 'random_easy') {
      const resp = await fetch(chrome.runtime.getURL('assets/data/neetcode150.json'));
      const all = await resp.json();
      dataset = all.filter(p => p.difficulty === 'Easy');
    } else if (format === 'random_hard') {
      const resp = await fetch(chrome.runtime.getURL('assets/data/neetcode150.json'));
      const all = await resp.json();
      dataset = all.filter(p => p.difficulty === 'Hard');
    } else if (format === 'daily') {
      const daily = await LeetCodeAPI.getDailyChallenge();
      if (daily) return daily;
    }

    if (dataset && dataset.length > 0) {
      const randIdx = Math.floor(Math.random() * dataset.length);
      return dataset[randIdx];
    }
  } catch (err) {
    console.warn('[Duels] Problem selection fallback:', err);
  }

  return {
    id: 1,
    title: 'Two Sum',
    slug: 'two-sum',
    difficulty: 'Easy',
    category: 'Arrays & Hashing',
  };
}

/**
 * Format timestamp into relative time string.
 */
function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - Number(timestamp)) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Render Squad Leaderboard, Challenge Module, and Timeline Feed.
 */
async function renderSquadView() {
  const codeEl = document.getElementById('squad-room-code');
  const listEl = document.getElementById('squad-members-list');
  const feedEl = document.getElementById('squad-activity-feed');
  const manageBtn = document.getElementById('btn-toggle-manage-squad');
  const manageBanner = document.getElementById('squad-manage-banner');
  if (codeEl) codeEl.innerText = currentSquadCode || '—';

  if (!currentSquadCode) {
    if (manageBtn) manageBtn.style.display = 'none';
    if (manageBanner) manageBanner.style.display = 'none';
    if (listEl) {
      listEl.innerHTML = `
        <div class="timeline-empty-notice" style="padding: 24px 12px; text-align: center;">
          <div style="font-size: 22px; margin-bottom: 8px;">👥</div>
          <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 4px; font-size: 13px;">No Active Squad Room</div>
          <div style="font-size: 11px; color: var(--text-muted); line-height: 1.4;">Click <strong>+ New</strong> above to create your squad room, or join your friends with a room code below.</div>
        </div>
      `;
    }
    if (feedEl) {
      feedEl.innerHTML = '<div class="timeline-empty-notice">Join or create a squad to see activity.</div>';
    }
    const oppSelect = document.getElementById('duel-opponent-select');
    if (oppSelect) {
      oppSelect.innerHTML = '<option value="">Join a squad to challenge mates...</option>';
    }
    return;
  }

  try {
    let squad = await FirebaseSquads.fetchRemoteSquad(currentSquadCode);
    if (!squad) {
      currentSquadCode = '';
      await chrome.storage.local.remove(['my_squad_code']);
      showToast('Squad room no longer exists.');
      await renderSquadView();
      return;
    }

    // Check if current user is in members list
    const inSquad = (squad.members || []).some(
      m => (m.username || '').toLowerCase() === (currentUsername || '').toLowerCase()
    );

    if (!inSquad) {
      currentSquadCode = '';
      await chrome.storage.local.remove(['my_squad_code']);
      showToast('You are no longer in that squad room.');
      await renderSquadView();
      return;
    }

    const members = squad.members || [];
    members.sort((a, b) => (b.todaySolved || 0) - (a.todaySolved || 0) || (b.streak || 0) - (a.streak || 0));

    const squadOwner = (squad.owner || squad.members[0]?.username || currentUsername).trim().toLowerCase();
    const isMeLeader = squadOwner === currentUsername.trim().toLowerCase();

    // Show/hide and update Manage Squad button & banner
    const manageBtn = document.getElementById('btn-toggle-manage-squad');
    const manageBanner = document.getElementById('squad-manage-banner');
    if (manageBtn) {
      if (isMeLeader && members.length > 1) {
        manageBtn.style.display = 'inline-block';
        manageBtn.innerText = isSquadManageMode ? '✓ Done' : '✏️ Edit Squad';
        manageBtn.classList.toggle('active', isSquadManageMode);
        if (manageBanner) manageBanner.style.display = isSquadManageMode ? 'flex' : 'none';
      } else {
        manageBtn.style.display = 'none';
        if (manageBanner) manageBanner.style.display = 'none';
        isSquadManageMode = false;
      }
    }

    // 1. Render Squad Challenge Module
    const targetSolves = squad.challenge?.target || 5;
    const challengeTitle = squad.challenge?.title || 'Solve 5 Medium problems this week';
    const currentProgress = Math.min(targetSolves, squad.challenge?.progress || 0);
    const rewardXp = squad.challenge?.rewardXp || 150;
    const category = squad.challenge?.category || 'General';
    const isComplete = currentProgress >= targetSolves;
    const pct = Math.min(100, Math.round((currentProgress / targetSolves) * 100));

    const categoryIcons = {
      'trees': '🌳 Trees',
      'tree': '🌳 Trees',
      'tries': '🌲 Tries',
      'graphs': '🕸️ Graphs',
      'graph': '🕸️ Graphs',
      'advanced graphs': '🕸️ Adv Graphs',
      '1-d dp': '📊 1-D DP',
      '2-d dp': '📈 2-D DP',
      'dp': '📊 DP',
      'stack': '🥞 Stack',
      'heap / priority queue': '⛰️ Heap / PQ',
      'heap': '⛰️ Heap',
      'binary search': '🔍 Binary Search',
      'sliding window': '🪟 Sliding Window',
      'two pointers': '✨ Two Pointers',
      'two pointer': '✨ Two Pointers',
      'linked list': '🔗 Linked List',
      'backtracking': '🧩 Backtracking',
      'greedy': '⚡ Greedy',
      'intervals': '⏱️ Intervals',
      'math & geometry': '📐 Math',
      'bit manipulation': '💻 Bit Manipulation',
      'arrays & hashing': '📦 Arrays & Hash',
      'blind 75': '🎯 Blind 75',
      'neetcode 150': '🏆 NeetCode 150',
      'streak': '🔥 Streak Sprint',
      'sprint': '⚡ Team Sprint',
      'easy': '🟢 Easy Sprint',
      'medium': '🟡 Medium Sprint',
      'hard': '🔴 Hard Boss',
    };
    const catKey = category.toLowerCase().trim();
    const catDisplay = categoryIcons[catKey] || `🎯 ${category}`;

    const titleEl = document.getElementById('squad-challenge-title');
    const targetEl = document.getElementById('squad-challenge-target');
    const barEl = document.getElementById('squad-challenge-bar');
    const rewardEl = document.getElementById('squad-challenge-reward');
    const catEl = document.getElementById('squad-challenge-cat');
    const pctEl = document.getElementById('challenge-pct-text');
    const cycleNoteEl = document.getElementById('challenge-cycle-note');

    if (titleEl) titleEl.innerText = challengeTitle;
    if (rewardEl) rewardEl.innerText = `⭐ +${rewardXp} XP`;
    if (catEl) {
      catEl.innerText = catDisplay;
      catEl.dataset.category = category;
    }
    if (targetEl) {
      targetEl.innerText = `${currentProgress} / ${targetSolves}`;
      targetEl.classList.toggle('complete', isComplete);
    }
    if (barEl) {
      barEl.style.width = `${pct}%`;
      barEl.classList.toggle('complete', isComplete);
    }
    if (pctEl) {
      pctEl.innerText = isComplete ? '✓ 100% Cleared!' : `${pct}% Complete`;
      pctEl.style.color = isComplete ? 'var(--color-easy)' : 'var(--text-secondary)';
    }
    if (cycleNoteEl) {
      cycleNoteEl.innerText = isComplete ? 'Rotating to new challenge... 🎁' : 'Cycles automatically on finish ⚡';
    }

    // 2. Render Leaderboard Rows with Clean View / Edit Mode Toggle
    listEl.innerHTML = '';
    members.forEach((m, idx) => {
      const row = document.createElement('div');
      const isLeader = (m.username || '').trim().toLowerCase() === squadOwner;
      const isMe = (m.username || '').toLowerCase() === currentUsername.toLowerCase();
      row.className = `leaderboard-member-row ${isMe ? 'is-current' : ''}`;
      const isSolved = (m.todaySolved || 0) > 0;
      const rank = `#${idx + 1}`;

      let actionsHtml = '';
      if (isSquadManageMode && isMeLeader && !isMe) {
        actionsHtml = `<button class="lb-kick-btn btn-kick-action" data-user="${m.username}" title="Remove @${m.username}">✕ Remove</button>`;
      } else {
        actionsHtml = `
          <span class="lb-status-pill ${isSolved ? 'done' : 'pending'}">
            ${isSolved ? '✓ Solved' : 'Pending'}
          </span>
          ${!isMe ? `<button class="btn-nudge-action" data-user="${m.username}" title="Nudge @${m.username}">👋</button>` : ''}
        `;
      }

      row.innerHTML = `
        <div class="lb-col-player-wrap">
          <span class="lb-col-rank">${rank}</span>
          <span class="lb-player-name" title="@${m.username}">@${m.username}</span>
          ${isLeader ? '<span class="lb-leader-tag">👑 Leader</span>' : ''}
          ${isMe ? '<span class="lb-you-tag">You</span>' : ''}
        </div>
        <div class="lb-col-metrics-wrap">
          <span class="lb-col-streak">🔥 ${m.streak || 0}d</span>
          ${actionsHtml}
        </div>
      `;

      listEl.appendChild(row);
    });

    // Populate Opponent dropdown on Duels view
    const oppSelect = document.getElementById('duel-opponent-select');
    if (oppSelect) {
      const currentSelected = oppSelect.value;
      oppSelect.innerHTML = '<option value="">Select a squad mate...</option>';
      members.forEach(m => {
        if ((m.username || '').toLowerCase() !== currentUsername.toLowerCase()) {
          const opt = document.createElement('option');
          opt.value = m.username;
          opt.innerText = `@${m.username} (${m.streak || 0}d streak)`;
          if (m.username === currentSelected) opt.selected = true;
          oppSelect.appendChild(opt);
        }
      });
    }

    // Wire up Leader Kick Member Buttons
    listEl.querySelectorAll('.btn-kick-action').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const target = e.currentTarget.dataset.user;
        if (confirm(`Remove @${target} from the squad?`)) {
          try {
            await FirebaseSquads.kickMember(currentSquadCode, target, currentUsername);
            showToast(`Removed @${target} from the squad 🚫`);
            await renderSquadView();
          } catch (err) {
            showToast(err.message || 'Could not remove member');
          }
        }
      });
    });

    // Wire up Nudge Buttons
    listEl.querySelectorAll('.btn-nudge-action').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const target = e.currentTarget.dataset.user;
        showToast(`Sent nudge to @${target}! 👋`);
        await FirebaseSquads.sendNudge(currentSquadCode, target, currentUsername);
        await renderSquadView();
      });
    });

    // 3. Render Activity Timeline Feed
    const feedEl = document.getElementById('squad-activity-feed');
    if (feedEl) {
      feedEl.innerHTML = '';
      const feed = squad.activityFeed || [];
      if (feed.length > 0) {
        feed.forEach(item => {
          const el = document.createElement('div');
          el.className = 'timeline-event-item';
          const timeAgo = formatTimeAgo(item.timestamp);
          el.innerHTML = `
            <span class="event-text">${item.text}</span>
            <span class="event-time">${timeAgo}</span>
          `;
          feedEl.appendChild(el);
        });
      } else {
        feedEl.innerHTML = '<div class="timeline-empty-notice">No recent squad activity.</div>';
      }
    }
  } catch (err) {
    console.error('[Squad] Render error:', err);
  }
}

/**
 * Render 1v1 Duels View (Setup, ALL Incoming Invites, Active HUD, Results).
 */
async function renderDuelsView() {
  await loadDuelStats();

  const setupForm = document.getElementById('duel-setup-form');
  const activeBox = document.getElementById('active-duel-box');
  const resultBox = document.getElementById('duel-result-box');
  const incomingContainer = document.getElementById('incoming-duels-container');

  function applyDuelState(active, incomingList) {
    // 1. Render all incoming duel invitations on Duels page
    if (incomingContainer) {
      const incomingIds = (incomingList || []).map(i => i.id).join(',');
      const currentIds = incomingContainer.dataset.renderedIds || '';

      if (incomingIds !== currentIds) {
        incomingContainer.dataset.renderedIds = incomingIds;
        incomingContainer.innerHTML = '';
        if (incomingList && incomingList.length > 0) {
          incomingList.forEach(incoming => {
            const card = document.createElement('div');
            card.className = 'incoming-duel-banner';
            const diff = incoming.problem?.difficulty || 'Medium';
            const formatDisplay = (incoming.format || 'random_blind75').replace(/_/g, ' ').toUpperCase();

            card.innerHTML = `
              <div class="incoming-duel-header">
                <span class="incoming-badge">⚔️ INCOMING CHALLENGE FROM @${incoming.challenger}</span>
                <span class="diff-tag ${diff}">${diff}</span>
              </div>
              <div class="incoming-duel-body">
                <div class="incoming-duel-text" style="font-weight: 700;">🔒 Problem Hidden (Reveals on Accept)</div>
                <div class="incoming-prob-sub">${incoming.problem?.category || 'Algorithms'} · ${formatDisplay}</div>
              </div>
              <div class="incoming-actions" style="margin-top: 8px;">
                <button class="btn-cta-solve btn-accept-duel" data-duel-id="${incoming.id}" style="flex: 1; padding: 6px; justify-content: center; font-size: 11px;">Accept ⚔️</button>
                <button class="btn-secondary-flat btn-decline-duel" data-duel-id="${incoming.id}" style="padding: 6px 12px; font-size: 11px; color: var(--color-hard);">Decline</button>
              </div>
            `;
            incomingContainer.appendChild(card);
          });

          // Wire accept buttons
          incomingContainer.querySelectorAll('.btn-accept-duel').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              const dId = e.currentTarget.dataset.duelId;
              showToast('Accepting duel match... ⚔️');
              incomingContainer.innerHTML = '';
              incomingContainer.dataset.renderedIds = '';
              await chrome.storage.local.remove(['incoming_duel']);
              const accepted = await FirebaseSquads.acceptDuel(dId, currentUsername);
              if (accepted) {
                await chrome.storage.local.set({ active_duel: accepted });
              }
              await renderDuelsView();
            });
          });

          // Wire decline buttons
          incomingContainer.querySelectorAll('.btn-decline-duel').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              const dId = e.currentTarget.dataset.duelId;
              showToast('Declined duel invitation');
              incomingContainer.innerHTML = '';
              incomingContainer.dataset.renderedIds = '';
              await chrome.storage.local.remove(['incoming_duel']);
              await FirebaseSquads.declineDuel(dId, currentUsername);
              await renderDuelsView();
            });
          });
        }
      }
    }

    // 2. Check active duel state
    if (active) {
      if (active.status === 'active') {
        // Clear incoming challenges completely since match is active
        if (incomingContainer) {
          incomingContainer.innerHTML = '';
          incomingContainer.dataset.renderedIds = '';
        }
        chrome.storage.local.remove(['incoming_duel']).catch(() => {});

        if (setupForm) setupForm.style.display = 'none';
        if (resultBox) resultBox.style.display = 'none';
        if (activeBox) activeBox.style.display = 'flex';

        // Problem revealed on match accept
        document.getElementById('active-duel-problem-title').innerText = `#${active.problem?.id || 1} ${active.problem?.title || 'Problem'}`;
        const diffEl = document.getElementById('active-duel-diff');
        if (diffEl) {
          diffEl.innerText = active.problem?.difficulty || 'Easy';
          diffEl.className = `diff-tag ${active.problem?.difficulty || 'Easy'}`;
        }

        const linkEl = document.getElementById('active-duel-link');
        if (linkEl) {
          const probSlug = active.problem?.slug || active.problem?.titleSlug || 'two-sum';
          const probUrl = active.problem?.url || `https://leetcode.com/problems/${probSlug}/`;
          linkEl.dataset.href = probUrl;
          linkEl.style.pointerEvents = 'auto';
          linkEl.style.cursor = 'pointer';
          linkEl.style.opacity = '1';
          linkEl.innerText = 'Open Problem ↗';
          linkEl.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') {
              chrome.tabs.create({ url: probUrl });
            } else {
              window.open(probUrl, '_blank');
            }
          };
        }

        const oppName = (active.challenger.toLowerCase() === currentUsername.toLowerCase()) ? active.opponent : active.challenger;
        const oppText = document.getElementById('active-duel-opponent-text');
        if (oppText) oppText.innerText = `@${oppName} is coding...`;

        startDuelTimer(active.startedAt || Date.now());
        return true;
      } else if (active.status === 'pending' && (active.challenger || '').toLowerCase() === currentUsername.toLowerCase()) {
        if (setupForm) setupForm.style.display = 'none';
        if (resultBox) resultBox.style.display = 'none';
        if (activeBox) activeBox.style.display = 'flex';

        // Problem concealed while pending accept
        document.getElementById('active-duel-problem-title').innerText = '🔒 Problem Hidden (Reveals on Accept)';
        const diffEl = document.getElementById('active-duel-diff');
        if (diffEl) {
          diffEl.innerText = `${active.problem?.difficulty || 'Medium'} (${(active.format || 'Blind 75').replace(/_/g, ' ')})`;
          diffEl.className = `diff-tag ${active.problem?.difficulty || 'Medium'}`;
        }
        const oppText = document.getElementById('active-duel-opponent-text');
        if (oppText) oppText.innerText = `Waiting for @${active.opponent} to accept...`;
        
        const linkEl = document.getElementById('active-duel-link');
        if (linkEl) {
          linkEl.removeAttribute('data-href');
          linkEl.style.pointerEvents = 'none';
          linkEl.style.opacity = '0.5';
          linkEl.innerText = '🔒 Reveals on Accept';
        }

        stopDuelTimer();
        const timerEl = document.getElementById('duel-live-timer');
        if (timerEl) timerEl.innerText = '00:00';
        return true;
      } else if (active.status === 'completed' || active.status === 'forfeited') {
        stopDuelTimer();
        // If there are fresh incoming challenges, show them instead of being locked on completed results
        if (incomingList && incomingList.length > 0) {
          if (setupForm) setupForm.style.display = 'none';
          if (activeBox) activeBox.style.display = 'none';
          if (resultBox) resultBox.style.display = 'none';
          return true;
        }

        if (setupForm) setupForm.style.display = 'none';
        if (activeBox) activeBox.style.display = 'none';
        if (resultBox) {
          resultBox.style.display = 'flex';
          const isWinner = (active.winner || '').toLowerCase() === currentUsername.toLowerCase();
          document.getElementById('duel-result-title').innerText = isWinner ? '🏆 VICTORY!' : '🥈 MATCH ENDED';
          document.getElementById('duel-result-title').style.color = isWinner ? 'var(--color-easy)' : 'var(--color-hard)';
          document.getElementById('duel-result-desc').innerText = isWinner
            ? `You defeated @${active.loser} on #${active.problem.id} ${active.problem.title}! +50 XP awarded.`
            : `@${active.winner} won the duel on #${active.problem.id} ${active.problem.title}. Good game! (+15 XP)`;
        }
        return true;
      }
    }

    // Default: Show Setup Form
    stopDuelTimer();
    if (setupForm) setupForm.style.display = 'flex';
    if (activeBox) activeBox.style.display = 'none';
    if (resultBox) resultBox.style.display = 'none';
    return false;
  }

  // 1. FAST PATH: Render instantly from local cache (0ms lag, no form flash or blinking)
  const local = await chrome.storage.local.get(['active_duel', 'incoming_duel']);
  const cachedIncoming = local.incoming_duel ? [local.incoming_duel] : [];
  if (local.active_duel || cachedIncoming.length > 0) {
    applyDuelState(local.active_duel, cachedIncoming);
  }

  // 2. NETWORK PATH: Revalidate with Cloud Firestore in background
  try {
    const duelStatus = await FirebaseSquads.checkDuelStatus(currentUsername, currentSquadCode);
    const active = duelStatus.activeDuel;
    const incomingList = duelStatus.incomingChallenges || [];

    await chrome.storage.local.set({ 
      active_duel: active || null,
      incoming_duel: incomingList[0] || null
    });
    applyDuelState(active, incomingList);
  } catch (err) {
    console.error('[Duels] Render error:', err);
  }
}

/**
 * Load Duel Record & Stats.
 */
async function loadDuelStats() {
  const data = await chrome.storage.local.get(['duel_wins', 'duel_matches']);
  const wins = data.duel_wins || 0;
  const matches = data.duel_matches || 0;
  const winrate = matches > 0 ? Math.round((wins / matches) * 100) : 0;

  const wEl = document.getElementById('duel-wins-count');
  const mEl = document.getElementById('duel-matches-count');
  const wrEl = document.getElementById('duel-winrate');

  if (wEl) wEl.innerText = wins;
  if (mEl) mEl.innerText = matches;
  if (wrEl) wrEl.innerText = `${winrate}%`;
}

/**
 * Show temporary toast notification.
 */
function showToast(text) {
  const toast = document.getElementById('toast-notice');
  if (!toast) return;
  toast.innerText = text;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2800);
}

/**
 * Dispatch a native Chrome desktop notification.
 */
function triggerDesktopNotification(title, message) {
  try {
    if (chrome.notifications && typeof chrome.notifications.create === 'function') {
      chrome.notifications.create(`leetsync_${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
        title: title || 'LeetSync Squads',
        message: message || 'Desktop notification active!',
        priority: 2,
        requireInteraction: false,
      }, (notificationId) => {
        if (chrome.runtime.lastError) {
          console.warn('[Notification] Chrome error:', chrome.runtime.lastError.message);
        }
      });
      return;
    }
  } catch (e) {
    console.warn('[Notification] Direct popup alert notice:', e);
  }

  // Fallback to background worker
  try {
    chrome.runtime.sendMessage({
      type: 'SEND_TEST_NOTIFICATION',
      title,
      message,
    }, () => {
      if (chrome.runtime.lastError) {
        // Silently consume to prevent unhandled port warning
      }
    });
  } catch (e) {
    // Ignore
  }
}

/**
 * Setup All Event Listeners.
 */
function setupEventListeners() {
  // Navigation Tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', async (e) => {
      const targetView = e.currentTarget.dataset.tab;
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));

      e.currentTarget.classList.add('active');
      const viewEl = document.getElementById(`view-${targetView}`);
      if (viewEl) viewEl.classList.add('active');

      if (targetView === 'squad') {
        await renderSquadView();
      } else if (targetView === 'duels') {
        await renderDuelsView();
      }
    });
  });

  // Onboarding OAuth / Token Buttons
  document.getElementById('btn-onboard-connect-oauth')?.addEventListener('click', () => {
    const authUrl = 'https://github.com/settings/tokens/new?description=LeetSync+Squads&scopes=repo';
    window.open(authUrl, '_blank');
    const statusEl = document.getElementById('onboard-status-msg');
    if (statusEl) {
      statusEl.innerText = 'Click "Generate token" on GitHub, then paste below to unlock!';
      statusEl.style.color = 'var(--accent-blue)';
    }
  });

  document.getElementById('btn-onboard-submit-token')?.addEventListener('click', () => {
    const token = document.getElementById('input-onboard-token').value;
    handleLinkToken(token);
  });

  // Theme Mode Switcher
  document.querySelectorAll('[data-set-theme]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const theme = e.currentTarget.dataset.setTheme;
      document.body.setAttribute('data-theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
      await chrome.storage.local.set({ theme_preference: theme });

      document.querySelectorAll('[data-set-theme]').forEach(b => {
        b.classList.toggle('active', b.dataset.setTheme === theme);
      });

      const label = theme === 'leetx' ? 'LeetX Neon ⚡' : (theme === 'dark' ? 'Dark 🌙' : 'Light ☀️');
      showToast(`Switched to ${label} mode`);
    });
  });

  // Notifications & Squad Privacy Toggles
  const notifToggle = document.getElementById('toggle-notifications');
  const squadNotifToggle = document.getElementById('toggle-squad-notifications');
  const shareSolvesToggle = document.getElementById('toggle-share-solves');

  chrome.storage.local.get([
    'notifications_enabled',
    'notify_squad_solves_enabled',
    'share_solves_enabled'
  ]).then(data => {
    if (notifToggle) notifToggle.checked = data.notifications_enabled !== false;
    if (squadNotifToggle) squadNotifToggle.checked = data.notify_squad_solves_enabled !== false;
    if (shareSolvesToggle) shareSolvesToggle.checked = data.share_solves_enabled !== false;
  });

  notifToggle?.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ notifications_enabled: e.target.checked });
    showToast(e.target.checked ? 'Desktop notifications enabled 🔔' : 'Desktop notifications muted 🔕');
  });

  squadNotifToggle?.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ notify_squad_solves_enabled: e.target.checked });
    showToast(e.target.checked ? 'Squad solve alerts enabled 🎉' : 'Squad solve alerts muted 🔕');
  });

  shareSolvesToggle?.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ share_solves_enabled: e.target.checked });
    showToast(e.target.checked ? 'Sharing solves with squad ✓' : 'Solve broadcasting paused');
  });

  // Test Desktop Notification (Direct native call)
  document.getElementById('btn-test-notification')?.addEventListener('click', () => {
    triggerDesktopNotification(
      '🔔 LeetSync Squads Notifications Active!',
      'Native desktop alerts are working on your browser!'
    );
    showToast('Sent native desktop alert 🔔');
  });

  // User Profile Settings Inputs
  document.getElementById('input-display-name')?.addEventListener('change', async (e) => {
    const val = e.target.value.trim();
    if (val) {
      await chrome.storage.local.set({ display_name: val });
      currentUsername = val;
      showToast(`Updated display name to ${val} 👤`);
    }
  });

  document.getElementById('input-leetcode-username')?.addEventListener('change', async (e) => {
    const val = e.target.value.trim();
    if (val) {
      await chrome.storage.local.set({ leetcode_username: val });
      showToast(`Saved LeetCode username: @${val} ⚡`);
      await fetchAndUpdateUserStats(val);
    }
  });

  // Sync All Solutions
  document.getElementById('btn-settings-sync-now')?.addEventListener('click', () => performSolutionSync('settings'));
  document.getElementById('btn-backfill-all')?.addEventListener('click', () => performSolutionSync('stats'));

  // Disconnect GitHub
  document.getElementById('btn-disconnect-github')?.addEventListener('click', async () => {
    await chrome.storage.local.remove(['github_token', 'github_repo_owner', 'github_repo_name']);
    showToast('GitHub disconnected');
    await checkAuthAndInitialize();
  });

  // Roadmap Dropdown Switcher (Blind 75 vs NeetCode 150)
  document.getElementById('roadmap-type-select')?.addEventListener('change', (e) => {
    loadRoadmap(e.target.value);
  });


  // Roadmap Category Filter Pills
  document.querySelectorAll('.cat-pill-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.cat-pill-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      renderRoadmapList(e.currentTarget.dataset.cat);
    });
  });

  // Squad Room Controls
  document.getElementById('btn-create-room')?.addEventListener('click', async () => {
    showToast('Generating unique room code... ⚡');
    const newCode = await FirebaseSquads.generateUniqueRoomCode();
    currentSquadCode = newCode;
    await chrome.storage.local.set({ my_squad_code: currentSquadCode });
    await FirebaseSquads.joinOrCreateSquad(currentSquadCode, {
      username: currentUsername,
      streak: currentStreak,
      todaySolved: currentTodaySolved,
      totalSolved: currentTodaySolved,
      xp: currentXP,
    });
    await renderSquadView();
    showToast(`Created Room ${currentSquadCode}! You are the Squad Leader 👑`);
  });

  document.getElementById('btn-join-squad')?.addEventListener('click', async () => {
    const input = document.getElementById('input-join-code');
    const code = input?.value.trim();
    if (code) {
      currentSquadCode = code.startsWith('#') ? code.toUpperCase() : `#${code.toUpperCase()}`;
      await chrome.storage.local.set({ my_squad_code: currentSquadCode });
      input.value = '';
      await FirebaseSquads.joinOrCreateSquad(currentSquadCode, {
        username: currentUsername,
        streak: currentStreak,
        todaySolved: currentTodaySolved,
        totalSolved: currentTodaySolved,
        xp: currentXP,
      });
      await renderSquadView();
      showToast(`Joined Squad ${currentSquadCode} 👥`);
    }
  });

  document.getElementById('btn-leave-squad')?.addEventListener('click', async () => {
    if (!currentSquadCode) {
      showToast('You are not currently in a squad room.');
      return;
    }
    if (confirm(`Are you sure you want to leave Squad ${currentSquadCode}?`)) {
      showToast('Leaving squad... 🚪');
      const leavingCode = currentSquadCode;
      currentSquadCode = '';
      await chrome.storage.local.remove(['my_squad_code']);
      await FirebaseSquads.leaveSquad(leavingCode, currentUsername);
      await renderSquadView();
      showToast('Left the squad room 👋');
    }
  });

  document.getElementById('btn-toggle-manage-squad')?.addEventListener('click', async () => {
    isSquadManageMode = !isSquadManageMode;
    await renderSquadView();
  });

  document.getElementById('btn-sync-squad')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync-squad');
    btn?.classList.add('is-refreshing');
    await renderSquadView();
    setTimeout(() => btn?.classList.remove('is-refreshing'), 600);
    showToast('Squad room refreshed 🔄');
  });

  document.getElementById('btn-copy-squad')?.addEventListener('click', () => {
    if (!currentSquadCode) {
      showToast('Create or join a squad first to copy room code!');
      return;
    }
    navigator.clipboard.writeText(currentSquadCode);
    const feedbackEl = document.getElementById('copy-feedback-text');
    if (feedbackEl) {
      feedbackEl.innerText = 'Copied ✓';
      setTimeout(() => { feedbackEl.innerText = 'Copy'; }, 1800);
    }
    showToast(`Copied ${currentSquadCode}! Share with friends 📋`);
  });

  // Dynamic Squad Challenge Reroll
  document.getElementById('btn-reroll-challenge')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-reroll-challenge');
    if (btn) {
      btn.disabled = true;
      btn.innerText = '⏳ Rolling...';
    }
    try {
      const nextChallenge = await FirebaseSquads.rerollSquadChallenge(currentSquadCode, currentUsername);
      await renderSquadView();
      if (nextChallenge) {
        showToast(`🎲 Challenge rotated: "${nextChallenge.title}"!`);
      }
    } catch (e) {
      showToast('Failed to rotate challenge');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerText = '🎲 Reroll';
      }
    }
  });

  // Dynamic Challenge Quick Solve Finder
  document.getElementById('btn-challenge-solve-quick')?.addEventListener('click', () => {
    const catEl = document.getElementById('squad-challenge-cat');
    const category = (catEl?.dataset.category || '').toLowerCase().trim();

    // Switch to Roadmap Tab
    const roadmapTabBtn = document.querySelector('.nav-tab[data-tab="roadmap"]');
    if (roadmapTabBtn) {
      roadmapTabBtn.click();
    }

    // Map challenge category to roadmap filter pill
    const categoryMap = {
      'trees': 'Trees',
      'tree': 'Trees',
      'tries': 'Tries',
      'graphs': 'Graphs',
      'graph': 'Graphs',
      'advanced graphs': 'Advanced Graphs',
      '1-d dp': '1-D DP',
      '2-d dp': '2-D DP',
      'dp': '1-D DP',
      'stack': 'Stack',
      'heap / priority queue': 'Heap / Priority Queue',
      'heap': 'Heap / Priority Queue',
      'binary search': 'Binary Search',
      'sliding window': 'Sliding Window',
      'two pointers': 'Two Pointers',
      'two pointer': 'Two Pointers',
      'linked list': 'Linked List',
      'backtracking': 'Backtracking',
      'greedy': 'Greedy',
      'intervals': 'Intervals',
      'math & geometry': 'Math & Geometry',
      'bit manipulation': 'Bit Manipulation',
      'arrays & hashing': 'Arrays & Hashing',
    };

    const targetCat = categoryMap[category] || 'all';
    const pill = document.querySelector(`.cat-pill-btn[data-cat="${targetCat}"]`);
    if (pill) {
      document.querySelectorAll('.cat-pill-btn').forEach(b => b.classList.remove('active'));
      pill.classList.add('active');
      renderRoadmapList(targetCat);
      showToast(`🎯 Filtered roadmap for ${targetCat}!`);
    } else {
      renderRoadmapList('all');
    }
  });

  // Clear Recent Activity Feed
  document.getElementById('btn-clear-activity-feed')?.addEventListener('click', async () => {
    const feedEl = document.getElementById('squad-activity-feed');
    if (feedEl) feedEl.innerHTML = '<div class="timeline-empty-notice">No recent squad activity.</div>';
    await FirebaseSquads.clearActivityFeed(currentSquadCode);
    showToast('Cleared squad activity feed 🧹');
  });

  // Duels Action Buttons
  document.getElementById('btn-start-duel')?.addEventListener('click', async () => {
    const oppSelect = document.getElementById('duel-opponent-select');
    const opponent = oppSelect?.value;
    if (!opponent) {
      showToast('Please select a squad mate to challenge! ⚔️');
      return;
    }

    const formatSelect = document.getElementById('duel-problem-select');
    const format = formatSelect?.value || 'random_blind75';

    showToast('Selecting duel problem... 🎲');
    const problem = await getDuelProblemByFormat(format);

    const duel = await FirebaseSquads.createDuel({
      roomCode: currentSquadCode,
      challenger: currentUsername,
      opponent: opponent,
      format: format,
      problem: problem,
    });

    showToast(`Challenge dispatched to @${opponent}! ⚔️`);
    await renderDuelsView();
  });

  document.getElementById('btn-cancel-duel')?.addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['active_duel']);
    if (data.active_duel) {
      await FirebaseSquads.forfeitDuel(data.active_duel.id, currentUsername);
      showToast('Match forfeited.');
      await renderDuelsView();
    }
  });

  document.getElementById('btn-dismiss-duel-result')?.addEventListener('click', async () => {
    await chrome.storage.local.remove(['active_duel', 'incoming_duel']);
    const setupForm = document.getElementById('duel-setup-form');
    const activeBox = document.getElementById('active-duel-box');
    const resultBox = document.getElementById('duel-result-box');
    if (resultBox) resultBox.style.display = 'none';
    if (activeBox) activeBox.style.display = 'none';
    if (setupForm) setupForm.style.display = 'flex';
    stopDuelTimer();
    showToast('Ready for a new match! ⚔️');
    await renderDuelsView();
  });

  // Reset Progress to 0
  document.getElementById('btn-reset-streak')?.addEventListener('click', async () => {
    await chrome.storage.local.set({ streak_count: 0, user_xp: 0, today_solved: 0 });
    currentStreak = 0;
    currentXP = 0;
    currentTodaySolved = 0;
    document.getElementById('header-streak-count').innerText = 0;
    document.getElementById('header-xp-val').innerText = 0;
    document.getElementById('momentum-streak-number').innerText = '0';
    document.getElementById('momentum-streak-desc').innerText = "Solve today's challenge to ignite your streak.";
    document.getElementById('today-status-text').innerText = 'Pending ⏳';
    document.getElementById('today-status-text').style.color = 'var(--color-med)';
    renderWeekStrip(0, false);
    await renderSquadView();
    showToast('Streak and XP reset to 0');
  });

  // Close Problem Drawer
  document.getElementById('btn-close-drawer')?.addEventListener('click', () => {
    document.getElementById('problem-drawer-overlay')?.classList.remove('open');
  });
  document.getElementById('problem-drawer-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'problem-drawer-overlay') {
      document.getElementById('problem-drawer-overlay')?.classList.remove('open');
    }
  });

  // Listen for real-time background sync and stat updates
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.sync_status) {
        renderSyncStatusUI(changes.sync_status.newValue);
        if (changes.sync_status.newValue?.state === 'idle') {
          loadStoredState();
        }
      }
      if (
        changes.user_solved_slugs ||
        changes.total_solved ||
        changes.solved_easy_count ||
        changes.solved_med_count ||
        changes.solved_hard_count ||
        changes.streak_count ||
        changes.today_solved ||
        changes.user_xp ||
        changes.leetcode_username
      ) {
        loadStoredState();
      }
    }
  });

  // Periodic Polling when popup is open
  squadPollTimer = setInterval(async () => {
    const activeTab = document.querySelector('.nav-tab.active')?.dataset.tab;
    if (activeTab === 'squad') {
      await renderSquadView();
    } else if (activeTab === 'duels') {
      await renderDuelsView();
    }
  }, 6000);
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  await applyStoredTheme();
  setupEventListeners();
  await checkAuthAndInitialize();

  // Check if background sync is currently running
  const statusData = await chrome.storage.local.get(['sync_status']);
  if (statusData.sync_status) {
    renderSyncStatusUI(statusData.sync_status);
  }
});

