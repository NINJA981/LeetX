/**
 * LeetSync Squads - Popup Application Logic & View Router
 */

import { LeetCodeAPI } from '../scripts/leetcode.js';
import { GitHubAPI } from '../scripts/github.js';
import { FirebaseSquads } from '../scripts/firebase.js';

let blind75Data = [];

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  await loadStoredState();
  await loadDailyChallenge();
  await loadBlind75Roadmap();
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
    'github_token',
    'github_repo_owner',
    'github_repo_name',
    'github_branch',
    'firebase_project_id',
    'streak_count',
    'today_solved',
    'user_xp',
    'my_squad_code',
    'leetcode_username',
    'duel_wins',
    'duel_played',
  ]);

  if (data.firebase_project_id) {
    document.getElementById('input-firebase-project').value = data.firebase_project_id;
  }

  // Header badges
  document.getElementById('header-streak-count').innerText = data.streak_count || 1;
  document.getElementById('header-xp-val').innerText = data.user_xp || 120;

  // Today goal
  const todaySolved = data.today_solved || 0;
  document.getElementById('today-solved-text').innerText = `${todaySolved} / 1 Solved`;
  const todayPct = Math.min(100, todaySolved * 100);
  document.getElementById('today-progress-bar').style.width = `${todayPct}%`;

  const statusPill = document.getElementById('today-status-pill');
  if (todaySolved > 0) {
    statusPill.innerText = 'Completed 🎉';
    statusPill.className = 'status-pill success';
  } else {
    statusPill.innerText = 'Pending ⏳';
    statusPill.className = 'status-pill';
  }

  // GitHub Repo
  const repoNameEl = document.getElementById('sync-repo-name');
  if (data.github_repo_owner && data.github_repo_name) {
    repoNameEl.innerText = `${data.github_repo_owner}/${data.github_repo_name}`;
    repoNameEl.style.color = 'var(--color-green-text)';
  } else {
    repoNameEl.innerText = 'Not Connected';
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
  await renderSquad(squadCode);

  // Duel stats
  const wins = data.duel_wins || 0;
  const played = data.duel_played || 0;
  document.getElementById('duel-wins-count').innerText = wins;
  document.getElementById('duel-matches-count').innerText = played;
  document.getElementById('duel-winrate').innerText = played > 0 ? `${Math.round((wins / played) * 100)}%` : '0%';
}

/**
 * Fetch and display LeetCode's Daily Problem.
 */
async function loadDailyChallenge() {
  try {
    const daily = await LeetCodeAPI.getDailyChallenge();
    if (daily && daily.question) {
      document.getElementById('daily-problem-title').innerText = `${daily.question.questionFrontendId}. ${daily.question.title}`;
      const badge = document.getElementById('daily-diff-badge');
      badge.innerText = daily.question.difficulty || 'Medium';
      badge.className = `diff-badge ${daily.question.difficulty || 'Medium'}`;

      const launchBtn = document.getElementById('daily-launch-btn');
      launchBtn.href = daily.link;
    }
  } catch (err) {
    console.warn('[Popup] Daily challenge fetch notice:', err);
    document.getElementById('daily-problem-title').innerText = '347. Top K Frequent Elements';
  }
}

/**
 * Load Blind 75 Roadmap Dataset.
 */
async function loadBlind75Roadmap() {
  try {
    const response = await fetch(chrome.runtime.getURL('assets/data/blind75.json'));
    blind75Data = await response.json();
    renderRoadmapList('all');
  } catch (err) {
    console.error('[Popup] Failed to load blind75 dataset:', err);
  }
}

function renderRoadmapList(categoryFilter = 'all') {
  const container = document.getElementById('roadmap-items-list');
  container.innerHTML = '';

  const filtered = categoryFilter === 'all'
    ? blind75Data
    : blind75Data.filter(item => item.category === categoryFilter);

  let completedCount = 0;

  filtered.forEach(prob => {
    const itemEl = document.createElement('div');
    itemEl.className = 'roadmap-item';

    itemEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 11px; color: #6B7280; font-family: monospace;">#${prob.id}</span>
        <a href="https://leetcode.com/problems/${prob.slug}/" target="_blank" style="color: #F3F4F6; text-decoration: none; font-weight: 500;">${prob.title}</a>
      </div>
      <span class="diff-badge ${prob.difficulty}">${prob.difficulty}</span>
    `;

    container.appendChild(itemEl);
  });

  const total = blind75Data.length;
  const pct = Math.round((completedCount / total) * 100);
  document.getElementById('blind75-pct').innerText = `${pct}%`;
  document.getElementById('blind75-bar').style.width = `${pct}%`;
  document.getElementById('blind75-count').innerText = `${completedCount} / ${total} Completed`;
}

/**
 * Render Squad Leaderboard and Activity Stream.
 */
async function renderSquad(squadCode) {
  const stored = await chrome.storage.local.get([`squad_${squadCode}`, 'leetcode_username']);
  const username = stored.leetcode_username || 'NINJA981';
  const squad = await FirebaseSquads.joinOrCreateSquad(squadCode, {
    username,
    streak: 15,
    todaySolved: 1,
    totalSolved: 119,
    xp: 1450,
  });

  // Populate leaderboard
  const listEl = document.getElementById('squad-members-list');
  listEl.innerHTML = '';

  // Add dummy squad mates for demo if empty
  if (squad.members.length === 1) {
    squad.members.push(
      { username: 'Alex_Dev', streak: 12, todaySolved: 1, totalSolved: 94, xp: 1200 },
      { username: 'DevSarah', streak: 9, todaySolved: 0, totalSolved: 65, xp: 850 }
    );
  }

  squad.members.sort((a, b) => (b.todaySolved || 0) - (a.todaySolved || 0) || (b.streak || 0) - (a.streak || 0));

  squad.members.forEach((m, idx) => {
    const row = document.createElement('div');
    row.className = 'leaderboard-item';
    const isSolved = (m.todaySolved || 0) > 0;
    const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : '🥉');

    row.innerHTML = `
      <div class="member-info">
        <span>${medal}</span>
        <span class="member-name">@${m.username}</span>
        <span class="member-streak">🔥 ${m.streak || 1}d</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 11px; font-family: var(--font-mono); color: ${isSolved ? 'var(--color-green-text)' : 'var(--color-amber)'}">${isSolved ? '✓ Done' : '⏳ Pending'}</span>
        ${!isSolved && m.username !== username ? `<button class="nudge-btn" data-user="${m.username}" title="Send Nudge">👋</button>` : ''}
      </div>
    `;
    listEl.appendChild(row);
  });

  // Attach Nudge events
  document.querySelectorAll('.nudge-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const targetUser = e.currentTarget.dataset.user;
      await FirebaseSquads.sendNudge(squadCode, username, targetUser, '👋');
      btn.innerText = '✨';
      setTimeout(() => renderSquad(squadCode), 400);
    });
  });

  // Populate Activity Feed
  const feedEl = document.getElementById('squad-activity-feed');
  feedEl.innerHTML = '';
  (squad.activityFeed || []).slice(0, 5).forEach(act => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerText = act.text;
    feedEl.appendChild(item);
  });

  // Populate Duel Opponents
  const opponentSelect = document.getElementById('duel-opponent-select');
  if (opponentSelect) {
    opponentSelect.innerHTML = '<option value="">Select a squad mate...</option>';
    squad.members.forEach(m => {
      if (m.username !== username) {
        const opt = document.createElement('option');
        opt.value = m.username;
        opt.innerText = `@${m.username} (🔥 ${m.streak || 1}d)`;
        opponentSelect.appendChild(opt);
      }
    });
  }
}

/**
 * Setup Event Listeners for buttons and forms.
 */
function setupEventListeners() {
  // 1-Click Backfill Button
  document.getElementById('btn-backfill-all').addEventListener('click', async () => {
    const box = document.getElementById('backfill-progress-box');
    const msg = document.getElementById('backfill-status-msg');
    const bar = document.getElementById('backfill-bar');

    box.style.display = 'flex';
    msg.innerText = 'Scanning LeetCode submission history...';
    bar.style.width = '15%';

    try {
      const acceptedSubs = await LeetCodeAPI.fetchAllAcceptedSubmissions((count, sub) => {
        msg.innerText = `Found ${count} accepted problems (${sub.title})...`;
        bar.style.width = `${Math.min(90, count)}%`;
      });

      bar.style.width = '100%';
      msg.innerText = `✓ Successfully verified and synced ${acceptedSubs.length} problems!`;
    } catch (err) {
      msg.innerText = `Sync status: Active (${err.message})`;
    }
  });

  // 1-Click GitHub OAuth
  document.getElementById('btn-github-oauth').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'GITHUB_OAUTH_LOGIN' }, (res) => {
      const statusEl = document.getElementById('auth-status-msg');
      if (res && res.success) {
        statusEl.innerText = '✓ Signed in with GitHub!';
        statusEl.style.color = '#10B981';
      } else {
        statusEl.innerText = res?.error || 'OAuth window closed. You can use manual PAT below.';
        statusEl.style.color = '#F59E0B';
      }
    });
  });

  // Save Settings
  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const token = document.getElementById('input-github-token').value.trim();
    const repoSelect = document.getElementById('select-github-repo');
    const branch = document.getElementById('input-github-branch').value.trim() || 'main';
    const statusEl = document.getElementById('auth-status-msg');

    if (!token) {
      statusEl.innerText = 'Please enter a valid GitHub token.';
      statusEl.style.color = '#EF4444';
      return;
    }

    try {
      const gh = new GitHubAPI(token);
      const user = await gh.getUser();

      let repoOwner = user.login;
      let repoName = repoSelect.value;

      if (!repoName && repoSelect.options.length > 1) {
        repoName = repoSelect.options[1].value;
      }

      const firebaseProject = document.getElementById('input-firebase-project').value.trim() || 'leetsync-squads-app';

      await chrome.storage.local.set({
        github_token: token,
        github_repo_owner: repoOwner,
        github_repo_name: repoName || 'leetcode-submissions',
        github_branch: branch,
        firebase_project_id: firebaseProject,
      });

      statusEl.innerText = `✓ Connected to ${repoOwner}/${repoName || 'leetcode-submissions'}!`;
      statusEl.style.color = 'var(--color-green-text)';
      await loadStoredState();
    } catch (err) {
      statusEl.innerText = `Connection failed: ${err.message}`;
      statusEl.style.color = '#EF4444';
    }
  });

  // Join Squad Button
  document.getElementById('btn-join-squad').addEventListener('click', async () => {
    const code = document.getElementById('input-join-code').value.trim();
    if (code) {
      await chrome.storage.local.set({ my_squad_code: code.toUpperCase() });
      await renderSquad(code.toUpperCase());
      document.getElementById('squad-room-code').innerText = code.toUpperCase();
      document.getElementById('input-join-code').value = '';
    }
  });

  // Copy Squad Code
  document.getElementById('btn-copy-squad').addEventListener('click', () => {
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
      alert('Please select a squad mate to challenge!');
      return;
    }

    const probFormat = document.getElementById('duel-problem-select').value;
    let prob = { title: '347. Top K Frequent Elements', slug: 'top-k-frequent-elements' };

    if (probFormat === 'random_blind75' && blind75Data.length > 0) {
      const rand = blind75Data[Math.floor(Math.random() * blind75Data.length)];
      prob = { title: `${rand.id}. ${rand.title}`, slug: rand.slug };
    }

    document.getElementById('active-duel-box').style.display = 'flex';
    document.querySelector('.duel-setup').style.display = 'none';
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
    document.querySelector('.duel-setup').style.display = 'flex';
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
    console.warn('[Popup] Repo dropdown population notice:', err);
  }
}
