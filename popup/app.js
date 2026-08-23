/**
 * LeetSync Squads - Light Mode Application Engine
 * Renders live donut charts, 7-day momentum strips, real-time roadmap checkoffs, and peer duels.
 */

import { LeetCodeAPI } from '../scripts/leetcode.js';
import { GitHubAPI } from '../scripts/github.js';
import { FirebaseSquads } from '../scripts/firebase.js';

let currentRoadmapData = [];
let currentRoadmapType = 'blind75';
let userSolvedSlugs = new Set();
let currentUsername = 'NINJA981';

function getTodayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getYesterdayDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  await loadStoredState();
  await syncLiveLeetCodeSession();
  await loadDailyChallenge();
  await loadRoadmap(currentRoadmapType);
  setupEventListeners();
});

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
  document.getElementById('header-xp-val').innerText = xp;

  // Hero Momentum Strip
  const streakTitle = document.getElementById('momentum-streak-title');
  const streakDesc = document.getElementById('momentum-streak-desc');
  const statusText = document.getElementById('today-status-text');

  if (streak === 0) {
    streakTitle.innerText = '0 Day Streak';
    streakDesc.innerText = "Solve today's challenge to ignite your streak.";
  } else {
    streakTitle.innerText = `${streak} Day Streak 🔥`;
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

  // Solved Distribution Donut
  const easy = data.solved_easy_count || 0;
  const med = data.solved_med_count || 0;
  const hard = data.solved_hard_count || 0;
  renderDonutDistribution(easy, med, hard);

  // GitHub Repo
  const repoNameEl = document.getElementById('sync-repo-name');
  const indicator = document.getElementById('github-sync-indicator');
  if (data.github_repo_owner && data.github_repo_name) {
    repoNameEl.innerText = `${data.github_repo_owner}/${data.github_repo_name}`;
    indicator.innerText = '● Connected';
    indicator.style.color = 'var(--color-easy)';
  } else {
    repoNameEl.innerText = 'Not Connected';
    indicator.innerText = '● Standby';
    indicator.style.color = 'var(--text-muted)';
  }

  // Settings inputs
  if (data.github_token) {
    document.getElementById('input-github-token').value = data.github_token;
    await populateRepoDropdown(data.github_token, data.github_repo_name);
  }
  if (data.github_branch) {
    document.getElementById('input-github-branch').value = data.github_branch;
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

    dot.className = 'day-dot';
    dot.innerText = '';

    if (i === dayOfWeek) {
      dot.classList.add('today');
      if (isTodaySolved) {
        dot.classList.add('completed');
        dot.innerText = '✓';
      }
    } else if (i < dayOfWeek && i >= dayOfWeek - streak + (isTodaySolved ? 1 : 0)) {
      dot.classList.add('completed');
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
  document.getElementById('total-solved-meta').innerText = `${total} Total`;
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
 * Validate live LeetCode session.
 */
async function syncLiveLeetCodeSession() {
  try {
    const userStatus = await LeetCodeAPI.getCurrentUser();
    if (userStatus && userStatus.isSignedIn) {
      console.log('[LeetSync] Active LeetCode session verified.');
    }
  } catch (err) {
    console.warn('[Popup] LeetCode session check notice:', err.message);
  }
}

/**
 * Fetch and display LeetCode's Daily Problem.
 */
async function loadDailyChallenge() {
  try {
    const daily = await LeetCodeAPI.getDailyChallenge();
    if (daily && daily.question) {
      document.getElementById('daily-problem-title').innerText = `#${daily.question.questionFrontendId} · ${daily.question.title}`;
      const badge = document.getElementById('daily-diff-badge');
      const diff = daily.question.difficulty || 'Medium';
      badge.innerText = diff;
      badge.className = `diff-badge ${diff}`;

      const launchBtn = document.getElementById('daily-launch-btn');
      launchBtn.href = daily.link;
    }
  } catch (err) {
    document.getElementById('daily-problem-title').innerText = 'Explore Problemset';
    document.getElementById('daily-launch-btn').href = 'https://leetcode.com/problemset/';
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
  } catch (err) {
    console.error('[Popup] Failed to load roadmap dataset:', err);
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
    itemEl.className = 'roadmap-row';
    const isSolved = userSolvedSlugs.has(prob.slug);
    if (isSolved) solvedCount++;

    itemEl.innerHTML = `
      <div class="prob-left">
        <span class="prob-id">#${prob.id}</span>
        <a href="https://leetcode.com/problems/${prob.slug}/" target="_blank" class="prob-title-link">${prob.title}</a>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        ${isSolved ? '<span style="color: var(--color-easy); font-size: 11px; font-weight: 600; font-family: var(--font-mono);">✓ Solved</span>' : ''}
        <span class="diff-badge ${prob.difficulty}">${prob.difficulty}</span>
      </div>
    `;

    container.appendChild(itemEl);
  });

  const total = currentRoadmapData.length;
  const pct = total > 0 ? Math.round((solvedCount / total) * 100) : 0;
  document.getElementById('blind75-bar').style.width = `${pct}%`;
  document.getElementById('blind75-count').innerText = `${solvedCount} / ${total} Solved (${pct}%)`;
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
    row.className = `leaderboard-row ${m.username === username ? 'current-user' : ''}`;
    const isSolved = (m.todaySolved || 0) > 0;
    const rankNum = String(idx + 1).padStart(2, '0');

    row.innerHTML = `
      <div class="member-left">
        <span class="member-rank">${rankNum}</span>
        <span class="member-name">@${m.username}</span>
        <span class="member-streak-badge">🔥 ${m.streak || 0}d</span>
      </div>
      <div class="member-right">
        <span class="member-status ${isSolved ? 'done' : 'pending'}">${isSolved ? '✓ Done' : '⏳ Pending'}</span>
        ${!isSolved && m.username !== username ? `<button class="btn-nudge" data-user="${m.username}" title="Nudge">👋</button>` : ''}
      </div>
    `;
    listEl.appendChild(row);
  });

  // Attach Nudge events
  document.querySelectorAll('.btn-nudge').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const targetUser = e.currentTarget.dataset.user;
      await FirebaseSquads.sendNudge(squadCode, username, targetUser, '👋');
      btn.innerText = '✨';
      setTimeout(() => renderSquad(squadCode, currentStreak, currentTodaySolved, currentXP), 400);
    });
  });

  // Populate Activity Feed
  const feedEl = document.getElementById('squad-activity-feed');
  feedEl.innerHTML = '';
  const activities = (rawSquad.activityFeed || []).filter(a => !a.text.includes('AH0C') && !a.text.includes('You')).slice(0, 5);

  if (activities.length === 0) {
    feedEl.innerHTML = `<div class="activity-empty">${username} joined the squad! Solve a problem to light up the feed.</div>`;
  } else {
    activities.forEach(act => {
      const item = document.createElement('div');
      item.className = 'activity-item';
      item.innerText = act.text;
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
 * Setup Event Listeners for buttons and forms.
 */
function setupEventListeners() {
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
  });

  // Reset Streak & XP Button (Fresh Start)
  document.getElementById('btn-reset-streak')?.addEventListener('click', async () => {
    if (confirm('Reset your streak and XP to 0 for a fresh start?')) {
      await chrome.storage.local.set({
        streak_count: 0,
        user_xp: 0,
        today_solved: 0,
        last_solved_date: null,
      });
      document.getElementById('header-streak-count').innerText = 0;
      document.getElementById('header-xp-val').innerText = 0;
      document.getElementById('momentum-streak-title').innerText = '0 Day Streak';
      document.getElementById('momentum-streak-desc').innerText = "Solve today's challenge to ignite your streak.";
      document.getElementById('today-status-text').innerText = 'Pending ⏳';
      document.getElementById('today-status-text').style.color = 'var(--color-med)';
      renderWeekStrip(0, false);
      const squadCode = document.getElementById('squad-room-code').innerText;
      await renderSquad(squadCode, 0, 0, 0);
      alert('Streak and XP reset to 0!');
    }
  });

  // 1-Click Backfill Button
  document.getElementById('btn-backfill-all')?.addEventListener('click', async () => {
    const box = document.getElementById('backfill-progress-box');
    const msg = document.getElementById('backfill-status-msg');
    const bar = document.getElementById('backfill-bar');

    box.style.display = 'flex';
    msg.innerText = 'Scanning LeetCode submission history...';
    bar.style.width = '15%';

    try {
      let easyCount = 0;
      let medCount = 0;
      let hardCount = 0;

      const acceptedSubs = await LeetCodeAPI.fetchAllAcceptedSubmissions((count, sub) => {
        msg.innerText = `Scanning: ${count} problems (${sub.title})...`;
        bar.style.width = `${Math.min(90, count)}%`;
      });

      // Query question details to map solved slugs & difficulty breakdown
      acceptedSubs.forEach(s => {
        userSolvedSlugs.add(s.titleSlug);
      });

      // Sample difficulty distribution from dataset matching
      if (currentRoadmapData.length > 0) {
        currentRoadmapData.forEach(p => {
          if (userSolvedSlugs.has(p.slug)) {
            if (p.difficulty === 'Easy') easyCount++;
            else if (p.difficulty === 'Medium') medCount++;
            else if (p.difficulty === 'Hard') hardCount++;
          }
        });
      }

      await chrome.storage.local.set({
        user_solved_slugs: Array.from(userSolvedSlugs),
        solved_easy_count: easyCount,
        solved_med_count: medCount,
        solved_hard_count: hardCount,
      });

      renderDonutDistribution(easyCount, medCount, hardCount);
      renderRoadmapList('all');

      bar.style.width = '100%';
      msg.innerText = `✓ Synced ${acceptedSubs.length} solutions to roadmap!`;
    } catch (err) {
      msg.innerText = `Notice: Please log in to leetcode.com in this browser.`;
    }
  });

  // Save Settings
  document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
    const displayName = document.getElementById('input-display-name').value.trim() || 'NINJA981';
    const token = document.getElementById('input-github-token').value.trim();
    const repoSelect = document.getElementById('select-github-repo');
    const branch = document.getElementById('input-github-branch').value.trim() || 'main';
    const statusEl = document.getElementById('auth-status-msg');

    currentUsername = displayName;

    let repoOwner = displayName;
    let repoName = repoSelect.value;

    if (token) {
      try {
        const gh = new GitHubAPI(token);
        const user = await gh.getUser();
        repoOwner = user.login;
        if (!repoName && repoSelect.options.length > 1) {
          repoName = repoSelect.options[1].value;
        }
      } catch (err) {
        console.warn('GitHub validation notice:', err.message);
      }
    }

    await chrome.storage.local.set({
      display_name: displayName,
      github_token: token,
      github_repo_owner: repoOwner,
      github_repo_name: repoName || 'leetcode-submissions',
      github_branch: branch,
    });

    statusEl.innerText = `✓ Saved! Display name: @${displayName}`;
    statusEl.style.color = 'var(--color-easy)';
    await loadStoredState();
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
    }
  });

  // Copy Squad Code
  document.getElementById('btn-copy-squad')?.addEventListener('click', () => {
    const code = document.getElementById('squad-room-code').innerText;
    navigator.clipboard.writeText(code);
    document.getElementById('btn-copy-squad').innerText = '✓';
    setTimeout(() => { document.getElementById('btn-copy-squad').innerText = '📋'; }, 1500);
  });

  // Roadmap Category Filter Pills
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      e.currentTarget.classList.add('active');
      renderRoadmapList(e.currentTarget.dataset.cat);
    });
  });

  // Start Duel Button
  document.getElementById('btn-start-duel')?.addEventListener('click', () => {
    const oppSelect = document.getElementById('duel-opponent-select');
    const oppUser = oppSelect.value;
    if (!oppUser) {
      alert('Please invite a squad mate to challenge them to a live duel!');
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
  });
}

/**
 * Populate repository dropdown selector.
 */
async function populateRepoDropdown(token, selectedRepo) {
  try {
    const gh = new GitHubAPI(token);
    const repos = await gh.getUserRepos();
    const select = document.getElementById('select-github-repo');
    select.innerHTML = '<option value="">Select a repository...</option>';

    repos.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.name;
      opt.innerText = r.name;
      if (r.name === selectedRepo || r.name === 'leetcode-submissions') {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  } catch (err) {
    console.warn('[Popup] Repo dropdown notice:', err.message);
  }
}
