
/**
 * Send Chrome Native Desktop Notification if enabled.
 */
async function sendDesktopNotification(title, message, notificationId = null) {
  try {
    const data = await chrome.storage.local.get(['notifications_enabled']);
    const isEnabled = data.notifications_enabled !== false; // Default true

    if (!isEnabled) return;

    // 1. Dispatch Native Chrome / Windows Desktop Notification
    if (chrome.notifications && typeof chrome.notifications.create === 'function') {
      const notifOptions = {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
        title: title || 'LeetX Squads',
        message: message || '',
        priority: 2,
        requireInteraction: false,
      };

      chrome.notifications.create(notificationId || `leetsync_${Date.now()}`, notifOptions, (id) => {
        if (chrome.runtime.lastError) {
          console.warn('[Notifications] Error creating desktop alert:', chrome.runtime.lastError.message);
        }
      });
    }

    // 2. Broadcast in-page banner to active LeetCode tabs
    if (chrome.tabs && typeof chrome.tabs.query === 'function') {
      chrome.tabs.query({ url: '*://*.leetcode.com/*' }, (tabs) => {
        if (tabs && tabs.length > 0) {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              type: 'SHOW_INPAGE_NOTIFICATION',
              title,
              message,
            }, () => {
              if (chrome.runtime.lastError) { /* ignore tabs without script */ }
            });
          });
        }
      });
    }
  } catch (err) {
    console.warn('[Notifications] Dispatch notice:', err.message);
  }
}

/**
 * LeetSync Squads - Manifest V3 Background Service Worker
 * Coordinates live streak tracking, problem solves, alarms, and toolbar badge.
 */

import { GitHubAPI } from './github.js';
import { LeetCodeAPI } from './leetcode.js';
import { FirebaseSquads } from './firebase.js';

function getTodayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getYesterdayDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// On first install, initialize fresh streak and XP to 0
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({
      streak_count: 0,
      user_xp: 0,
      today_solved: 0,
      last_solved_date: null,
      notifications_enabled: true,
      notify_squad_solves_enabled: true,
      share_solves_enabled: true,
    });
  }
  chrome.alarms.create('daily_streak_check', { periodInMinutes: 60 });
  chrome.alarms.create('squad_presence_poll', { periodInMinutes: 1 });
  await updateDailyStreakState();
  await checkIncomingSquadEvents();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'daily_streak_check') {
    await updateDailyStreakState();
  } else if (alarm.name === 'squad_presence_poll') {
    await checkIncomingSquadEvents();
  }
});

// When a desktop notification is clicked, route to the Duels page
if (chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener(async (notificationId) => {
    await chrome.storage.local.set({ target_open_tab: 'duels' });
    chrome.notifications.clear(notificationId);

    if (chrome.action && typeof chrome.action.openPopup === 'function') {
      try {
        await chrome.action.openPopup();
      } catch (e) {
        // Handled silently
      }
    }
  });
}

/**
 * Daily date rollover check (resets today's solve count, checks if streak broke).
 */
async function updateDailyStreakState() {
  const data = await chrome.storage.local.get(['streak_count', 'today_solved', 'last_solved_date']);
  const today = getTodayDateStr();
  const yesterday = getYesterdayDateStr();

  let streak = data.streak_count || 0;
  let todaySolved = data.today_solved || 0;
  const lastDate = data.last_solved_date;

  if (lastDate) {
    if (lastDate !== today && lastDate !== yesterday) {
      // Missed more than 1 day -> streak reset to 0
      streak = 0;
      todaySolved = 0;
    } else if (lastDate === yesterday) {
      // New day started -> waiting for today's solve
      todaySolved = 0;
    }
  } else {
    streak = 0;
    todaySolved = 0;
  }

  await chrome.storage.local.set({ streak_count: streak, today_solved: todaySolved });
  updateToolbarBadge(streak, todaySolved);
}

/**
 * Update the extension toolbar icon badge with current streak.
 */
function updateToolbarBadge(streak, todaySolved) {
  const text = streak > 0 ? (todaySolved > 0 ? `✓${streak}` : `${streak}`) : '';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({
    color: todaySolved > 0 ? '#FF2D8B' : '#FF5A1F',
  });
  if (chrome.action.setBadgeTextColor) {
    chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  }
}

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PROBLEM_SOLVED' || message.type === 'SYNC_SUBMISSION') {
    const solveData = message.data || {
      slug: message.titleSlug,
      title: message.titleSlug ? message.titleSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Problem',
      difficulty: message.difficulty || 'Medium',
      submissionId: message.submissionId,
    };
    handleProblemSolved(solveData)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }

  if (message.type === 'CHECK_DUEL_INVITES' || message.type === 'POLL_SQUAD_EVENTS') {
    checkIncomingSquadEvents()
      .then(res => sendResponse(res || { success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'SEND_TEST_NOTIFICATION') {
    const title = message.title || '🔔 LeetSync Squads Notifications Active!';
    const body = message.message || 'Desktop notifications are enabled and working properly on your browser.';
    sendDesktopNotification(title, body)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'START_ASYNC_SYNC') {
    startAsyncGitHubSync()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'GET_SYNC_STATUS') {
    chrome.storage.local.get(['sync_status']).then(data => {
      sendResponse(data.sync_status || { state: 'idle' });
    });
    return true;
  }

  if (message.type === 'GITHUB_OAUTH_LOGIN') {
    sendResponse({ success: false, error: 'Please enter your GitHub Personal Access Token below.' });
    return true;
  }
});

/**
 * Check for incoming squad events (1v1 duels, nudges, member solves) and dispatch desktop notifications.
 */
async function checkIncomingSquadEvents() {
  try {
    const data = await chrome.storage.local.get([
      'leetcode_username',
      'my_squad_code',
      'display_name',
      'github_repo_owner',
      'last_seen_activity_id',
      'notifications_enabled',
      'notify_squad_solves_enabled'
    ]);

    if (data.notifications_enabled === false) return;

    const username = data.github_repo_owner || data.display_name || data.leetcode_username || 'Player';
    const roomCode = data.my_squad_code || null;
    if (!roomCode) return;

    const squad = await FirebaseSquads.fetchRemoteSquad(roomCode);
    if (!squad || !Array.isArray(squad.activityFeed) || squad.activityFeed.length === 0) return;

    const lastSeenId = data.last_seen_activity_id;
    const newEvents = [];
    for (const act of squad.activityFeed) {
      if (act.id === lastSeenId) break;
      newEvents.push(act);
    }

    if (newEvents.length > 0) {
      await chrome.storage.local.set({ last_seen_activity_id: squad.activityFeed[0].id });

      for (const act of newEvents) {
        const text = (act.text || '').toLowerCase();
        const userLower = username.toLowerCase();

        // 1. Duel challenge targeted at you
        const isTargetedDuel = (act.opponent && act.opponent.toLowerCase() === userLower) || text.includes(`@${userLower}`);
        if (act.type === 'duel_challenge' && isTargetedDuel) {
          await sendDesktopNotification('⚔️ 1v1 Duel Challenge!', act.text || `⚔️ @${act.challenger} challenged you to a 1v1 DSA race!`);
          if (act.problem) {
            await chrome.storage.local.set({
              incoming_duel: {
                id: act.duelId || act.id,
                roomCode: roomCode,
                challenger: act.challenger,
                opponent: act.opponent || username,
                problem: act.problem,
                format: act.format || 'random_blind75',
                status: 'pending',
                createdAt: act.timestamp || Date.now(),
              }
            });
          }
        }
        // 2. Duel accepted (notify both challenger and opponent with revealed problem)
        else if (act.type === 'duel_accepted' && ((act.challenger || '').toLowerCase() === userLower || (act.opponent || '').toLowerCase() === userLower || text.includes(`@${userLower}`))) {
          const probTitle = act.problem ? `#${act.problem.id} ${act.problem.title}` : 'the challenge problem';
          await sendDesktopNotification('⚔️ DUEL MATCH STARTED!', `@${act.opponent} accepted the match! Problem revealed: ${probTitle}. Race is ON! 🏁`);
          if (act.problem) {
            await chrome.storage.local.set({
              active_duel: {
                id: act.duelId,
                status: 'active',
                startedAt: act.timestamp || Date.now(),
                revealed: true,
                challenger: act.challenger,
                opponent: act.opponent,
                problem: act.problem,
              }
            });
          }
        }
        // 3. Duel victory notification
        else if (act.type === 'duel_win' && text.includes(`@${userLower}`)) {
          await sendDesktopNotification('🏆 Duel Finished!', act.text || '1v1 Duel match completed!');
        }
        // 4. Squad nudge targeted at you
        else if (act.type === 'nudge' && text.includes(`@${userLower}`)) {
          await sendDesktopNotification('👋 Squad Nudge!', act.text || 'A squad mate nudged you to solve today\'s problem!');
        }
        // 5. Squad solve by someone else
        else if ((act.type === 'solve' || act.type === 'SOLVE') && !text.startsWith(`@${userLower}`) && data.notify_squad_solves_enabled !== false) {
          await sendDesktopNotification('🎉 Squad Mate Solved a Problem!', act.text || 'A squad member just completed a problem!');
        }
      }
    }
  } catch (err) {
    console.warn('[Background] Squad event poll notice:', err);
  }
}

/**
 * Handle live problem solve: increment dynamic streak, XP, and sync to GitHub & Firebase.
 */
async function handleProblemSolved(solveData) {
  const today = getTodayDateStr();
  const yesterday = getYesterdayDateStr();

  const data = await chrome.storage.local.get([
    'streak_count',
    'today_solved',
    'user_xp',
    'last_solved_date',
    'github_token',
    'github_repo_owner',
    'github_repo_name',
    'github_branch',
    'my_squad_code',
    'display_name',
    'leetcode_username',
    'user_solved_slugs',
    'total_solved',
    'solved_easy_count',
    'solved_med_count',
    'solved_hard_count',
    'active_duel',
    'share_solves_enabled',
  ]);

  let streak = data.streak_count || 0;
  let todaySolved = data.today_solved || 0;
  let xp = data.user_xp || 0;
  const lastDate = data.last_solved_date;

  const solvedSlugs = new Set(data.user_solved_slugs || []);
  const isNewSolve = solveData.slug ? !solvedSlugs.has(solveData.slug) : true;
  if (solveData.slug) solvedSlugs.add(solveData.slug);

  let totalSolved = data.total_solved || solvedSlugs.size || 0;
  let easyCount = data.solved_easy_count || 0;
  let medCount = data.solved_med_count || 0;
  let hardCount = data.solved_hard_count || 0;

  const diffNorm = (solveData.difficulty || 'Medium').toLowerCase();
  const diffXp = diffNorm === 'hard' ? 50 : (diffNorm === 'easy' ? 10 : 25);
  xp += diffXp;

  if (isNewSolve) {
    totalSolved += 1;
    if (diffNorm === 'easy') easyCount += 1;
    else if (diffNorm === 'hard') hardCount += 1;
    else medCount += 1;
  }

  if (lastDate === today) {
    todaySolved += 1;
  } else if (lastDate === yesterday || !lastDate || streak === 0) {
    streak += 1;
    todaySolved = 1;
  }

  await chrome.storage.local.set({
    streak_count: streak,
    today_solved: todaySolved,
    user_xp: xp,
    last_solved_date: today,
    user_solved_slugs: Array.from(solvedSlugs),
    total_solved: totalSolved,
    solved_easy_count: easyCount,
    solved_med_count: medCount,
    solved_hard_count: hardCount,
  });

  updateToolbarBadge(streak, todaySolved);

  // Asynchronously reconcile authoritative stats from LeetCode GraphQL
  const lcUser = data.leetcode_username || (await LeetCodeAPI.getCurrentUser())?.username;
  if (lcUser) {
    LeetCodeAPI.getUserStats(lcUser).then(async (stats) => {
      if (stats && (stats.total > 0 || stats.easy > 0 || stats.med > 0 || stats.hard > 0)) {
        const accurateTotal = stats.total || (stats.easy + stats.med + stats.hard);
        await chrome.storage.local.set({
          total_solved: accurateTotal,
          solved_easy_count: stats.easy,
          solved_med_count: stats.med,
          solved_hard_count: stats.hard,
          leetcode_username: lcUser,
        });
      }
    }).catch(() => {});
  }

  const username = data.github_repo_owner || data.display_name || data.leetcode_username || 'Player';
  const squadCode = data.my_squad_code || null;

  // 1. Sync to Firebase Squad Room (respects user's share_solves_enabled preference)
  if (data.share_solves_enabled !== false && squadCode) {
    try {
      await FirebaseSquads.broadcastSolve(squadCode, username, solveData, streak);
    } catch (e) {
      console.warn('[Background] Firebase broadcast notice:', e.message);
    }
  }

  // 2. Live Sync Solution to GitHub Repository Asynchronously (Non-blocking)
  if (data.github_token) {
    (async () => {
      try {
        const gh = new GitHubAPI(data.github_token);
        const owner = data.github_repo_owner || data.display_name || 'User';
        const repo = data.github_repo_name || 'leetcode-submissions';
        const branch = data.github_branch || 'main';

        await gh.ensureRepository(repo);

        // Check if problem was already submitted and committed to repository
        const targetSlug = (solveData.slug || solveData.titleSlug || '').toLowerCase().trim();
        if (targetSlug) {
          const existingSlugs = await gh.getExistingProblemSlugs(owner, repo, branch);
          if (existingSlugs.has(targetSlug)) {
            console.log(`[Background] Problem "${targetSlug}" is already committed in ${owner}/${repo}. Skipping redundant commit.`);
            return;
          }
        }

        let details = null;
        if (solveData.submissionId && /^\d+$/.test(String(solveData.submissionId))) {
          details = await LeetCodeAPI.getSubmissionDetails(solveData.submissionId);
        }

        // Fallback: If GraphQL details not directly available, check user's recent accepted submissions
        if (!details && lcUser) {
          try {
            const recentList = await LeetCodeAPI.getRecentAcSubmissions(lcUser, 5);
            const targetSlug = (solveData.slug || solveData.titleSlug || '').toLowerCase();
            const matched = recentList.find(s => (s.titleSlug || '').toLowerCase() === targetSlug);
            if (matched && matched.id) {
              details = await LeetCodeAPI.getSubmissionDetails(matched.id);
            }
          } catch (e) {}
        }

        const codeToCommit = details?.code || solveData.code;
        const rtDisplay = details?.runtimeDisplay || solveData.runtimeDisplay || 'N/A';
        const rtPercentile = details?.runtimePercentile ?? solveData.runtimePercentile ?? null;
        const memDisplay = details?.memoryDisplay || solveData.memoryDisplay || 'N/A';
        const memPercentile = details?.memoryPercentile ?? solveData.memoryPercentile ?? null;

        if (codeToCommit) {
          await gh.commitProblemSolution(owner, repo, {
            frontendId: details?.question?.questionFrontendId || details?.question?.questionId || solveData.id || 1,
            title: details?.question?.title || solveData.title || 'Problem',
            titleSlug: details?.question?.titleSlug || solveData.slug || 'problem',
            difficulty: details?.question?.difficulty || solveData.difficulty || 'Medium',
            content: details?.question?.content || '',
            code: codeToCommit,
            lang: details?.lang?.name || solveData.lang || 'python3',
            runtimeDisplay: rtDisplay,
            runtimePercentile: rtPercentile,
            memoryDisplay: memDisplay,
            memoryPercentile: memPercentile,
            timestamp: details?.timestamp || Math.floor(Date.now() / 1000),
            branch,
          });

          await gh.updateCatalogReadme(owner, repo, branch);
          sendDesktopNotification(
            '⚡ Problem Synced to GitHub!',
            `#${details?.question?.questionFrontendId || ''} ${details?.question?.title || solveData.title} committed with authentic metrics (${rtDisplay})!`
          );
        }
      } catch (ghErr) {
        console.warn('[Background] Async GitHub commit notice:', ghErr.message);
      }
    })();
  }

  // 3. Check if this solve completes an active 1v1 Duel Match
  let duelWin = false;
  let activeDuel = data.active_duel;

  if (!activeDuel || activeDuel.status !== 'active') {
    try {
      const duelStatus = await FirebaseSquads.checkDuelStatus(username, squadCode);
      if (duelStatus.activeDuel && duelStatus.activeDuel.status === 'active') {
        activeDuel = duelStatus.activeDuel;
      }
    } catch (statusErr) {
      console.warn('[Background] Duel status check fallback notice:', statusErr);
    }
  }

  if (activeDuel && (activeDuel.status === 'active' || activeDuel.status === 'pending')) {
    const duel = activeDuel;
    const duelSlug = (duel.problem?.slug || '').toLowerCase().trim();
    const solveSlug = (solveData.slug || solveData.titleSlug || '').toLowerCase().trim();

    if (duelSlug && solveSlug && (duelSlug === solveSlug || duelSlug.includes(solveSlug) || solveSlug.includes(duelSlug))) {
      try {
        await FirebaseSquads.submitDuelSolve(duel.id, username, solveData);
        duelWin = true;
        await sendDesktopNotification(
          '🏆 1v1 DUEL VICTORY!',
          `You solved #${duel.problem.id} ${duel.problem.title} before your opponent! (+50 XP)`
        );
      } catch (err) {
        console.warn('[Background] Duel submit solve notice:', err);
      }
    }
  }

  // 4. Desktop solve notification
  if (!duelWin) {
    await sendDesktopNotification(
      '⚡ Problem Accepted!',
      `#${solveData.id || ''} ${solveData.title || 'Solution'} recorded! 🔥 Streak: ${streak}d`
    );
  }

  return {
    success: true,
    streak,
    xp,
    xpEarned: diffXp,
    todaySolved,
    duelWin,
    runtimeDisplay: solveData.runtimeDisplay || '0 ms',
    runtimePercentile: solveData.runtimePercentile ?? null,
    memoryDisplay: solveData.memoryDisplay || '0 MB',
    memoryPercentile: solveData.memoryPercentile ?? null,
  };
}

/**
 * Full Asynchronous Background GitHub Solution Sync Engine
 */
let isSyncInProgress = false;

async function startAsyncGitHubSync() {
  if (isSyncInProgress) {
    return { success: true, message: 'Sync already in progress' };
  }
  isSyncInProgress = true;

  (async () => {
    try {
      const data = await chrome.storage.local.get([
        'github_token',
        'github_repo_owner',
        'github_repo_name',
        'github_branch',
        'display_name',
        'leetcode_username',
        'user_solved_slugs',
      ]);

      const token = data.github_token;
      const owner = data.github_repo_owner || data.display_name || 'User';
      const repo = data.github_repo_name || 'leetcode-submissions';
      const branch = data.github_branch || 'main';
      let lcUsername = data.leetcode_username;

      if (!token) {
        await chrome.storage.local.set({
          sync_status: { state: 'error', progress: 100, message: 'No GitHub token configured' }
        });
        isSyncInProgress = false;
        return;
      }

      await chrome.storage.local.set({
        sync_status: { state: 'syncing', progress: 5, message: 'Connecting to GitHub & LeetCode...' }
      });

      // 1. Resolve LeetCode username if needed
      if (!lcUsername) {
        const lcUser = await LeetCodeAPI.getCurrentUser();
        if (lcUser?.username) {
          lcUsername = lcUser.username;
          await chrome.storage.local.set({ leetcode_username: lcUsername });
        } else {
          lcUsername = owner;
        }
      }

      // 2. Fetch User Stats
      let stats = null;
      if (lcUsername) {
        stats = await LeetCodeAPI.getUserStats(lcUsername);
      }

      const totalCount = stats?.total ?? 0;
      const easyCount = stats?.easy ?? 0;
      const medCount = stats?.med ?? 0;
      const hardCount = stats?.hard ?? 0;

      const gh = new GitHubAPI(token);
      await gh.ensureRepository(repo);

      await chrome.storage.local.set({
        sync_status: { state: 'syncing', progress: 20, message: 'Scanning existing repository files...' }
      });

      const existingSlugs = await gh.getExistingProblemSlugs(owner, repo, branch);

      await chrome.storage.local.set({
        sync_status: { state: 'syncing', progress: 35, message: 'Fetching accepted submissions from LeetCode...' }
      });

      const userSolvedSlugs = new Set(data.user_solved_slugs || []);
      let syncedCount = totalCount;
      let newPushedCount = 0;

      const acceptedSubs = await LeetCodeAPI.fetchAllAcceptedSubmissions((count, sub) => {
        chrome.storage.local.set({
          sync_status: {
            state: 'syncing',
            progress: Math.min(45, 20 + Math.floor(count / 3)),
            message: `Fetched ${count} accepted problems (${sub.title})...`
          }
        });
      }, lcUsername);

      if (acceptedSubs && acceptedSubs.length > 0) {
        syncedCount = acceptedSubs.length;
        acceptedSubs.forEach(s => userSolvedSlugs.add(s.titleSlug));

        // Filter missing submissions: skip any problem already committed in repository
        const missingSubs = acceptedSubs.filter(s => {
          const slug = (s.titleSlug || '').toLowerCase().trim();
          return slug && !existingSlugs.has(slug) && !existingSlugs.has(s.titleSlug);
        });

        if (missingSubs.length > 0) {
          for (let i = 0; i < missingSubs.length; i++) {
            const sub = missingSubs[i];
            const currentNum = i + 1;
            const pct = Math.round(45 + (currentNum / missingSubs.length) * 50);

            await chrome.storage.local.set({
              sync_status: {
                state: 'syncing',
                progress: pct,
                message: `[${currentNum}/${missingSubs.length}] Committing #${sub.title}...`
              }
            });

            try {
              let details = null;
              if (sub.id) {
                details = await LeetCodeAPI.getSubmissionDetails(sub.id);
              }

              let probContent = details?.question?.content;
              let probFrontendId = details?.question?.questionFrontendId || details?.question?.questionId;
              let probDiff = details?.question?.difficulty || 'Medium';

              if (!probContent) {
                const q = await LeetCodeAPI.getQuestionDetails(sub.titleSlug);
                if (q) {
                  probContent = q.content;
                  probFrontendId = q.questionFrontendId || q.questionId;
                  probDiff = q.difficulty || probDiff;
                }
              }

              const codeToCommit = details?.code || `// Solution for ${sub.title}\n// Runtime: ${sub.runtime || 'N/A'}, Memory: ${sub.memory || 'N/A'}\n`;

              await gh.commitProblemSolution(owner, repo, {
                frontendId: probFrontendId || currentNum,
                title: sub.title || sub.titleSlug,
                titleSlug: sub.titleSlug,
                difficulty: probDiff,
                content: probContent || '',
                code: codeToCommit,
                lang: sub.lang || 'python3',
                runtimeDisplay: details?.runtimeDisplay || sub.runtime,
                runtimePercentile: details?.runtimePercentile,
                memoryDisplay: details?.memoryDisplay || sub.memory,
                memoryPercentile: details?.memoryPercentile,
                timestamp: sub.timestamp,
                branch,
              });
              newPushedCount++;
              // 350ms delay between commits for reliable GitHub ref propagation
              await new Promise(r => setTimeout(r, 350));
            } catch (commitErr) {
              console.warn(`[Background Sync] Commit error on ${sub.titleSlug}:`, commitErr);
            }
          }
        }

        // Always regenerate and refresh the root README problem catalog
        try {
          await chrome.storage.local.set({
            sync_status: { state: 'syncing', progress: 95, message: 'Updating problem catalog in README.md...' }
          });
          await gh.updateCatalogReadme(owner, repo, branch);
        } catch (readmeErr) {
          console.warn('[Background Sync] README catalog update notice:', readmeErr);
        }
      }

      const successMsg = newPushedCount > 0
        ? `✓ Pushed ${newPushedCount} missing solutions! (${syncedCount} total in ${owner}/${repo})`
        : `✓ All ${syncedCount} solutions already up-to-date in ${owner}/${repo}!`;

      await chrome.storage.local.set({
        user_solved_slugs: Array.from(userSolvedSlugs),
        solved_easy_count: easyCount,
        solved_med_count: medCount,
        solved_hard_count: hardCount,
        total_solved: syncedCount,
        sync_status: {
          state: 'idle',
          progress: 100,
          lastSync: Date.now(),
          successText: successMsg,
        }
      });

      sendDesktopNotification(
        '⚡ GitHub Sync Complete!',
        newPushedCount > 0
          ? `Successfully pushed ${newPushedCount} solutions to ${owner}/${repo}!`
          : `All ${syncedCount} solutions are up-to-date in your repository.`
      );
    } catch (err) {
      console.warn('[Background Sync] Global error:', err);
      await chrome.storage.local.set({
        sync_status: { state: 'error', progress: 100, message: `Sync notice: ${err.message}` }
      });
    } finally {
      isSyncInProgress = false;
    }
  })();

  return { success: true, message: 'Asynchronous sync initiated' };
}


