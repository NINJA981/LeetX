/**
 * Handle 1-Click GitHub Connection (Device Flow - Zero Prompt Dialogs).
 */
async function handleConnectGitHub() {
  const statusEl = document.getElementById('auth-status-msg');
  const oauthBtnText = document.getElementById('btn-oauth-github-text');
  
  if (statusEl) {
    statusEl.innerText = 'Requesting GitHub authorization...';
    statusEl.style.color = 'var(--text-secondary)';
  }
  if (oauthBtnText) oauthBtnText.innerText = 'Opening GitHub...';

  try {
    const deviceData = await GitHubAPI.requestDeviceCode();
    const userCode = deviceData.user_code;
    const verifyUrl = deviceData.verification_uri || 'https://github.com/login/device';

    // Copy user code to clipboard for instant paste
    navigator.clipboard.writeText(userCode);
    showToast(`Code ${userCode} copied! Opening GitHub tab...`);

    // Open GitHub authorization page directly in a new tab
    chrome.tabs.create({ url: `${verifyUrl}?user_code=${encodeURIComponent(userCode)}` });

    if (statusEl) {
      statusEl.innerText = `Authorizing code: ${userCode} (Waiting for approval in tab...)`;
      statusEl.style.color = 'var(--color-med)';
    }

    // Poll for token in background
    const token = await GitHubAPI.pollForAccessToken(deviceData.device_code, deviceData.interval || 5, deviceData.expires_in || 900);

    if (statusEl) statusEl.innerText = 'Setting up leetcode-submissions repository...';

    const gh = new GitHubAPI(token);
    const { isNew, owner } = await gh.ensureRepository('leetcode-submissions');

    await chrome.storage.local.set({
      github_token: token,
      github_repo_owner: owner,
      github_repo_name: 'leetcode-submissions',
      github_branch: 'main',
      display_name: owner,
    });

    showToast(`✓ Connected to ${owner}/leetcode-submissions!`);
    if (statusEl) {
      statusEl.innerText = `✓ Connected to ${owner}/leetcode-submissions (${isNew ? 'Created new' : 'Linked existing'})`;
      statusEl.style.color = 'var(--color-easy)';
    }

    await loadStoredState();
  } catch (err) {
    console.error('GitHub connection error:', err);
    if (statusEl) {
      statusEl.innerText = `Notice: ${err.message}`;
      statusEl.style.color = 'var(--color-hard)';
    }
    if (oauthBtnText) oauthBtnText.innerText = 'Connect with GitHub';
  }
}

/**
 * Setup Event Listeners for buttons and forms.
 */
function setupEventListeners() {
  // 1-Click Connect GitHub Buttons
  document.getElementById('btn-oauth-github')?.addEventListener('click', handleConnectGitHub);
  document.getElementById('btn-quick-connect-github')?.addEventListener('click', handleConnectGitHub);

  // Disconnect GitHub Button
  document.getElementById('btn-disconnect-github')?.addEventListener('click', async () => {
    if (confirm('Disconnect GitHub account from LeetSync?')) {
      await chrome.storage.local.remove(['github_token', 'github_repo_owner', 'github_repo_name']);
      showToast('GitHub disconnected');
      await loadStoredState();
    }
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
      document.getElementById('momentum-streak-number').innerText = '0';
      document.getElementById('momentum-streak-desc').innerText = "Solve today's challenge to ignite your streak.";
      document.getElementById('today-status-text').innerText = 'Pending ⏳';
      document.getElementById('today-status-text').style.color = 'var(--color-med)';
      renderWeekStrip(0, false);
      const squadCode = document.getElementById('squad-room-code').innerText;
      await renderSquad(squadCode, 0, 0, 0);
      showToast('Streak and XP reset to 0');
    }
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
      // 1. Fetch all accepted submission slugs
      const acceptedSubs = await LeetCodeAPI.fetchAllAcceptedSubmissions((count, sub) => {
        msg.innerText = `Scanning: ${count} problems (${sub.title})...`;
        bar.style.width = `${Math.min(90, count)}%`;
      });

      acceptedSubs.forEach(s => {
        userSolvedSlugs.add(s.titleSlug);
      });

      // 2. Fetch full global account stats (e.g. 113 total, 27 easy, 82 med, 10 hard)
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
    showToast('Settings saved!');
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
