/**
 * LeetX Squads - Manifest V3 background worker.
 * Owns: solve processing, streak badge, reminders, squad/duel notifications and
 * GitHub sync. All state lives in chrome.storage.local so the worker can be
 * suspended at any time.
 */

import {
  computeStreak,
  earnsFreeze,
  formatDuration,
  isNewerVersion,
  isReviewDue,
  isStreakMilestone,
  newReviewEntry,
  nextReview,
  shiftDateKey,
  weekStart,
  weekSummary,
  levelFromXp,
  msUntilMidnight,
  normalizeDifficulty,
  parseLeetCodeCalendar,
  pruneHistory,
  recordSolveInHistory,
  sameSlug,
  solveMatchesChallenge,
  toDateKey,
  xpForSolve,
} from './core.js';
import { Auth, Duels, SquadError, Squads } from './firebase.js';
import { GitHubAPI } from './github.js';
import { LEETCODE_STATUS_ACCEPTED, LeetCodeAPI } from './leetcode.js';
import {
  applyDefaults,
  applyFreezesToStorage,
  awardXp,
  getProfile,
  migrateLegacyState,
  recordAchievements,
  recordDuelOutcome,
} from './state.js';

const ALARM_TICK = 'leetx_tick';
const ALARM_SQUAD = 'leetx_squad_poll';
const ALARM_UPDATE = 'leetx_update_check';
const RELEASES_API = 'https://api.github.com/repos/NINJA981/LeetX/releases/latest';
const LEETCODE_ORIGIN = 'https://leetcode.com/';
const BADGE = { done: '#15803D', pending: '#B45309', risk: '#B91C1C' };

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function ensureAlarms() {
  if (!(await chrome.alarms.get(ALARM_TICK))) chrome.alarms.create(ALARM_TICK, { periodInMinutes: 15, delayInMinutes: 1 });
  if (!(await chrome.alarms.get(ALARM_SQUAD))) chrome.alarms.create(ALARM_SQUAD, { periodInMinutes: 1, delayInMinutes: 1 });
  if (!(await chrome.alarms.get(ALARM_UPDATE))) chrome.alarms.create(ALARM_UPDATE, { periodInMinutes: 12 * 60, delayInMinutes: 2 });
}

/** Ask GitHub for the latest release and remember whether it is newer than this install. Failures are silent. */
async function checkForUpdate() {
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!res.ok) return;
    const release = await res.json();
    const latest = String(release.tag_name || '').replace(/^v/i, '');
    if (!latest) return;
    await chrome.storage.local.set({
      update_info: {
        latest,
        available: isNewerVersion(latest, chrome.runtime.getManifest().version),
        url: release.html_url || 'https://github.com/NINJA981/LeetX/releases/latest',
        checkedAt: Date.now(),
      },
    });
  } catch (err) {
    console.warn('[LeetX] update check', err);
  }
}

async function bootstrap() {
  await migrateLegacyState();
  await applyDefaults();
  await ensureAlarms();
  checkForUpdate();
  await spendFreezes();
  await refreshBadge();
  await rejoinMigratedSquad();
  await announceAchievements();
}

async function spendFreezes() {
  const res = await applyFreezesToStorage();
  if (!res.used.length) return;
  const missed = res.used.length === 1 ? 'yesterday' : `${res.used.length} days`;
  await notify('today', 'Streak freeze used', `You missed ${missed}, so a freeze kept your ${res.streak}-day streak alive. ${res.left} left.`);
  await announceAchievements();
}

/** Record newly earned achievements and tell the user about each one. */
async function announceAchievements() {
  const fresh = await recordAchievements(await getRoadmaps()).catch(() => []);
  for (const a of fresh.slice(0, 2)) await notify('progress', `Achievement: ${a.title}`, a.desc);
  return fresh;
}

/** v1 members re-register under the v2 model (the first one migrates the squad document). */
async function rejoinMigratedSquad() {
  const { my_squad_code: code, squad_needs_rejoin: needed } = await chrome.storage.local.get(['my_squad_code', 'squad_needs_rejoin']);
  if (!code || !needed) return;
  try {
    await Squads.joinSquad(code, await getProfile(), { announce: false });
    await chrome.storage.local.remove('squad_needs_rejoin');
  } catch (err) {
    if (err instanceof SquadError) await chrome.storage.local.remove(['squad_needs_rejoin', 'my_squad_code']);
    else console.warn('[LeetX] squad rejoin', err);
  }
}

chrome.runtime.onInstalled.addListener(() => { bootstrap().catch(err => console.warn('[LeetX] install bootstrap', err)); });
chrome.runtime.onStartup.addListener(() => { bootstrap().catch(err => console.warn('[LeetX] startup bootstrap', err)); });

chrome.alarms.onAlarm.addListener(async alarm => {
  try {
    if (alarm.name === ALARM_TICK) {
      await spendFreezes();
      await refreshBadge();
      await maybeSendReminder();
      await maybeSendWeeklyRecap();
      await maybeRemindContest();
    } else if (alarm.name === ALARM_SQUAD) {
      await pollSquadEvents();
    } else if (alarm.name === ALARM_UPDATE) {
      await checkForUpdate();
    }
  } catch (err) {
    console.warn(`[LeetX] alarm ${alarm.name}`, err);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.solve_history || changes.frozen_days || changes.daily_goal)) refreshBadge();
});

if (chrome.notifications?.onClicked) {
  chrome.notifications.onClicked.addListener(async id => {
    chrome.notifications.clear(id);
    const target = id.split(':')[0];
    if (['squad', 'duels', 'today', 'progress'].includes(target)) await chrome.storage.session?.set({ open_view: target }).catch(() => {});
    try { await chrome.action.openPopup(); } catch { /* requires a user gesture on some browsers */ }
  });
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

const isFromLeetCodeTab = sender => Boolean(sender.tab && sender.url?.startsWith(LEETCODE_ORIGIN));
const isFromExtensionPage = sender => sender.id === chrome.runtime.id && !sender.tab && sender.url?.startsWith(chrome.runtime.getURL(''));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const reply = promise => {
    promise.then(sendResponse).catch(err => sendResponse({ success: false, error: err?.message || String(err) }));
    return true;
  };

  switch (message?.type) {
    case 'SYNC_SUBMISSION':
      if (!isFromLeetCodeTab(sender)) return false;
      return reply(handleAcceptedSubmission(message));
    case 'GET_PROBLEM_CONTEXT':
      if (!isFromLeetCodeTab(sender)) return false;
      return reply(getProblemContext(String(message.slug || '')));
    case 'START_FULL_SYNC':
      if (!isFromExtensionPage(sender)) return false;
      return reply(startFullSync());
    case 'REFRESH_STATE':
      if (!isFromExtensionPage(sender)) return false;
      return reply(refreshFromLeetCode().then(() => refreshBadge()).then(() => ({ success: true })));
    case 'POLL_SQUAD':
      if (!isFromExtensionPage(sender)) return false;
      return reply(pollSquadEvents({ force: true }).then(() => ({ success: true })));
    case 'TEST_NOTIFICATION':
      if (!isFromExtensionPage(sender)) return false;
      return reply(notify('today', 'Notifications are on', "You'll hear about duels, nudges and your streak here.", { force: true }).then(() => ({ success: true })));
    default:
      return false;
  }
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

async function notify(target, title, message, { force = false, inPage = true } = {}) {
  const { notifications_enabled: enabled } = await chrome.storage.local.get('notifications_enabled');
  if (enabled === false && !force) return;

  chrome.notifications?.create(`${target}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
    title: String(title).slice(0, 80),
    message: String(message).slice(0, 200),
    priority: 1,
  }, () => void chrome.runtime.lastError);

  if (inPage) broadcastToLeetCodeTabs({ type: 'SHOW_INPAGE_NOTIFICATION', title, message });
}

function broadcastToLeetCodeTabs(payload) {
  chrome.tabs.query({ url: 'https://leetcode.com/*' }, tabs => {
    for (const tab of tabs || []) {
      chrome.tabs.sendMessage(tab.id, payload, () => void chrome.runtime.lastError);
    }
  });
}

// ---------------------------------------------------------------------------
// Badge & reminders
// ---------------------------------------------------------------------------

async function refreshBadge() {
  const { solve_history: history, frozen_days: frozen } = await chrome.storage.local.get(['solve_history', 'frozen_days']);
  const { streak, solvedToday } = computeStreak(history, toDateKey(), frozen);
  const atRisk = !solvedToday && streak > 0 && msUntilMidnight() < 3 * 60 * 60 * 1000;
  await chrome.action.setBadgeText({ text: streak > 0 ? String(streak) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: solvedToday ? BADGE.done : atRisk ? BADGE.risk : BADGE.pending });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#FFFFFF' }).catch(() => {});
  await chrome.action.setTitle({
    title: streak === 0
      ? 'LeetX Squads'
      : solvedToday ? `LeetX Squads · ${streak}-day streak, done for today` : `LeetX Squads · ${streak}-day streak, solve one today to keep it`,
  });
}

async function maybeSendReminder() {
  const data = await chrome.storage.local.get(['reminder_enabled', 'reminder_hour', 'last_reminder_date', 'solve_history', 'frozen_days', 'streak_freezes']);
  if (data.reminder_enabled === false) return;
  const now = new Date();
  const today = toDateKey(now);
  if (data.last_reminder_date === today || now.getHours() < (data.reminder_hour ?? 20)) return;

  const { streak, solvedToday } = computeStreak(data.solve_history, today, data.frozen_days);
  if (solvedToday) return;

  await chrome.storage.local.set({ last_reminder_date: today });
  const left = formatDuration(msUntilMidnight(now));
  if (streak > 0) {
    const freezeNote = data.streak_freezes ? " A freeze would cover you, but it's better saved." : '';
    await notify('today', `${streak}-day streak ends in ${left}`, `One accepted solve keeps it alive.${freezeNote}`);
  } else {
    await notify('today', 'Start a streak tonight', `One problem before midnight (${left} left) starts day one.`);
  }
}

async function maybeSendWeeklyRecap() {
  const data = await chrome.storage.local.get(['weekly_recap_enabled', 'last_recap_week', 'solve_history']);
  if (data.weekly_recap_enabled === false) return;
  const now = new Date();
  if (now.getDay() !== 0 || now.getHours() < 18) return;
  const monday = weekStart(toDateKey(now));
  if (data.last_recap_week === monday) return;
  await chrome.storage.local.set({ last_recap_week: monday });

  const week = weekSummary(data.solve_history, monday);
  const prev = weekSummary(data.solve_history, shiftDateKey(monday, -7));
  if (!week.solves && !prev.solves) return;
  const delta = week.solves - prev.solves;
  const body = delta > 0
    ? `${delta} more than last week. Carry it into Monday.`
    : delta < 0 ? `${-delta} fewer than last week. One tomorrow gets you back on pace.` : 'Same as last week. Steady wins.';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  await notify('progress', `Your week: ${plural(week.solves, 'solve')} on ${plural(week.days, 'day')}`, body, { inPage: false });
}

const CONTEST_REFRESH_MS = 12 * 60 * 60 * 1000;
const CONTEST_LEAD_MS = 45 * 60 * 1000;

async function getContests() {
  const { contests_cache: cache } = await chrome.storage.local.get('contests_cache');
  if (cache && Date.now() - cache.fetchedAt < CONTEST_REFRESH_MS) return cache.list;
  const list = await LeetCodeAPI.getUpcomingContests();
  if (list.length || !cache) await chrome.storage.local.set({ contests_cache: { fetchedAt: Date.now(), list } });
  return list.length ? list : cache?.list || [];
}

async function maybeRemindContest() {
  const data = await chrome.storage.local.get(['contest_reminders_enabled', 'contest_notified']);
  if (data.contest_reminders_enabled === false) return;
  const now = Date.now();
  const notified = data.contest_notified || [];
  const soon = (await getContests()).find(c => c.startTime > now && c.startTime - now <= CONTEST_LEAD_MS && !notified.includes(c.slug));
  if (!soon) return;
  await chrome.storage.local.set({ contest_notified: [...notified, soon.slug].slice(-20) });
  await notify('today', `${soon.title} starts in ${formatDuration(soon.startTime - now)}`, "Register on LeetCode if you haven't yet.");
}

// ---------------------------------------------------------------------------
// Roadmaps (bundled) - used for challenge matching
// ---------------------------------------------------------------------------

let roadmapCache = null;
async function getRoadmaps() {
  if (roadmapCache) return roadmapCache;
  const load = async name => (await fetch(chrome.runtime.getURL(`assets/data/${name}.json`))).json();
  const [blind75, neetcode150] = await Promise.all([load('blind75'), load('neetcode150')]);
  roadmapCache = { blind75, neetcode150 };
  return roadmapCache;
}

// ---------------------------------------------------------------------------
// Accepted submission pipeline
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9-]{1,120}$/;

async function handleAcceptedSubmission(msg) {
  const slugFromPage = String(msg.titleSlug || '').toLowerCase();
  if (!SLUG_RE.test(slugFromPage)) return { success: false, error: 'Invalid problem' };
  const submissionId = /^\d{1,15}$/.test(String(msg.submissionId || '')) ? String(msg.submissionId) : null;

  const dedupeKey = submissionId || `${slugFromPage}@${Math.floor(Date.now() / 120000)}`;
  const seen = (await chrome.storage.local.get('processed_submissions')).processed_submissions || [];
  if (seen.includes(dedupeKey)) return { success: true, duplicate: true };
  await chrome.storage.local.set({ processed_submissions: [...seen, dedupeKey].slice(-300) });

  // Verify with LeetCode when we have a real submission id.
  const details = submissionId ? await LeetCodeAPI.getSubmissionDetails(submissionId) : null;
  if (details && details.statusCode !== LEETCODE_STATUS_ACCEPTED) {
    return { success: false, error: 'Submission was not accepted' };
  }
  const slug = details?.question?.titleSlug || slugFromPage;
  const question = await LeetCodeAPI.getQuestionDetails(slug);
  const problem = {
    slug,
    id: String(details?.question?.questionFrontendId || question?.questionFrontendId || ''),
    title: details?.question?.title || question?.title || slug.replace(/-/g, ' '),
    difficulty: normalizeDifficulty(details?.question?.difficulty || question?.difficulty || msg.difficulty),
    topicTags: (question?.topicTags || []).map(t => t.slug),
  };

  const state = await chrome.storage.local.get([
    'solve_history', 'frozen_days', 'streak_freezes', 'user_solved_slugs', 'user_xp', 'total_solved',
    'solved_easy_count', 'solved_med_count', 'solved_hard_count', 'solve_times', 'review_schedule',
    'auto_review_enabled', 'reviews_done', 'fast_medium_solves', 'night_solves',
  ]);
  const today = toDateKey();
  const frozen = state.frozen_days || [];
  const before = computeStreak(state.solve_history, today, frozen);
  const solved = new Set(state.user_solved_slugs || []);
  const isNewProblem = !solved.has(slug);
  const isFirstSolveToday = !before.solvedToday;

  const history = recordSolveInHistory(state.solve_history, today);
  const after = computeStreak(history, today, frozen);
  const xpEarned = xpForSolve({ difficulty: problem.difficulty, isNewProblem, isFirstSolveToday });
  const xp = (state.user_xp || 0) + xpEarned;
  solved.add(slug);

  const updates = { solve_history: history, user_xp: xp, user_solved_slugs: [...solved], last_solve: { ...problem, at: Date.now() } };
  if (isNewProblem) {
    const key = { Easy: 'solved_easy_count', Medium: 'solved_med_count', Hard: 'solved_hard_count' }[problem.difficulty];
    updates[key] = (state[key] || 0) + 1;
    updates.total_solved = (state.total_solved || 0) + 1;
  }

  // Streak freezes: one per 7 streak days, capped.
  const freezes = state.streak_freezes || 0;
  const freezeEarned = earnsFreeze(after.streak, isFirstSolveToday, freezes);
  if (freezeEarned) updates.streak_freezes = freezes + 1;

  // Solve timing from the on-page companion (active, visible time only).
  const seconds = Number(msg.solveSeconds);
  const timing = { seconds: null, best: null, isNewBest: false };
  if (Number.isFinite(seconds) && seconds >= 5 && seconds <= 6 * 3600) {
    const times = { ...(state.solve_times || {}) };
    const prev = times[slug];
    timing.seconds = Math.round(seconds);
    timing.best = prev?.best ? Math.min(prev.best, timing.seconds) : timing.seconds;
    timing.isNewBest = Boolean(prev?.best) && timing.seconds < prev.best;
    times[slug] = { best: timing.best, last: timing.seconds, difficulty: problem.difficulty, at: Date.now() };
    updates.solve_times = Object.fromEntries(Object.entries(times).sort((x, y) => y[1].at - x[1].at).slice(0, 500));
    if (problem.difficulty === 'Medium' && timing.seconds < 600) updates.fast_medium_solves = (state.fast_medium_solves || 0) + 1;
  }
  if (new Date().getHours() < 5) updates.night_solves = (state.night_solves || 0) + 1;

  // Spaced review: a due re-solve counts as a successful review; new Medium/Hard solves get scheduled.
  const schedule = { ...(state.review_schedule || {}) };
  let review = null;
  if (schedule[slug] && isReviewDue(schedule[slug])) {
    const next = nextReview(schedule[slug], 'good');
    if (next) schedule[slug] = next;
    else delete schedule[slug];
    updates.reviews_done = (state.reviews_done || 0) + 1;
    review = { done: true, nextInDays: next?.interval || null };
  } else if (!schedule[slug] && isNewProblem && problem.difficulty !== 'Easy' && state.auto_review_enabled !== false) {
    schedule[slug] = newReviewEntry(problem);
    review = { scheduledInDays: schedule[slug].interval };
  }
  if (review) updates.review_schedule = schedule;

  await chrome.storage.local.set(updates);
  await refreshBadge();
  const achievements = await recordAchievements(await getRoadmaps()).catch(() => []);

  const runtime = details?.runtimeDisplay || msg.runtimeDisplay || null;
  // Network side effects run after we answer the page so the toast is instant.
  queueMicrotask(() => runSolveSideEffects({ problem, details, submissionId, runtime }).catch(err => console.warn('[LeetX] solve side effects', err)));

  const level = levelFromXp(xp);
  return {
    success: true,
    problem: { title: problem.title, id: problem.id, difficulty: problem.difficulty },
    streak: after.streak,
    streakExtended: isFirstSolveToday,
    milestone: isFirstSolveToday && isStreakMilestone(after.streak) ? after.streak : null,
    xpEarned,
    level: level.level,
    leveledUp: levelFromXp(xp - xpEarned).level < level.level,
    isNewProblem,
    freezeEarned,
    freezes: updates.streak_freezes ?? freezes,
    solveSeconds: timing.seconds,
    bestSeconds: timing.best,
    isNewBest: timing.isNewBest,
    review,
    achievements: achievements.map(a => ({ title: a.title, desc: a.desc })),
    runtimeDisplay: runtime,
    runtimePercentile: details?.runtimePercentile ?? msg.runtimePercentile ?? null,
    memoryDisplay: details?.memoryDisplay || msg.memoryDisplay || null,
    memoryPercentile: details?.memoryPercentile ?? msg.memoryPercentile ?? null,
  };
}

async function runSolveSideEffects({ problem, details, submissionId, runtime }) {
  const settings = await chrome.storage.local.get(['my_squad_code', 'share_solves_enabled', 'github_token', 'leetcode_username', 'current_duel_id']);

  const tasks = [];
  // Only squad members can be in a duel - skip the network round-trip otherwise.
  if (settings.my_squad_code || settings.current_duel_id) tasks.push(checkDuelWin(problem, runtime));
  if (settings.my_squad_code && settings.share_solves_enabled !== false) {
    tasks.push(broadcastSolve(settings.my_squad_code, problem));
  }
  if (settings.github_token) {
    tasks.push(enqueueGitHub(() => commitSingleSolve(problem, details, submissionId, settings.leetcode_username)));
  }
  await Promise.allSettled(tasks);
  refreshFromLeetCode().catch(() => {});
}

async function broadcastSolve(code, problem) {
  try {
    const roadmaps = await getRoadmaps();
    const profile = await getProfile();
    const res = await Squads.recordSolve(code, profile, problem, {
      matchesChallenge: (challenge, p) => solveMatchesChallenge(challenge, p, roadmaps),
    });
    if (res.completedChallenge) {
      await awardXp(res.completedChallenge.rewardXp, `challenge_${res.completedChallenge.id}`);
      await notify('squad', 'Squad challenge cleared', `"${res.completedChallenge.title}" · +${res.completedChallenge.rewardXp} XP for everyone`);
    }
  } catch (err) {
    console.warn('[LeetX] squad broadcast', err);
  }
}

async function checkDuelWin(problem, runtime) {
  try {
    const { active, uid } = await Duels.listMine();
    if (!active) return;
    const duelProblem = await Duels.getProblem(active.id);
    if (!duelProblem || !sameSlug(duelProblem.slug, problem.slug)) return;
    const profile = await getProfile();
    const won = await Duels.claimWin(active, profile, runtime);
    const finished = await Duels.get(active.id);
    if (finished) await recordDuelOutcome({ ...finished, problemTitle: duelProblem.title }, uid);
    await announceAchievements();
    if (won) {
      await notify('duels', 'You won the duel', `${duelProblem.title} solved first${runtime ? ` in ${runtime}` : ''}. +50 XP`);
    }
  } catch (err) {
    console.warn('[LeetX] duel check', err);
  }
}

// ---------------------------------------------------------------------------
// LeetCode profile refresh (totals + activity calendar)
// ---------------------------------------------------------------------------

async function refreshFromLeetCode() {
  const data = await chrome.storage.local.get(['leetcode_username', 'history_seeded', 'solve_history']);
  let username = data.leetcode_username;
  if (!username) {
    username = (await LeetCodeAPI.getCurrentUser())?.username;
    if (username) await chrome.storage.local.set({ leetcode_username: username });
  }
  if (!username) return;

  const stats = await LeetCodeAPI.getUserStats(username);
  if (!stats) return;
  const calendar = parseLeetCodeCalendar(stats.submissionCalendar);
  const updates = { lc_calendar: pruneHistory(calendar), stats_updated_at: Date.now() };
  if (stats.total > 0) {
    Object.assign(updates, {
      total_solved: stats.total,
      solved_easy_count: stats.easy,
      solved_med_count: stats.med,
      solved_hard_count: stats.hard,
    });
  }
  // First run: seed the streak history from LeetCode activity before today, so
  // existing habits carry over instead of starting from zero.
  if (!data.history_seeded) {
    const today = toDateKey();
    const seeded = { ...(data.solve_history || {}) };
    for (const [day, count] of Object.entries(calendar)) {
      if (day < today && !seeded[day]) seeded[day] = count;
    }
    updates.solve_history = pruneHistory(seeded);
    updates.history_seeded = true;
  }
  await chrome.storage.local.set(updates);
}

// ---------------------------------------------------------------------------
// Squad polling -> notifications
// ---------------------------------------------------------------------------

// The alarm fires every minute, but we only hit Firestore every 5 minutes unless
// a duel is in play - an empty poll still costs a billed read per user.
const SQUAD_POLL_IDLE_MS = 5 * 60_000;
const SQUAD_POLL_DUEL_MS = 60_000;

async function pollSquadEvents({ force = false } = {}) {
  const data = await chrome.storage.local.get(['my_squad_code', 'squad_last_seen_event', 'notify_squad_solves_enabled', 'squad_last_poll', 'current_duel_id']);
  const code = data.my_squad_code;
  if (!code) return;
  const interval = data.current_duel_id ? SQUAD_POLL_DUEL_MS : SQUAD_POLL_IDLE_MS;
  if (!force && Date.now() - (data.squad_last_poll || 0) < interval - 5000) return;
  await chrome.storage.local.set({ squad_last_poll: Date.now() });

  let events;
  let uid;
  try {
    uid = await Auth.getUid();
    const since = data.squad_last_seen_event || Date.now();
    events = await Squads.listEvents(code, { since, limit: 25 });
  } catch (err) {
    if (err?.isPermissionDenied) await handleLostMembership(code);
    return;
  }
  if (!events.length) return;

  await chrome.storage.local.set({ squad_last_seen_event: Math.max(...events.map(e => e.createdAt)) });

  const others = events.filter(e => e.actorUid !== uid).sort((a, b) => a.createdAt - b.createdAt);
  const solves = [];
  let sent = 0;
  const send = async (target, title, body) => {
    if (sent >= 3) return;
    sent += 1;
    await notify(target, title, body);
  };

  for (const e of others) {
    const targetsMe = e.targetUid === uid;
    switch (e.type) {
      case 'duel_challenge':
        if (targetsMe) await send('duels', `${e.actorName} challenged you`, 'A 1v1 race is waiting. The problem is revealed when you accept.');
        break;
      case 'duel_accepted':
        if (targetsMe) await send('duels', 'Duel on', `${e.actorName} accepted. The clock is running.`);
        break;
      case 'duel_result':
      case 'duel_forfeit':
        if (targetsMe && e.duelId) await handleRemoteDuelResult(e.duelId, uid);
        break;
      case 'nudge':
        if (targetsMe) await send('today', `${e.actorName} nudged you`, 'Your squad is waiting on your solve today.');
        break;
      case 'kick':
        if (targetsMe) {
          await chrome.storage.local.remove(['my_squad_code', 'squad_cache']);
          await send('squad', 'Removed from squad', `${e.actorName} removed you from the squad.`);
        }
        break;
      case 'challenge_complete':
        if (e.rewardXp) await awardXp(e.rewardXp, `challenge_event_${e.id}`);
        await send('squad', 'Squad challenge cleared', `"${e.challengeTitle}" · +${e.rewardXp || 0} XP`);
        break;
      case 'solve':
        solves.push(e);
        break;
      default:
        break;
    }
  }

  if (solves.length && data.notify_squad_solves_enabled !== false) {
    if (solves.length === 1) {
      const s = solves[0];
      await send('squad', `${s.actorName} solved ${s.problem?.title || 'a problem'}`, s.streak ? `${s.streak}-day streak` : 'Your move.');
    } else {
      const names = [...new Set(solves.map(s => s.actorName))];
      await send('squad', `${solves.length} new squad solves`, `${names.slice(0, 3).join(', ')}${names.length > 3 ? ' and others' : ''} are moving.`);
    }
  }
}

async function handleLostMembership(code) {
  const { squad_needs_rejoin: needsRejoin } = await chrome.storage.local.get('squad_needs_rejoin');
  if (needsRejoin) return rejoinMigratedSquad();
  const snap = await Squads.getSnapshot(code).catch(() => null);
  if (!snap) return;
  if (snap.status === 'legacy') return rejoinMigratedSquad();
  if (snap.status !== 'ok') await chrome.storage.local.remove(['my_squad_code', 'squad_cache']);
}

async function getProblemContext(slug) {
  if (!SLUG_RE.test(slug)) return { success: false };
  const data = await chrome.storage.local.get([
    'companion_enabled', 'user_solved_slugs', 'review_schedule', 'solve_times', 'solve_history', 'frozen_days', 'streak_freezes',
  ]);
  const roadmaps = await getRoadmaps();
  const lists = [];
  for (const [key, label] of [['blind75', 'Blind 75'], ['neetcode150', 'NeetCode 150']]) {
    const p = roadmaps[key].find(x => x.slug === slug);
    if (p) lists.push({ label, category: p.category });
  }
  const review = data.review_schedule?.[slug] || null;
  const { streak, solvedToday } = computeStreak(data.solve_history, toDateKey(), data.frozen_days);
  return {
    success: true,
    enabled: data.companion_enabled !== false,
    solvedBefore: (data.user_solved_slugs || []).includes(slug),
    lists,
    reviewDue: Boolean(review && isReviewDue(review)),
    bestSeconds: data.solve_times?.[slug]?.best || null,
    streak,
    solvedToday,
    freezes: data.streak_freezes || 0,
  };
}

async function handleRemoteDuelResult(duelId, uid) {
  const duel = await Duels.get(duelId).catch(() => null);
  if (!duel || !['completed', 'forfeited'].includes(duel.status)) return;
  const problem = await Duels.getProblem(duelId).catch(() => null);
  const outcome = await recordDuelOutcome({ ...duel, problemTitle: problem?.title }, uid);
  await announceAchievements();
  if (outcome.won) {
    await notify('duels', 'You won the duel', duel.status === 'forfeited' ? 'Your opponent forfeited. +50 XP' : '+50 XP');
  } else {
    await notify('duels', `${duel.winnerName} won the duel`, problem ? `They solved ${problem.title} first${duel.runtime ? ` (${duel.runtime})` : ''}.` : 'Rematch?');
  }
}

// ---------------------------------------------------------------------------
// GitHub sync (serialized so commits never race each other)
// ---------------------------------------------------------------------------

let githubQueue = Promise.resolve();
function enqueueGitHub(task) {
  const run = githubQueue.then(task);
  githubQueue = run.catch(() => {});
  return run;
}

async function getGitHubConfig() {
  const data = await chrome.storage.local.get(['github_token', 'github_repo_owner', 'github_repo_name', 'github_branch', 'github_repo_private']);
  if (!data.github_token) return null;
  const api = new GitHubAPI(data.github_token);
  let owner = data.github_repo_owner;
  const repo = data.github_repo_name || 'leetcode-submissions';
  if (!owner) {
    owner = (await api.ensureRepository(repo, { isPrivate: data.github_repo_private !== false })).owner;
    await chrome.storage.local.set({ github_repo_owner: owner });
  }
  return { api, owner, repo, branch: data.github_branch || 'main' };
}

async function resolveSubmissionDetails(problem, details, submissionId, username) {
  if (details?.code) return details;
  if (submissionId) {
    const fresh = await LeetCodeAPI.getSubmissionDetails(submissionId);
    if (fresh?.code) return fresh;
  }
  if (username) {
    const recent = await LeetCodeAPI.getRecentAcSubmissions(username, 15);
    const match = recent.find(s => sameSlug(s.titleSlug, problem.slug));
    if (match) return LeetCodeAPI.getSubmissionDetails(match.id);
  }
  return null;
}

async function commitSingleSolve(problem, details, submissionId, username) {
  const cfg = await getGitHubConfig();
  if (!cfg) return;
  const full = await resolveSubmissionDetails(problem, details, submissionId, username);
  if (!full?.code) {
    await markGitHubPending(problem.slug);
    return;
  }
  const notes = (await chrome.storage.local.get(`notes_${problem.slug}`))[`notes_${problem.slug}`] || '';
  try {
    const result = await commitWithRepoRecovery(cfg, {
      frontendId: full.question?.questionFrontendId || problem.id,
      title: full.question?.title || problem.title,
      titleSlug: problem.slug,
      difficulty: full.question?.difficulty || problem.difficulty,
      content: full.question?.content || '',
      code: full.code,
      lang: full.lang?.name,
      notes,
      runtimeDisplay: full.runtimeDisplay,
      runtimePercentile: full.runtimePercentile,
      memoryDisplay: full.memoryDisplay,
      memoryPercentile: full.memoryPercentile,
      timestamp: full.timestamp,
      branch: cfg.branch,
    });
    if (result?.unchanged) return;
    await cfg.api.updateCatalogReadme(cfg.owner, cfg.repo, cfg.branch).catch(err => console.warn('[LeetX] catalog', err));
    await chrome.storage.local.set({ github_last_commit: { slug: problem.slug, title: problem.title, at: Date.now() }, github_last_error: null });
    broadcastToLeetCodeTabs({ type: 'SHOW_INPAGE_NOTIFICATION', title: 'Saved to GitHub', message: `${problem.title} → ${cfg.owner}/${cfg.repo}` });
  } catch (err) {
    await markGitHubPending(problem.slug);
    await chrome.storage.local.set({ github_last_error: { message: err.message, at: Date.now() } });
    if (err.status === 401) await notify('today', 'GitHub sync paused', 'Your GitHub token stopped working. Reconnect it in LeetX settings.');
  }
}

async function commitWithRepoRecovery(cfg, problem) {
  try {
    return await cfg.api.commitProblemSolution(cfg.owner, cfg.repo, problem);
  } catch (err) {
    if (err.status !== 404 && err.status !== 409) throw err;
    // Repository or branch missing (deleted, renamed or still empty) - recreate and retry once.
    const { github_repo_private: priv } = await chrome.storage.local.get('github_repo_private');
    await cfg.api.ensureRepository(cfg.repo, { isPrivate: priv !== false });
    return cfg.api.commitProblemSolution(cfg.owner, cfg.repo, problem);
  }
}

async function markGitHubPending(slug) {
  const { github_pending: pending = [] } = await chrome.storage.local.get('github_pending');
  if (!pending.includes(slug)) await chrome.storage.local.set({ github_pending: [...pending, slug].slice(-500) });
}

async function setSyncStatus(status) {
  await chrome.storage.local.set({ sync_status: { ...status, updatedAt: Date.now() } });
}

async function startFullSync() {
  const { sync_status: current } = await chrome.storage.local.get('sync_status');
  if (current?.state === 'syncing' && Date.now() - (current.updatedAt || 0) < 120_000) {
    return { success: true, alreadyRunning: true };
  }
  await setSyncStatus({ state: 'syncing', progress: 2, message: 'Connecting…' });
  enqueueGitHub(runFullSync).catch(async err => {
    await setSyncStatus({ state: 'error', progress: 100, message: err.message || 'Sync failed' });
  });
  return { success: true };
}

async function runFullSync() {
  const cfg = await getGitHubConfig();
  if (!cfg) {
    await setSyncStatus({ state: 'error', progress: 100, message: 'Connect GitHub first.' });
    return;
  }
  const lcUser = await LeetCodeAPI.getCurrentUser();
  if (!lcUser?.username) {
    await setSyncStatus({ state: 'error', progress: 100, message: 'Sign in to leetcode.com in this browser, then try again.' });
    return;
  }
  await chrome.storage.local.set({ leetcode_username: lcUser.username });
  await cfg.api.ensureRepository(cfg.repo, { isPrivate: (await chrome.storage.local.get('github_repo_private')).github_repo_private !== false });

  await setSyncStatus({ state: 'syncing', progress: 8, message: 'Reading your repository…' });
  const existing = await cfg.api.getExistingProblemSlugs(cfg.owner, cfg.repo, cfg.branch);

  await setSyncStatus({ state: 'syncing', progress: 12, message: 'Reading your LeetCode history…' });
  const accepted = await LeetCodeAPI.fetchAllAcceptedSubmissions((found, page) => {
    setSyncStatus({ state: 'syncing', progress: Math.min(30, 12 + page), message: `Found ${found} solved problems…` });
  });

  const missing = accepted.filter(s => !existing.has(s.titleSlug.toLowerCase()));
  let pushed = 0;
  let skipped = 0;
  const notesData = await chrome.storage.local.get(missing.map(s => `notes_${s.titleSlug}`));

  for (let i = 0; i < missing.length; i++) {
    const sub = missing[i];
    await setSyncStatus({
      state: 'syncing',
      progress: Math.round(30 + ((i + 1) / missing.length) * 65),
      message: `Committing ${i + 1} of ${missing.length}: ${sub.title}`,
    });
    try {
      const details = await LeetCodeAPI.getSubmissionDetails(sub.id);
      if (!details?.code) { skipped += 1; continue; }
      await commitWithRepoRecovery(cfg, {
        frontendId: details.question?.questionFrontendId,
        title: details.question?.title || sub.title,
        titleSlug: sub.titleSlug,
        difficulty: details.question?.difficulty,
        content: details.question?.content || '',
        code: details.code,
        lang: details.lang?.name || sub.lang,
        notes: notesData[`notes_${sub.titleSlug}`] || '',
        runtimeDisplay: details.runtimeDisplay,
        runtimePercentile: details.runtimePercentile,
        memoryDisplay: details.memoryDisplay,
        memoryPercentile: details.memoryPercentile,
        timestamp: details.timestamp || sub.timestamp,
        branch: cfg.branch,
      });
      pushed += 1;
      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      if (err.status === 401) throw err;
      skipped += 1;
      console.warn(`[LeetX] sync ${sub.titleSlug}`, err);
    }
  }

  await setSyncStatus({ state: 'syncing', progress: 97, message: 'Updating the README catalog…' });
  await cfg.api.updateCatalogReadme(cfg.owner, cfg.repo, cfg.branch).catch(err => console.warn('[LeetX] catalog', err));

  const { user_solved_slugs: slugs = [] } = await chrome.storage.local.get('user_solved_slugs');
  await chrome.storage.local.set({
    user_solved_slugs: [...new Set([...slugs, ...accepted.map(s => s.titleSlug)])],
    github_pending: [],
    github_last_error: null,
  });
  await refreshFromLeetCode().catch(() => {});

  const parts = [pushed ? `${pushed} new` : 'Everything was already there'];
  if (skipped) parts.push(`${skipped} skipped`);
  await setSyncStatus({
    state: 'idle',
    progress: 100,
    lastSync: Date.now(),
    message: `${accepted.length} solutions in ${cfg.owner}/${cfg.repo} · ${parts.join(' · ')}`,
  });
  if (pushed) await notify('today', 'GitHub sync complete', `${pushed} solutions pushed to ${cfg.owner}/${cfg.repo}.`, { inPage: false });
}

// Run once whenever the worker starts (covers browser restarts and updates).
bootstrap().catch(err => console.warn('[LeetX] bootstrap', err));

