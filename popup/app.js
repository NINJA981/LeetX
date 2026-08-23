/**
 * LeetSync Squads - Coding Progress Companion Engine
 * Gateway Architecture: Unlocks full application only after GitHub is connected.
 */

import { LeetCodeAPI } from '../scripts/leetcode.js';
import { GitHubAPI } from '../scripts/github.js';
import { FirebaseSquads } from '../scripts/firebase.js';

let currentRoadmapData = [];
let currentRoadmapType = 'blind75';
let userSolvedSlugs = new Set();
let currentUsername = 'NINJA981';
let activeDrawerProblem = null;

function getTodayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getYesterdayDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function showToast(msg) {
  const toast = document.getElementById('toast-notice');
  if (toast) {
    toast.innerText = msg;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 2200);
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  await checkAuthAndInitialize();
  setupEventListeners();
});

/**
 * Gatekeeper: Show Onboarding if not connected, else show Main App.
 */
async function checkAuthAndInitialize() {
  const data = await chrome.storage.local.get(['github_token', 'github_repo_owner']);
  const onboardingEl = document.getElementById('onboarding-container');
  const appEl = document.getElementById('app-container');

  if (!data.github_token) {
    // Show Onboarding Screen
    if (onboardingEl) onboardingEl.style.display = 'flex';
    if (appEl) appEl.style.display = 'none';
  } else {
    // Show Main App Screen
    if (onboardingEl) onboardingEl.style.display = 'none';
    if (appEl) appEl.style.display = 'flex';

    await loadStoredState();
    await syncLiveLeetCodeSession();
    await loadDailyChallenge();
    await loadRoadmap(currentRoadmapType);
    await checkDueReviews();
  }
}

/**
 * Setup Tab Navigation switching.
 */
function setupTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const views = document.querySelectorAll('.tab-view');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));

      tab.classList.add('active');
      const targetId = `view-${tab.dataset.tab}`;
      const targetView = document.getElementById(targetId);
      if (targetView) targetView.classList.add('active');
    });
  });
}

/**
 * Load persisted user stats, streak, squad, and GitHub config.
 */
async function loadStoredState() {
  const data = await chrome.storage.local.get([
    'display_name',
    'github_token',
    'github_repo_owner',
    'github_repo_name',
    'github_branch',
    'firebase_project_id',
    'streak_count',
    'today_solved',
    'user_xp',
    'last_solved_date',
    'my_squad_code',
    'user_solved_slugs',
    'solved_easy_count',
    'solved_med_count',
    'solved_hard_count',
    'total_solved',
    'duel_wins',
    'duel_played',
  ]);

  currentUsername = data.display_name || data.github_repo_owner || 'NINJA981';
  document.getElementById('input-display-name').value = currentUsername;

  if (data.user_solved_slugs && Array.isArray(data.user_solved_slugs)) {
    userSolvedSlugs = new Set(data.user_solved_slugs);
  }

  // Daily Rollover Check
  const today = getTodayDateStr();
  const yesterday = getYesterdayDateStr();
  let streak = data.streak_count || 0;
  let todaySolved = data.today_solved || 0;
  const lastDate = data.last_solved_date;

  if (lastDate) {
    if (lastDate !== today && lastDate !== yesterday) {
      streak = 0;
      todaySolved = 0;
      await chrome.storage.local.set({ streak_count: 0, today_solved: 0 });
    } else if (lastDate === yesterday) {
      todaySolved = 0;
      await chrome.storage.local.set({ today_solved: 0 });
    }
  }

  let xp = data.user_xp || 0;
  if (xp >= 1000 || !data.last_solved_date) {
    xp = 0;
    await chrome.storage.local.set({ user_xp: 0 });
  }

  // Header badges
  document.getElementById('header-streak-count').innerText = streak;
  document.getElementById('header-xp-val').innerText = xp.toLocaleString();

  // Hero Momentum Headline
  const streakNum = document.getElementById('momentum-streak-number');
  const streakDesc = document.getElementById('momentum-streak-desc');
  const statusText = document.getElementById('today-status-text');

  streakNum.innerText = streak;
  if (streak === 0) {
    streakDesc.innerText = "Solve today's challenge to ignite your streak.";
  } else {
    streakDesc.innerText = todaySolved > 0 ? "You're all done for today! Momentum preserved." : "Keep the flame burning. Complete today's problem.";
  }

  if (todaySolved > 0) {
    statusText.innerText = 'Completed ✓';
    statusText.style.color = 'var(--color-easy)';
  } else {
    statusText.innerText = 'Pending ⏳';
    statusText.style.color = 'var(--color-med)';
  }

  renderWeekStrip(streak, todaySolved > 0);

  // Global Solved Distribution Donut across all LeetCode
  const easy = data.solved_easy_count || 0;
  const med = data.solved_med_count || 0;
  const hard = data.solved_hard_count || 0;
  renderDonutDistribution(easy, med, hard);

  // GitHub Connection State
  const repoNameEl = document.getElementById('sync-repo-name');
  const indicator = document.getElementById('github-sync-indicator');
  const activeRepoInput = document.getElementById('input-active-repo');

  if (data.github_token && data.github_repo_owner && data.github_repo_name) {
    repoNameEl.innerText = `${data.github_repo_owner}/${data.github_repo_name}`;
    indicator.innerText = '● Connected';
    indicator.style.color = 'var(--color-easy)';
    if (activeRepoInput) activeRepoInput.value = `${data.github_repo_owner}/${data.github_repo_name}`;
  }

  // Squad State
  const squadCode = data.my_squad_code || '#ALGO99';
  document.getElementById('squad-room-code').innerText = squadCode;
  await renderSquad(squadCode, streak, todaySolved, xp);

  // Duel stats
  const wins = data.duel_wins || 0;
  const played = data.duel_played || 0;
  document.getElementById('duel-wins-count').innerText = wins;
  document.getElementById('duel-matches-count').innerText = played;
  document.getElementById('duel-winrate').innerText = played > 0 ? `${Math.round((wins / played) * 100)}%` : '0%';
}

/**
 * Render 7-day activity week strip (Mon-Sun).
 */
function renderWeekStrip(streak, isTodaySolved) {
  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7; // 0=Mon, 6=Sun

  for (let i = 0; i < 7; i++) {
    const dot = document.getElementById(`dot-day-${i}`);
    if (!dot) continue;

    dot.className = 'day-circle';
    dot.innerText = '';

    if (i === dayOfWeek) {
      dot.classList.add('today-ring');
      if (isTodaySolved) {
        dot.classList.add('done');
        dot.innerText = '✓';
      }
    } else if (i < dayOfWeek && i >= dayOfWeek - streak + (isTodaySolved ? 1 : 0)) {
      dot.classList.add('done');
      dot.innerText = '✓';
    }
  }
}

/**
 * Render SVG Donut Chart for Solved Problem Distribution.
 */
function renderDonutDistribution(easy = 0, med = 0, hard = 0) {
  const total = easy + med + hard;
  document.getElementById('donut-total-count').innerText = total;
  document.getElementById('total-solved-meta').innerText = `${total} Solved`;
  document.getElementById('count-easy').innerText = easy;
  document.getElementById('count-med').innerText = med;
  document.getElementById('count-hard').innerText = hard;

  const easyEl = document.getElementById('donut-easy');
  const medEl = document.getElementById('donut-med');
  const hardEl = document.getElementById('donut-hard');

  if (total === 0) {
    easyEl.setAttribute('stroke-dasharray', '0 100');
    medEl.setAttribute('stroke-dasharray', '0 100');
    hardEl.setAttribute('stroke-dasharray', '0 100');
    return;
  }

  const easyPct = (easy / total) * 100;
  const medPct = (med / total) * 100;
  const hardPct = (hard / total) * 100;

  easyEl.setAttribute('stroke-dasharray', `${easyPct} ${100 - easyPct}`);
  easyEl.setAttribute('stroke-dashoffset', '0');

  medEl.setAttribute('stroke-dasharray', `${medPct} ${100 - medPct}`);
  medEl.setAttribute('stroke-dashoffset', `${-easyPct}`);

  hardEl.setAttribute('stroke-dasharray', `${hardPct} ${100 - hardPct}`);
  hardEl.setAttribute('stroke-dashoffset', `${-(easyPct + medPct)}`);
}

/**
 * Fetch and sync authentic user solved counts directly from active LeetCode session.
 */
async function syncLiveLeetCodeSession() {
  try {
    const userStatus = await LeetCodeAPI.getCurrentUser();
    if (userStatus && userStatus.isSignedIn && userStatus.username) {
      const stats = await LeetCodeAPI.getUserStats(userStatus.username);
      if (stats) {
        const easy = stats.easySolved || 0;
        const med = stats.mediumSolved || 0;
        const hard = stats.hardSolved || 0;
        const total = stats.totalSolved || (easy + med + hard);

        await chrome.storage.local.set({
          solved_easy_count: easy,
          solved_med_count: med,
          solved_hard_count: hard,
          total_solved: total,
        });

        renderDonutDistribution(easy, med, hard);
      }
    }
  } catch (err) {
    console.warn('[Popup] LeetCode session check notice:', err.message);
  }
}

/**
 * Fetch and display LeetCode's Daily Problem or next recommended problem.
 */
async function loadDailyChallenge() {
  try {
    const daily = await LeetCodeAPI.getDailyChallenge();
    if (daily && daily.question) {
      document.getElementById('daily-problem-title').innerText = `#${daily.question.questionFrontendId} · ${daily.question.title}`;
      const badge = document.getElementById('daily-diff-badge');
      const diff = daily.question.difficulty || 'Medium';
      badge.innerText = diff;
      badge.className = `diff-tag ${diff}`;

      const launchBtn = document.getElementById('daily-launch-btn');
      launchBtn.href = daily.link;
    }
  } catch (err) {
    document.getElementById('daily-problem-title').innerText = 'Explore Problemset';
    document.getElementById('daily-launch-btn').href = 'https://leetcode.com/problemset/';
  }
}

/**
 * Check and surface Due Problem Reviews.
 */
async function checkDueReviews() {
  const data = await chrome.storage.local.get(['problem_reviews']);
  const reviews = data.problem_reviews || [];
  const now = Date.now();
  const due = reviews.find(r => r.dueTimestamp <= now);

  const banner = document.getElementById('review-due-card');
  if (due && banner) {
    banner.style.display = 'flex';
    document.getElementById('review-prob-title').innerText = `#${due.id} ${due.title}`;
    document.getElementById('btn-start-review').onclick = () => {
      openProblemDrawer(due);
    };
  } else if (banner) {
    banner.style.display = 'none';
  }
}

/**
 * Load Selected Roadmap (Blind 75 or NeetCode 150).
 */
async function loadRoadmap(type = 'blind75') {
  currentRoadmapType = type;
  const fileName = type === 'neetcode150' ? 'neetcode150.json' : 'blind75.json';
  try {
    const response = await fetch(chrome.runtime.getURL(`assets/data/${fileName}`));
    currentRoadmapData = await response.json();
    renderRoadmapList('all');
    updateNextRecommendation();
  } catch (err) {
    console.error('[Popup] Failed to load roadmap dataset:', err);
  }
}

/**
 * Deterministic Next Problem Recommendation Rule.
 */
function updateNextRecommendation() {
  if (currentRoadmapData.length === 0) return;
  const nextUnsolved = currentRoadmapData.find(p => !userSolvedSlugs.has(p.slug)) || currentRoadmapData[0];
  
  const recBox = document.getElementById('next-rec-box');
  if (recBox && nextUnsolved) {
    document.getElementById('rec-prob-title').innerText = `NEXT FOR YOU: #${nextUnsolved.id} ${nextUnsolved.title}`;
    document.getElementById('rec-prob-sub').innerText = `${nextUnsolved.difficulty} · ${nextUnsolved.category}`;
    document.getElementById('btn-launch-rec').onclick = () => {
      window.open(`https://leetcode.com/problems/${nextUnsolved.slug}/`, '_blank');
    };
  }
}

function renderRoadmapList(categoryFilter = 'all') {
  const container = document.getElementById('roadmap-items-list');
  container.innerHTML = '';

  const filtered = categoryFilter === 'all'
    ? currentRoadmapData
    : currentRoadmapData.filter(item => item.category === categoryFilter || (categoryFilter === 'Arrays & Hashing' && item.category === 'Arrays'));

  let solvedCount = 0;

  filtered.forEach(prob => {
    const itemEl = document.createElement('div');
    itemEl.className = 'roadmap-item-row';
    const isSolved = userSolvedSlugs.has(prob.slug);
    if (isSolved) solvedCount++;

    itemEl.innerHTML = `
      <div class="item-left-desc">
        <span class="item-id-tag">#${prob.id}</span>
        <span class="item-title-text">${prob.title}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
        ${isSolved ? '<span style="color: var(--color-easy); font-size: 11px; font-weight: 600; font-family: var(--font-mono);">✓ Solved</span>' : ''}
        <span class="diff-tag ${prob.difficulty}">${prob.difficulty}</span>
      </div>
    `;

    // Click to open progressive disclosure drawer
    itemEl.addEventListener('click', () => {
      openProblemDrawer(prob);
    });

    container.appendChild(itemEl);
  });

  const total = currentRoadmapData.length;
  const pct = total > 0 ? Math.round((solvedCount / total) * 100) : 0;
  document.getElementById('blind75-bar').style.width = `${pct}%`;
  document.getElementById('blind75-count').innerText = `${solvedCount} / ${total} Solved (${pct}%)`;
}

/**
 * Open Problem Detail Drawer (Progressive Disclosure).
 */
async function openProblemDrawer(prob) {
  activeDrawerProblem = prob;
  const overlay = document.getElementById('problem-drawer-overlay');
  document.getElementById('drawer-prob-title').innerText = `#${prob.id} ${prob.title}`;
  document.getElementById('drawer-prob-diff').innerText = prob.difficulty || 'Medium';
  document.getElementById('drawer-prob-cat').innerText = prob.category || 'General';
  
  const isSolved = userSolvedSlugs.has(prob.slug);
  document.getElementById('drawer-prob-status').innerText = isSolved ? '✓ Solved' : 'Unsolved';
  document.getElementById('drawer-launch-link').href = `https://leetcode.com/problems/${prob.slug}/`;

  // Load saved note
  const notesData = await chrome.storage.local.get(['problem_notes']);
  const notes = notesData.problem_notes || {};
  document.getElementById('drawer-notes-input').value = notes[prob.slug] || '';

  overlay.style.display = 'flex';
}

/**
 * Render Squad Leaderboard and Activity Stream.
 */
async function renderSquad(squadCode, currentStreak = 0, currentTodaySolved = 0, currentXP = 0) {
  const stored = await chrome.storage.local.get([
    `squad_${squadCode}`,
    'display_name',
    'github_repo_owner',
  ]);

  const username = stored.display_name || stored.github_repo_owner || currentUsername || 'NINJA981';
  const rawSquad = await FirebaseSquads.joinOrCreateSquad(squadCode, {
    username,
    streak: currentStreak,
    todaySolved: currentTodaySolved,
    totalSolved: currentTodaySolved,
    xp: currentXP,
  });

  // Strict deduplication & filter out ghost usernames
  const memberMap = new Map();
  (rawSquad.members || []).forEach(m => {
    if (!m.username || m.username === 'undefined' || m.username === 'null' || m.username === 'You') return;
    if (m.username.startsWith('AH0C') && username !== m.username) return;

    memberMap.set(m.username, m);
  });

  memberMap.set(username, {
    username,
    streak: currentStreak,
    todaySolved: currentTodaySolved,
    totalSolved: currentTodaySolved,
    xp: currentXP,
    lastActive: Date.now(),
    status: 'online',
  });

  const members = Array.from(memberMap.values());
  members.sort((a, b) => (b.todaySolved || 0) - (a.todaySolved || 0) || (b.streak || 0) - (a.streak || 0));

  // Populate leaderboard
  const listEl = document.getElementById('squad-members-list');
  listEl.innerHTML = '';

  members.forEach((m, idx) => {
    const row = document.createElement('div');
    row.className = `leaderboard-member-row ${m.username === username ? 'is-current' : ''}`;
    const isSolved = (m.todaySolved || 0) > 0;
    const rankNum = String(idx + 1).padStart(2, '0');

    row.innerHTML = `
      <div class="member-left-side">
        <span class="member-rank-num">${rankNum}</span>
        <span class="member-handle">@${m.username}</span>
        <span class="member-streak-flame">🔥 ${m.streak || 0}d</span>
      </div>
      <div class="member-right-side">
        <span class="status-pill-mini ${isSolved ? 'done' : 'pending'}">${isSolved ? '✓ Done' : '⏳ Pending'}</span>
        ${!isSolved && m.username !== username ? `<button class="btn-nudge-mini" data-user="${m.username}" title="Nudge">👋</button>` : ''}
      </div>
    `;
    listEl.appendChild(row);
  });

  // Attach Nudge events
  document.querySelectorAll('.btn-nudge-mini').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const targetUser = e.currentTarget.dataset.user;
      await FirebaseSquads.sendNudge(squadCode, username, targetUser, '👋');
      btn.innerText = '✨';
      showToast(`Nudged @${targetUser}!`);
      setTimeout(() => renderSquad(squadCode, currentStreak, currentTodaySolved, currentXP), 400);
    });
  });

  // Populate Activity Feed
  const feedEl = document.getElementById('squad-activity-feed');
  feedEl.innerHTML = '';
  const activities = (rawSquad.activityFeed || []).filter(a => !a.text.includes('AH0C') && !a.text.includes('You')).slice(0, 5);

  if (activities.length === 0) {
    feedEl.innerHTML = `<div class="activity-bubble">● ${username} joined the squad · just now</div>`;
  } else {
    activities.forEach(act => {
      const item = document.createElement('div');
      item.className = 'activity-bubble';
      item.innerText = `● ${act.text}`;
      feedEl.appendChild(item);
    });
  }

  // Populate Duel Opponents (Strictly exclude self!)
  const opponentSelect = document.getElementById('duel-opponent-select');
  if (opponentSelect) {
    opponentSelect.innerHTML = '<option value="">Select a squad mate...</option>';
    let peerCount = 0;
    members.forEach(m => {
      if (m.username !== username && m.username !== 'You') {
        peerCount++;
        const opt = document.createElement('option');
        opt.value = m.username;
        opt.innerText = `@${m.username} (🔥 ${m.streak || 0}d)`;
        opponentSelect.appendChild(opt);
      }
    });

    if (peerCount === 0) {
      opponentSelect.innerHTML = '<option value="">No other peers in room (Share #CODE)</option>';
    }
  }
}

/**
 * Handle Onboarding Token Link & Repo Auto-Creation.
 */
async function handleLinkToken(token) {
  const statusEl = document.getElementById('onboard-status-msg');
  if (!token || !token.trim()) {
    if (statusEl) {
      statusEl.innerText = 'Please enter a valid GitHub token.';
      statusEl.style.color = 'var(--color-hard)';
    }
    return;
  }

  token = token.trim();
  if (statusEl) {
    statusEl.innerText = 'Verifying GitHub account & setting up repository...';
    statusEl.style.color = 'var(--text-secondary)';
  }

  try {
    const gh = new GitHubAPI(token);
    const { owner, isNew } = await gh.ensureRepository('leetcode-submissions');

    await chrome.storage.local.set({
      github_token: token,
      github_repo_owner: owner,
      github_repo_name: 'leetcode-submissions',
      github_branch: 'main',
      display_name: owner,
    });

    showToast(`✓ Welcome @${owner}!`);
    await checkAuthAndInitialize();
  } catch (err) {
    console.error('Connection error:', err);
    if (statusEl) {
      statusEl.innerText = `Error: ${err.message}`;
      statusEl.style.color = 'var(--color-hard)';
    }
  }
}

/**
 * Setup Event Listeners for buttons and forms.
 */
function setupEventListeners() {
  // Onboarding OAuth Button
  document.getElementById('btn-onboard-connect-oauth')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('onboard-status-msg');
    if (statusEl) statusEl.innerText = 'Opening GitHub authorization...';
    try {
      const token = await GitHubAPI.launchOAuthFlow();
      await handleLinkToken(token);
    } catch (err) {
      if (statusEl) {
        statusEl.innerText = 'Tip: Paste your token below for instant 1-click access!';
        statusEl.style.color = 'var(--accent-blue)';
      }
    }
  });

  // Onboarding Submit PAT Button
  document.getElementById('btn-onboard-submit-token')?.addEventListener('click', () => {
    const token = document.getElementById('input-onboard-token').value;
    handleLinkToken(token);
  });

  // Disconnect GitHub Button
  document.getElementById('btn-disconnect-github')?.addEventListener('click', async () => {
    await chrome.storage.local.remove(['github_token', 'github_repo_owner', 'github_repo_name']);
    showToast('GitHub disconnected');
    await checkAuthAndInitialize();
  });

  // Save Settings
  document.getElementById('btn-settings-sync-now')?.addEventListener('click', () => {
    document.getElementById('btn-backfill-all')?.click();
  });

  // Roadmap Selector Dropdown
  document.getElementById('roadmap-type-select')?.addEventListener('change', (e) => {
    loadRoadmap(e.target.value);
  });

  // Leave / Reset Squad Button
  document.getElementById('btn-leave-squad')?.addEventListener('click', async () => {
    const newCode = FirebaseSquads.generateRoomCode();
    await chrome.storage.local.set({ my_squad_code: newCode });
    document.getElementById('squad-room-code').innerText = newCode;
    const data = await chrome.storage.local.get(['streak_count', 'today_solved', 'user_xp']);
    await renderSquad(newCode, data.streak_count || 0, data.today_solved || 0, data.user_xp || 0);
    showToast(`Created room ${newCode}`);
  });

  // Drawer Close Button
  document.getElementById('btn-close-drawer')?.addEventListener('click', () => {
    document.getElementById('problem-drawer-overlay').style.display = 'none';
  });
  document.getElementById('problem-drawer-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'problem-drawer-overlay') {
      document.getElementById('problem-drawer-overlay').style.display = 'none';
    }
  });

  // Save Note in Drawer
  document.getElementById('drawer-notes-input')?.addEventListener('input', async (e) => {
    if (!activeDrawerProblem) return;
    const val = e.target.value;
    const data = await chrome.storage.local.get(['problem_notes']);
    const notes = data.problem_notes || {};
    notes[activeDrawerProblem.slug] = val;
    await chrome.storage.local.set({ problem_notes: notes });
  });

  // Schedule Review Interval Buttons
  document.querySelectorAll('.btn-interval').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (!activeDrawerProblem) return;
      const days = parseInt(e.target.dataset.days, 10);
      const dueTimestamp = Date.now() + (days * 24 * 60 * 60 * 1000);

      const data = await chrome.storage.local.get(['problem_reviews']);
      const reviews = (data.problem_reviews || []).filter(r => r.slug !== activeDrawerProblem.slug);
      reviews.push({
        slug: activeDrawerProblem.slug,
        id: activeDrawerProblem.id,
        title: activeDrawerProblem.title,
        difficulty: activeDrawerProblem.difficulty,
        dueTimestamp,
        intervalDays: days,
      });

      await chrome.storage.local.set({ problem_reviews: reviews });
      showToast(`Review scheduled for +${days} days!`);
      document.getElementById('problem-drawer-overlay').style.display = 'none';
      await checkDueReviews();
    });
  });

  // Reset Streak & XP Button
  document.getElementById('btn-reset-streak')?.addEventListener('click', async () => {
    await chrome.storage.local.set({
      streak_count: 0,
      user_xp: 0,
      today_solved: 0,
      last_solved_date: null,
    });
    document.getElementById('header-streak-count').innerText = 0;
    document.getElementById('header-xp-val').innerText = 0;
    document.getElementById('momentum-streak-number').innerText = '0';
    document.getElementById('momentum-streak-desc').innerText = "Solve today's challenge to ignite your streak.";
    document.getElementById('today-status-text').innerText = 'Pending ⏳';
    document.getElementById('today-status-text').style.color = 'var(--color-med)';
    renderWeekStrip(0, false);
    const squadCode = document.getElementById('squad-room-code').innerText;
    await renderSquad(squadCode, 0, 0, 0);
    showToast('Streak and XP reset to 0');
  });

  // 1-Click Backfill Button: Syncs full 113+ LeetCode problems & authentic difficulty breakdown
  document.getElementById('btn-backfill-all')?.addEventListener('click', async () => {
    const box = document.getElementById('backfill-progress-box');
    const msg = document.getElementById('backfill-status-msg');
    const bar = document.getElementById('backfill-bar');

    box.style.display = 'flex';
    msg.innerText = 'Scanning LeetCode submission history...';
    bar.style.width = '15%';

    try {
      const acceptedSubs = await LeetCodeAPI.fetchAllAcceptedSubmissions((count, sub) => {
        msg.innerText = `Scanning: ${count} problems (${sub.title})...`;
        bar.style.width = `${Math.min(90, count)}%`;
      });

      acceptedSubs.forEach(s => {
        userSolvedSlugs.add(s.titleSlug);
      });

      let easyCount = 0;
      let medCount = 0;
      let hardCount = 0;
      let totalCount = acceptedSubs.length;

      const userStatus = await LeetCodeAPI.getCurrentUser();
      if (userStatus && userStatus.username) {
        const stats = await LeetCodeAPI.getUserStats(userStatus.username);
        if (stats) {
          easyCount = stats.easySolved || 0;
          medCount = stats.mediumSolved || 0;
          hardCount = stats.hardSolved || 0;
          totalCount = stats.totalSolved || totalCount;
        }
      }

      await chrome.storage.local.set({
        user_solved_slugs: Array.from(userSolvedSlugs),
        solved_easy_count: easyCount,
        solved_med_count: medCount,
        solved_hard_count: hardCount,
        total_solved: totalCount,
      });

      renderDonutDistribution(easyCount, medCount, hardCount);
      renderRoadmapList('all');
      updateNextRecommendation();

      bar.style.width = '100%';
      msg.innerText = `✓ Synced all ${totalCount} solutions to progress & roadmap!`;
      showToast(`✓ Synced all ${totalCount} solutions!`);
    } catch (err) {
      msg.innerText = `Notice: Please log in to leetcode.com in this browser.`;
    }
  });

  // Join Squad Button
  document.getElementById('btn-join-squad')?.addEventListener('click', async () => {
    const code = document.getElementById('input-join-code').value.trim();
    if (code) {
      await chrome.storage.local.set({ my_squad_code: code.toUpperCase() });
      const data = await chrome.storage.local.get(['streak_count', 'today_solved', 'user_xp']);
      await renderSquad(code.toUpperCase(), data.streak_count || 0, data.today_solved || 0, data.user_xp || 0);
      document.getElementById('squad-room-code').innerText = code.toUpperCase();
      document.getElementById('input-join-code').value = '';
      showToast(`Joined squad ${code.toUpperCase()}`);
    }
  });

  // Copy Squad Code
  document.getElementById('btn-copy-squad')?.addEventListener('click', () => {
    const code = document.getElementById('squad-room-code').innerText;
    navigator.clipboard.writeText(code);
    document.getElementById('btn-copy-squad').innerText = '✓';
    showToast('Squad code copied!');
    setTimeout(() => { document.getElementById('btn-copy-squad').innerText = '📋'; }, 1500);
  });

  // Roadmap Category Filter Pills
  document.querySelectorAll('.cat-pill-btn').forEach(pill => {
    pill.addEventListener('click', (e) => {
      document.querySelectorAll('.cat-pill-btn').forEach(p => p.classList.remove('active'));
      e.currentTarget.classList.add('active');
      renderRoadmapList(e.currentTarget.dataset.cat);
    });
  });

  // Start Duel Button
  document.getElementById('btn-start-duel')?.addEventListener('click', () => {
    const oppSelect = document.getElementById('duel-opponent-select');
    const oppUser = oppSelect.value;
    if (!oppUser) {
      showToast('Invite a squad mate to start a duel!');
      return;
    }

    const probFormat = document.getElementById('duel-problem-select').value;
    let prob = { title: 'Two Sum', slug: 'two-sum' };

    if (probFormat === 'random_blind75' && currentRoadmapData.length > 0) {
      const rand = currentRoadmapData[Math.floor(Math.random() * currentRoadmapData.length)];
      prob = { title: `${rand.id}. ${rand.title}`, slug: rand.slug };
    }

    document.getElementById('active-duel-box').style.display = 'flex';
    document.querySelector('.duel-setup-form').style.display = 'none';
    document.getElementById('active-duel-problem-title').innerText = prob.title;
    document.getElementById('active-duel-link').href = `https://leetcode.com/problems/${prob.slug}/`;
    showToast('Duel started! Good luck.');

    // Start timer
    let seconds = 0;
    const timerEl = document.getElementById('duel-live-timer');
    if (window.duelInterval) clearInterval(window.duelInterval);
    window.duelInterval = setInterval(() => {
      seconds++;
      const m = String(Math.floor(seconds / 60)).padStart(2, '0');
      const s = String(seconds % 60).padStart(2, '0');
      timerEl.innerText = `${m}:${s}`;
    }, 1000);
  });

  // Cancel / Forfeit Duel
  document.getElementById('btn-cancel-duel')?.addEventListener('click', () => {
    if (window.duelInterval) clearInterval(window.duelInterval);
    document.getElementById('active-duel-box').style.display = 'none';
    document.querySelector('.duel-setup-form').style.display = 'flex';
    showToast('Match ended.');
  });
}
