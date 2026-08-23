/**
 * LeetSync Squads - Manifest V3 Background Service Worker
 * Coordinates 1-Click GitHub OAuth, LeetCode Live Syncs, Alarms, and Toolbar Badges.
 */

import { GitHubAPI } from './github.js';
import { LeetCodeAPI } from './leetcode.js';
import { FirebaseSquads } from './firebase.js';

// Setup periodic alarms (streak verification and daily challenge fetch)
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('daily_streak_check', { periodInMinutes: 60 });
  updateToolbarBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'daily_streak_check') {
    updateToolbarBadge();
  }
});

/**
 * Update the extension toolbar icon badge with current streak.
 */
async function updateToolbarBadge() {
  const data = await chrome.storage.local.get(['streak_count', 'today_solved']);
  const streak = data.streak_count || 1;
  const todaySolved = data.today_solved || 0;

  const text = todaySolved > 0 ? `✓${streak}` : `${streak}`;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({
    color: todaySolved > 0 ? '#10B981' : '#F59E0B',
  });
}

/**
 * Handle 1-Click GitHub OAuth Flow via chrome.identity.launchWebAuthFlow.
 */
async function handleGitHubOAuth() {
  const CLIENT_ID = 'Ov23liZ1M6Vp8qB0Qy1X'; // Standard public OAuth client ID for Chrome extensions
  const REDIRECT_URI = chrome.identity.getRedirectURL('github');
  const SCOPE = 'repo user';

  const authUrl = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPE)}`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (redirectResponseUrl) => {
      if (chrome.runtime.lastError || !redirectResponseUrl) {
        // Fallback to manual token prompt if user canceled or browser redirect not configured
        resolve({ success: false, error: chrome.runtime.lastError?.message || 'OAuth was canceled.' });
        return;
      }

      try {
        const urlParams = new URLSearchParams(new URL(redirectResponseUrl).search);
        const code = urlParams.get('code');
        if (!code) throw new Error('No authorization code returned from GitHub.');

        // Exchange code for token via public gatekeeper or direct storage
        resolve({ success: true, code });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
  });
}

/**
 * Process live submission sync to GitHub and broadcast to Squad room.
 */
async function handleSubmissionSync(submissionId, titleSlug) {
  const config = await chrome.storage.local.get([
    'github_token',
    'github_repo_owner',
    'github_repo_name',
    'github_branch',
    'my_squad_code',
    'leetcode_username',
    'streak_count',
    'today_solved',
    'user_xp',
  ]);

  const token = config.github_token;
  const owner = config.github_repo_owner;
  const repo = config.github_repo_name;
  const branch = config.github_branch || 'main';

  if (!token || !owner || !repo) {
    return { success: false, error: 'GitHub is not configured. Please open popup to connect.' };
  }

  // 1. Fetch submission details from LeetCode GraphQL
  const subDetails = await LeetCodeAPI.getSubmissionDetails(submissionId);
  if (!subDetails) throw new Error('Could not fetch submission details.');

  // 2. Fetch question HTML and difficulty
  const questionData = await LeetCodeAPI.getQuestionData(titleSlug);

  const frontendId = questionData?.questionFrontendId || subDetails.question?.questionFrontendId || '1';
  const title = questionData?.title || subDetails.question?.title || titleSlug;
  const difficulty = questionData?.difficulty || 'Medium';
  const content = questionData?.content || '';

  // 3. Commit to GitHub via Octokit Tree API
  const gh = new GitHubAPI(token);
  const commitResult = await gh.commitProblemSolution(owner, repo, {
    frontendId,
    title,
    titleSlug,
    difficulty,
    content,
    code: subDetails.code,
    lang: subDetails.lang?.name || 'java',
    runtimeDisplay: subDetails.runtimeDisplay,
    runtimePercentile: subDetails.runtimePercentile,
    memoryDisplay: subDetails.memoryDisplay,
    memoryPercentile: subDetails.memoryPercentile,
    timestamp: subDetails.timestamp,
    notes: subDetails.notes,
    branch,
  });

  // 4. Update Root Catalog README
  try {
    await gh.updateCatalogReadme(owner, repo, branch);
  } catch (catErr) {
    console.warn('[Background] Catalog update notice:', catErr);
  }

  // 5. Update local streak and XP
  const newTodaySolved = (config.today_solved || 0) + 1;
  const newStreak = (config.streak_count || 1);
  const xpEarned = difficulty === 'Hard' ? 50 : (difficulty === 'Medium' ? 25 : 10);
  const newXp = (config.user_xp || 0) + xpEarned;

  await chrome.storage.local.set({
    today_solved: newTodaySolved,
    user_xp: newXp,
    last_solved_date: new Date().toDateString(),
  });

  updateToolbarBadge();

  // 6. Broadcast to Firebase Squad Room
  if (config.my_squad_code) {
    await FirebaseSquads.broadcastSolve(config.my_squad_code, {
      username: config.leetcode_username || owner,
      title,
      runtimeDisplay: subDetails.runtimeDisplay,
      memoryDisplay: subDetails.memoryDisplay,
      xpEarned,
    });
  }

  return {
    success: true,
    commitResult,
    xpEarned,
    runtimeDisplay: subDetails.runtimeDisplay,
    runtimePercentile: subDetails.runtimePercentile,
    memoryDisplay: subDetails.memoryDisplay,
    difficulty,
  };
}

// Runtime Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SYNC_SUBMISSION') {
    handleSubmissionSync(message.submissionId, message.titleSlug)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Async response
  }

  if (message.type === 'GITHUB_OAUTH_LOGIN') {
    handleGitHubOAuth()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'REFRESH_BADGE') {
    updateToolbarBadge().then(() => sendResponse({ success: true }));
    return true;
  }
});
