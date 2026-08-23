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
    });
  }
  chrome.alarms.create('daily_streak_check', { periodInMinutes: 60 });
  await updateDailyStreakState();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'daily_streak_check') {
    await updateDailyStreakState();
  }
});

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
    color: todaySolved > 0 ? '#10B981' : '#F59E0B',
  });
}

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PROBLEM_SOLVED') {
    handleProblemSolved(message.data).then(res => sendResponse(res));
    return true; // async response
  }

  if (message.type === 'GITHUB_OAUTH_LOGIN') {
    sendResponse({ success: false, error: 'Please enter your GitHub Personal Access Token below.' });
    return true;
  }
});

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
    'user_solved_slugs',
  ]);

  let streak = data.streak_count || 0;
  let todaySolved = data.today_solved || 0;
  let xp = data.user_xp || 0;
  const lastDate = data.last_solved_date;

  const diffXp = solveData.difficulty === 'Hard' ? 50 : (solveData.difficulty === 'Medium' ? 25 : 10);
  xp += diffXp;

  if (lastDate === today) {
    todaySolved += 1;
  } else if (lastDate === yesterday || !lastDate || streak === 0) {
    streak += 1;
    todaySolved = 1;
  }

  // Update solved slugs list
  const solvedSlugs = new Set(data.user_solved_slugs || []);
  if (solveData.slug) solvedSlugs.add(solveData.slug);

  await chrome.storage.local.set({
    streak_count: streak,
    today_solved: todaySolved,
    user_xp: xp,
    last_solved_date: today,
    user_solved_slugs: Array.from(solvedSlugs),
  });

  updateToolbarBadge(streak, todaySolved);

  // Sync to Firebase Squad
  const username = data.display_name || data.github_repo_owner || 'NINJA981';
  const squadCode = data.my_squad_code || '#ALGO99';
  try {
    await FirebaseSquads.broadcastSolve(squadCode, username, solveData.title || 'Problem', streak);
  } catch (e) {
    console.warn('[Background] Firebase broadcast notice:', e.message);
  }

  return { success: true, streak, xp, todaySolved };
}
