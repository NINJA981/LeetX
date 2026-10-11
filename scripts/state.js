/**
 * LeetX Squads - chrome.storage.local helpers shared by the worker and popup.
 */

import {
  achievementStats, applyStreakFreezes, computeStreak, newlyUnlocked, pruneHistory, sanitizeName, shiftDateKey, toDateKey,
} from './core.js';

export const SETTINGS_DEFAULTS = {
  notifications_enabled: true,
  notify_squad_solves_enabled: true,
  share_solves_enabled: true,
  reminder_enabled: true,
  reminder_hour: 20,
  daily_goal: 1,
  theme_preference: 'system',
  github_branch: 'main',
  github_repo_name: 'leetcode-submissions',
  companion_enabled: true,
  auto_review_enabled: true,
  contest_reminders_enabled: true,
  weekly_recap_enabled: true,
  // Everyone starts with one freeze so the mechanic is visible from day one.
  streak_freezes: 1,
};

const STATE_VERSION = 2;

export async function getStorage(keys) {
  return chrome.storage.local.get(keys);
}

/** Fill in missing settings without touching values the user already chose. */
export async function applyDefaults() {
  const current = await chrome.storage.local.get(Object.keys(SETTINGS_DEFAULTS));
  const missing = {};
  for (const [k, v] of Object.entries(SETTINGS_DEFAULTS)) {
    if (current[k] === undefined) missing[k] = v;
  }
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
}

/**
 * v1 stored only `streak_count` + `last_solved_date`. Rebuild an equivalent
 * day-by-day history so upgrading users keep their streak.
 */
export async function migrateLegacyState() {
  const data = await chrome.storage.local.get([
    'state_version', 'solve_history', 'streak_count', 'last_solved_date', 'today_solved', 'theme_preference',
    'active_duel', 'incoming_duel', 'my_squad_code',
  ]);
  if (data.state_version >= STATE_VERSION) return;

  const updates = { state_version: STATE_VERSION };
  if (!data.solve_history) {
    const history = {};
    const streak = Number(data.streak_count) || 0;
    if (data.last_solved_date && streak > 0) {
      for (let i = 0; i < streak; i++) history[shiftDateKey(data.last_solved_date, -i)] = 1;
      if (data.today_solved > 1) history[data.last_solved_date] = data.today_solved;
    }
    updates.solve_history = pruneHistory(history);
  }
  if (data.theme_preference === 'leetx') updates.theme_preference = 'neon';
  if (typeof data.my_squad_code === 'string' && data.my_squad_code) {
    // v1 kept membership inside the squad document; re-register under the v2 model on next contact.
    updates.my_squad_code = data.my_squad_code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    updates.squad_needs_rejoin = true;
  }

  await chrome.storage.local.set(updates);
  await chrome.storage.local.remove([
    'streak_count', 'last_solved_date', 'today_solved', 'active_duel', 'incoming_duel', 'last_seen_activity_id',
    'firebase_project_id', 'firebase_api_key', 'target_open_tab',
  ]);
}

export function displayNameFrom(data) {
  return sanitizeName(data.display_name || data.github_repo_owner || data.leetcode_username || 'Player');
}

/** The public squad profile for this user, derived from local state. */
export async function getProfile() {
  const data = await chrome.storage.local.get([
    'display_name', 'github_repo_owner', 'leetcode_username', 'solve_history', 'frozen_days', 'user_xp', 'total_solved',
  ]);
  const today = toDateKey();
  const { streak, todayCount } = computeStreak(data.solve_history, today, data.frozen_days);
  return {
    name: displayNameFrom(data),
    streak,
    todaySolved: todayCount,
    todayDate: today,
    totalSolved: data.total_solved || 0,
    xp: data.user_xp || 0,
  };
}

/** Award XP once per `reasonId` (e.g. a squad event id), so replays never double count. */
export async function awardXp(amount, reasonId = null) {
  const data = await chrome.storage.local.get(['user_xp', 'xp_awarded_ids']);
  const awarded = data.xp_awarded_ids || [];
  if (reasonId && awarded.includes(reasonId)) return data.user_xp || 0;
  const xp = (data.user_xp || 0) + Math.max(0, Math.floor(amount));
  await chrome.storage.local.set({
    user_xp: xp,
    xp_awarded_ids: reasonId ? [...awarded, reasonId].slice(-300) : awarded,
  });
  return xp;
}

/** Record a finished duel exactly once and return whether this user won. */
export async function recordDuelOutcome(duel, uid) {
  const data = await chrome.storage.local.get(['duel_history']);
  const history = data.duel_history || [];
  if (history.some(h => h.id === duel.id)) return history.find(h => h.id === duel.id);
  const iAmChallenger = duel.challengerUid === uid;
  const entry = {
    id: duel.id,
    won: duel.winnerUid === uid,
    status: duel.status,
    opponentName: iAmChallenger ? duel.opponentName : duel.challengerName,
    problemTitle: duel.problemTitle || null,
    runtime: duel.runtime || null,
    finishedAt: duel.finishedAt || Date.now(),
  };
  await chrome.storage.local.set({ duel_history: [entry, ...history].slice(0, 50) });
  if (entry.won) await awardXp(50, `duel_${duel.id}`);
  return entry;
}

export function duelRecord(history = []) {
  const played = history.length;
  const wins = history.filter(h => h.won).length;
  return { played, wins, losses: played - wins, winRate: played ? Math.round((wins / played) * 100) : 0 };
}

/**
 * Record any achievements the current state has earned. Returns the newly
 * unlocked ones (each exactly once, across popup and worker).
 */
export async function recordAchievements(roadmaps) {
  const data = await chrome.storage.local.get(null);
  const unlocked = data.achievements || {};
  const fresh = newlyUnlocked(achievementStats(data, roadmaps), unlocked);
  const now = Date.now();
  if (data.achievements === undefined) {
    // First run (or upgrade): record what was already earned without announcing it.
    await chrome.storage.local.set({ achievements: Object.fromEntries(fresh.map(a => [a.id, now])) });
    return [];
  }
  if (!fresh.length) return [];
  // Re-read right before writing: the popup and the worker may both be recording.
  const latest = (await chrome.storage.local.get('achievements')).achievements || {};
  const announce = fresh.filter(a => !latest[a.id]);
  const next = { ...latest };
  for (const a of announce) next[a.id] = now;
  await chrome.storage.local.set({ achievements: next });
  return announce;
}

export async function increment(key, by = 1) {
  const current = (await chrome.storage.local.get(key))[key] || 0;
  await chrome.storage.local.set({ [key]: current + by });
  return current + by;
}

/**
 * Spend streak freezes on missed days (idempotent). Returns the days covered
 * plus the resulting streak, so callers can tell the user.
 */
export async function applyFreezesToStorage() {
  const data = await chrome.storage.local.get(['solve_history', 'frozen_days', 'streak_freezes']);
  const res = applyStreakFreezes({ history: data.solve_history || {}, frozenDays: data.frozen_days || [], freezes: data.streak_freezes || 0 });
  if (!res.used.length) return { used: [] };
  const used = (await chrome.storage.local.get('freezes_used')).freezes_used || 0;
  await chrome.storage.local.set({ frozen_days: res.frozenDays, streak_freezes: res.freezes, freezes_used: used + res.used.length });
  const { streak } = computeStreak(data.solve_history, toDateKey(), res.frozenDays);
  return { used: res.used, streak, left: res.freezes };
}
