/**
 * LeetX Squads - shared, side-effect-free domain logic.
 * Used by the background worker, the popup and the test suite so streaks, XP
 * and challenge matching are computed identically everywhere.
 */

/** True when `latest` ("v2.1.1" or "2.1.1") is a newer x.y.z than `current`. Non-numeric input is never newer. */
export function isNewerVersion(latest, current) {
  const parse = v => String(v || '').trim().replace(/^v/i, '').split('.').map(n => Number.parseInt(n, 10));
  const a = parse(latest);
  const b = parse(current);
  if (a.length < 3 || b.length < 3 || [...a.slice(0, 3), ...b.slice(0, 3)].some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Dates (always the user's local calendar day)
// ---------------------------------------------------------------------------

export function toDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fromDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDateKey(key, days) {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Milliseconds until local midnight. */
export function msUntilMidnight(now = new Date()) {
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  return end.getTime() - now.getTime();
}

export function formatDuration(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function formatTimeAgo(ts, now = Date.now()) {
  if (!ts) return '';
  const sec = Math.max(0, Math.floor((now - Number(ts)) / 1000));
  if (sec < 45) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${Math.max(1, min)}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return `${Math.floor(day / 7)}w`;
}

// ---------------------------------------------------------------------------
// Solve history & streaks
// history: { 'YYYY-MM-DD': solveCount }
// ---------------------------------------------------------------------------

const HISTORY_RETENTION_DAYS = 400;

export function recordSolveInHistory(history, dateKey) {
  const next = { ...(history || {}) };
  next[dateKey] = (next[dateKey] || 0) + 1;
  return pruneHistory(next, dateKey);
}

export function pruneHistory(history, todayKey = toDateKey()) {
  const cutoff = shiftDateKey(todayKey, -HISTORY_RETENTION_DAYS);
  const out = {};
  for (const [k, v] of Object.entries(history || {})) {
    if (k >= cutoff && v > 0) out[k] = v;
  }
  return out;
}

/**
 * Current streak = consecutive active days ending today, or ending yesterday
 * when today has no solve yet (the streak is still alive until midnight).
 * Frozen days (streak freezes) bridge a gap without adding to the count.
 */
export function computeStreak(history, todayKey = toDateKey(), frozenDays = []) {
  const h = history || {};
  const frozen = new Set(frozenDays || []);
  const solvedToday = (h[todayKey] || 0) > 0;
  let cursor = solvedToday ? todayKey : shiftDateKey(todayKey, -1);
  let streak = 0;
  while ((h[cursor] || 0) > 0 || frozen.has(cursor)) {
    if ((h[cursor] || 0) > 0) streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return { streak, solvedToday, todayCount: h[todayKey] || 0 };
}

export function computeLongestStreak(history, frozenDays = []) {
  const frozen = new Set(frozenDays || []);
  const days = [...new Set([...Object.keys(history || {}).filter(k => history[k] > 0), ...frozen])].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of days) {
    const counts = (history?.[day] || 0) > 0 ? 1 : 0;
    run = prev && shiftDateKey(prev, 1) === day ? run + counts : counts;
    best = Math.max(best, run);
    prev = day;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Streak freezes: earned every 7 streak days, spent automatically on missed days
// ---------------------------------------------------------------------------

export const MAX_FREEZES = 2;
export const FREEZE_EVERY_DAYS = 7;

export function earnsFreeze(streakAfterSolve, isFirstSolveToday, freezes) {
  return isFirstSolveToday && streakAfterSolve > 0 && streakAfterSolve % FREEZE_EVERY_DAYS === 0 && freezes < MAX_FREEZES;
}

/**
 * Cover the missed days immediately before today with freezes, if (and only
 * if) every missed day can be covered and there is a streak behind the gap.
 * @returns {{ frozenDays: string[], freezes: number, used: string[] }}
 */
export function applyStreakFreezes({ history = {}, frozenDays = [], freezes = 0, today = toDateKey() }) {
  const frozen = new Set(frozenDays);
  const active = day => (history[day] || 0) > 0 || frozen.has(day);
  const gap = [];
  let cursor = shiftDateKey(today, -1);
  while (!active(cursor) && gap.length <= MAX_FREEZES) {
    gap.push(cursor);
    cursor = shiftDateKey(cursor, -1);
  }
  const unchanged = { frozenDays: [...frozen].sort(), freezes, used: [] };
  if (gap.length === 0 || gap.length > freezes || !active(cursor)) return unchanged;
  gap.forEach(d => frozen.add(d));
  const cutoff = shiftDateKey(today, -HISTORY_RETENTION_DAYS);
  return { frozenDays: [...frozen].filter(d => d >= cutoff).sort(), freezes: freezes - gap.length, used: gap.reverse() };
}

// ---------------------------------------------------------------------------
// Spaced review (lightweight SM-2): intervals grow on success, reset on lapses
// ---------------------------------------------------------------------------

export const FIRST_REVIEW_DAYS = 3;
export const GRADUATE_AFTER_DAYS = 120;

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** rating: 'good' | 'hard' | 'again'. Returns the next schedule entry, or null once the problem graduates. */
export function nextReview(entry, rating, now = Date.now()) {
  const interval = Math.max(1, Number(entry?.interval) || FIRST_REVIEW_DAYS);
  let next;
  if (rating === 'again') next = 1;
  else if (rating === 'hard') next = Math.max(2, Math.round(interval * 1.2));
  else next = Math.max(interval + 1, Math.round(interval * 2.5));
  if (rating !== 'again' && next > GRADUATE_AFTER_DAYS) return null;
  return {
    ...entry,
    interval: next,
    reps: (entry?.reps || 0) + 1,
    lastReviewed: now,
    dueDate: startOfDay(now + next * DAY_MS),
  };
}

export function newReviewEntry(problem, now = Date.now()) {
  return {
    id: problem.id,
    title: problem.title,
    difficulty: problem.difficulty,
    interval: FIRST_REVIEW_DAYS,
    reps: 0,
    dueDate: startOfDay(now + FIRST_REVIEW_DAYS * DAY_MS),
  };
}

export function isReviewDue(entry, now = Date.now()) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return Boolean(entry?.dueDate) && entry.dueDate <= end.getTime();
}

/**
 * Convert LeetCode's submissionCalendar (JSON string of UTC-midnight unix
 * seconds -> count) into a date-keyed map.
 */
export function parseLeetCodeCalendar(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return {}; }
  }
  const out = {};
  for (const [ts, count] of Object.entries(obj || {})) {
    const d = new Date(Number(ts) * 1000);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    out[key] = (out[key] || 0) + Number(count || 0);
  }
  return out;
}

export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 75, 100, 150, 200, 365];

export function isStreakMilestone(streak) {
  return STREAK_MILESTONES.includes(streak);
}

// ---------------------------------------------------------------------------
// XP & levels
// ---------------------------------------------------------------------------

export const XP_BY_DIFFICULTY = { easy: 10, medium: 25, hard: 50 };
export const XP_REPEAT_SOLVE = 3;
export const XP_FIRST_SOLVE_OF_DAY = 10;
export const XP_DUEL_WIN = 50;

export function normalizeDifficulty(diff) {
  const d = String(diff || '').toLowerCase();
  if (d.startsWith('e')) return 'Easy';
  if (d.startsWith('h')) return 'Hard';
  return 'Medium';
}

export function xpForSolve({ difficulty, isNewProblem, isFirstSolveToday }) {
  const base = isNewProblem ? XP_BY_DIFFICULTY[normalizeDifficulty(difficulty).toLowerCase()] : XP_REPEAT_SOLVE;
  return base + (isFirstSolveToday ? XP_FIRST_SOLVE_OF_DAY : 0);
}

/** Total XP required to reach `level` (level 1 starts at 0 XP). */
export function xpForLevel(level) {
  return 50 * level * (level - 1);
}

export function levelFromXp(xp) {
  const safe = Math.max(0, Number(xp) || 0);
  let level = 1;
  while (xpForLevel(level + 1) <= safe) level += 1;
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  return {
    level,
    xp: safe,
    intoLevel: safe - floor,
    levelSpan: ceil - floor,
    toNext: ceil - safe,
    progress: (safe - floor) / (ceil - floor),
  };
}

// ---------------------------------------------------------------------------
// Squad challenges
// ---------------------------------------------------------------------------

/**
 * kind: 'tags'      -> problem topic tags intersect `tags`, or the slug is listed
 *                      under `roadmapCategory` in a bundled roadmap
 *       'difficulty'-> problem difficulty equals `difficulty`
 *       'list'      -> slug belongs to the named roadmap
 *       'any'       -> every accepted solve counts
 */
export const CHALLENGE_CATALOG = [
  { key: 'arrays', title: 'Solve 5 Arrays & Hashing problems', target: 5, rewardXp: 100, category: 'Arrays & Hashing', kind: 'tags', tags: ['array', 'hash-table'], roadmapCategory: 'Arrays & Hashing' },
  { key: 'two-pointers', title: 'Solve 4 Two Pointers problems', target: 4, rewardXp: 120, category: 'Two Pointers', kind: 'tags', tags: ['two-pointers'], roadmapCategory: 'Two Pointers' },
  { key: 'sliding-window', title: 'Solve 3 Sliding Window problems', target: 3, rewardXp: 150, category: 'Sliding Window', kind: 'tags', tags: ['sliding-window'], roadmapCategory: 'Sliding Window' },
  { key: 'stack', title: 'Solve 4 Stack problems', target: 4, rewardXp: 120, category: 'Stack', kind: 'tags', tags: ['stack', 'monotonic-stack'], roadmapCategory: 'Stack' },
  { key: 'binary-search', title: 'Solve 4 Binary Search problems', target: 4, rewardXp: 140, category: 'Binary Search', kind: 'tags', tags: ['binary-search'], roadmapCategory: 'Binary Search' },
  { key: 'linked-list', title: 'Solve 4 Linked List problems', target: 4, rewardXp: 120, category: 'Linked List', kind: 'tags', tags: ['linked-list'], roadmapCategory: 'Linked List' },
  { key: 'trees', title: 'Solve 5 Tree problems', target: 5, rewardXp: 150, category: 'Trees', kind: 'tags', tags: ['tree', 'binary-tree', 'binary-search-tree'], roadmapCategory: 'Trees' },
  { key: 'tries', title: 'Solve 3 Trie problems', target: 3, rewardXp: 160, category: 'Tries', kind: 'tags', tags: ['trie'], roadmapCategory: 'Tries' },
  { key: 'heap', title: 'Solve 3 Heap problems', target: 3, rewardXp: 160, category: 'Heap', kind: 'tags', tags: ['heap-priority-queue'], roadmapCategory: 'Heap' },
  { key: 'backtracking', title: 'Solve 3 Backtracking problems', target: 3, rewardXp: 180, category: 'Backtracking', kind: 'tags', tags: ['backtracking'], roadmapCategory: 'Backtracking' },
  { key: 'graphs', title: 'Solve 4 Graph problems', target: 4, rewardXp: 180, category: 'Graphs', kind: 'tags', tags: ['graph', 'breadth-first-search', 'depth-first-search', 'union-find', 'topological-sort'], roadmapCategory: 'Graphs' },
  { key: 'dp', title: 'Solve 4 Dynamic Programming problems', target: 4, rewardXp: 200, category: 'Dynamic Programming', kind: 'tags', tags: ['dynamic-programming', 'memoization'], roadmapCategory: 'Dynamic Programming' },
  { key: 'greedy', title: 'Solve 4 Greedy problems', target: 4, rewardXp: 150, category: 'Greedy', kind: 'tags', tags: ['greedy'], roadmapCategory: 'Greedy' },
  { key: 'intervals', title: 'Solve 3 Intervals problems', target: 3, rewardXp: 140, category: 'Intervals', kind: 'tags', tags: [], roadmapCategory: 'Intervals' },
  { key: 'math', title: 'Solve 3 Math & Geometry problems', target: 3, rewardXp: 130, category: 'Math & Geometry', kind: 'tags', tags: ['math', 'geometry'], roadmapCategory: 'Math & Geometry' },
  { key: 'bits', title: 'Solve 3 Bit Manipulation problems', target: 3, rewardXp: 140, category: 'Bit Manipulation', kind: 'tags', tags: ['bit-manipulation'], roadmapCategory: 'Bit Manipulation' },
  { key: 'medium', title: 'Solve 6 Medium problems together', target: 6, rewardXp: 200, category: 'Medium', kind: 'difficulty', difficulty: 'Medium' },
  { key: 'hard', title: 'Solve 2 Hard problems together', target: 2, rewardXp: 250, category: 'Hard', kind: 'difficulty', difficulty: 'Hard' },
  { key: 'any', title: 'Log 10 squad solves', target: 10, rewardXp: 250, category: 'Any', kind: 'any' },
  { key: 'blind75', title: 'Solve 5 Blind 75 problems together', target: 5, rewardXp: 175, category: 'Blind 75', kind: 'list', list: 'blind75' },
  { key: 'neetcode150', title: 'Solve 5 NeetCode 150 problems together', target: 5, rewardXp: 175, category: 'NeetCode 150', kind: 'list', list: 'neetcode150' },
];

export function getCatalogEntry(key) {
  return CHALLENGE_CATALOG.find(c => c.key === key) || null;
}

/** Build a fresh challenge instance (ids are unique per instance, so progress never leaks between rounds). */
export function createChallenge(excludeKey = null, now = Date.now(), random = Math.random) {
  const pool = CHALLENGE_CATALOG.filter(c => c.key !== excludeKey);
  const entry = pool[Math.floor(random() * pool.length)] || CHALLENGE_CATALOG[0];
  const challenge = {
    key: entry.key,
    id: `${entry.key}_${now.toString(36)}`,
    title: entry.title,
    target: entry.target,
    rewardXp: entry.rewardXp,
    category: entry.category,
    startedAt: now,
  };
  if (entry.roadmapCategory) challenge.roadmapCategory = entry.roadmapCategory;
  return challenge;
}

/**
 * @param challenge squad challenge instance
 * @param problem { slug, difficulty, topicTags: string[] (slugs) }
 * @param roadmaps { blind75: Problem[], neetcode150: Problem[] }
 */
export function solveMatchesChallenge(challenge, problem, roadmaps = {}) {
  if (!challenge || !problem) return false;
  const entry = getCatalogEntry(challenge.key);
  if (!entry) return false;
  const slug = String(problem.slug || '').toLowerCase();

  switch (entry.kind) {
    case 'any':
      return true;
    case 'difficulty':
      return normalizeDifficulty(problem.difficulty) === entry.difficulty;
    case 'list':
      return (roadmaps[entry.list] || []).some(p => p.slug === slug);
    case 'tags': {
      const tags = (problem.topicTags || []).map(t => String(typeof t === 'string' ? t : t.slug || '').toLowerCase());
      if (entry.tags.some(t => tags.includes(t))) return true;
      const inRoadmap = list => (list || []).some(p => p.slug === slug && p.category === entry.roadmapCategory);
      return inRoadmap(roadmaps.blind75) || inRoadmap(roadmaps.neetcode150);
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Squad codes & names
// ---------------------------------------------------------------------------

export const SQUAD_CODE_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const MAX_SQUAD_MEMBERS = 20;

/** Returns the canonical code (e.g. "K9X2P4") or null when the input is not a valid code. */
export function normalizeSquadCode(input) {
  const code = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : null;
}

export function generateSquadCode(length = 6) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += SQUAD_CODE_CHARSET[b % SQUAD_CODE_CHARSET.length];
  return out;
}

export function sanitizeName(input, fallback = 'Player') {
  const clean = String(input || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  return clean || fallback;
}

export function sameSlug(a, b) {
  const x = String(a || '').toLowerCase().trim();
  const y = String(b || '').toLowerCase().trim();
  return Boolean(x) && x === y;
}

// ---------------------------------------------------------------------------
// Solve timing
// ---------------------------------------------------------------------------

export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function median(values) {
  const v = values.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

// ---------------------------------------------------------------------------
// Topic mastery (from the bundled roadmaps)
// ---------------------------------------------------------------------------

function difficultyRank(d) {
  return { Easy: 0, Medium: 1, Hard: 2 }[normalizeDifficulty(d)];
}

/** Union of both roadmaps by slug; NeetCode's finer categories win. */
export function topicMastery(roadmaps = {}, solvedSlugs = new Set()) {
  // NeetCode first so topics come out in its prerequisite order (Arrays → … → DP).
  const bySlug = new Map();
  for (const p of roadmaps.neetcode150 || []) bySlug.set(p.slug, p);
  for (const p of roadmaps.blind75 || []) if (!bySlug.has(p.slug)) bySlug.set(p.slug, p);
  const topics = new Map();
  for (const p of bySlug.values()) {
    if (!topics.has(p.category)) topics.set(p.category, { category: p.category, solved: 0, total: 0, next: null });
    const t = topics.get(p.category);
    t.total += 1;
    if (solvedSlugs.has(p.slug)) t.solved += 1;
    else if (!t.next || difficultyRank(p.difficulty) < difficultyRank(t.next.difficulty)) t.next = p;
  }
  return [...topics.values()].map(t => ({ ...t, ratio: t.total ? t.solved / t.total : 0 }));
}

export const FOCUS_THRESHOLD = 0.6;

/**
 * The topic to strengthen next: the earliest one in roadmap order that is
 * still under 60% covered, so fundamentals come before advanced topics.
 */
export function weakestTopic(mastery) {
  const open = mastery.filter(t => t.next);
  if (!open.length) return null;
  return open.find(t => t.ratio < FOCUS_THRESHOLD) || [...open].sort((a, b) => a.ratio - b.ratio)[0];
}

// ---------------------------------------------------------------------------
// Weekly summary
// ---------------------------------------------------------------------------

export function weekStart(dateKey) {
  const d = fromDateKey(dateKey);
  return shiftDateKey(dateKey, -((d.getDay() + 6) % 7));
}

export function weekSummary(history = {}, mondayKey) {
  let solves = 0;
  let days = 0;
  for (let i = 0; i < 7; i++) {
    const n = history[shiftDateKey(mondayKey, i)] || 0;
    solves += n;
    if (n) days += 1;
  }
  return { solves, days };
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS = [
  { id: 'first_solve', title: 'First steps', desc: 'Get an accepted solve', icon: 'check', metric: 'totalSolved', goal: 1 },
  { id: 'streak_3', title: 'Warming up', desc: 'Reach a 3-day streak', icon: 'flame', metric: 'longestStreak', goal: 3 },
  { id: 'streak_7', title: 'On a roll', desc: 'Reach a 7-day streak', icon: 'flame', metric: 'longestStreak', goal: 7 },
  { id: 'streak_30', title: 'Habit formed', desc: 'Reach a 30-day streak', icon: 'flame', metric: 'longestStreak', goal: 30 },
  { id: 'streak_100', title: 'Unbreakable', desc: 'Reach a 100-day streak', icon: 'flame', metric: 'longestStreak', goal: 100 },
  { id: 'solved_50', title: 'Fifty', desc: 'Solve 50 problems', icon: 'target', metric: 'totalSolved', goal: 50 },
  { id: 'solved_100', title: 'Centurion', desc: 'Solve 100 problems', icon: 'target', metric: 'totalSolved', goal: 100 },
  { id: 'solved_250', title: 'Deep end', desc: 'Solve 250 problems', icon: 'target', metric: 'totalSolved', goal: 250 },
  { id: 'solved_500', title: 'Machine', desc: 'Solve 500 problems', icon: 'target', metric: 'totalSolved', goal: 500 },
  { id: 'hard_10', title: 'Hard mode', desc: 'Solve 10 Hard problems', icon: 'bolt', metric: 'hardSolved', goal: 10 },
  { id: 'hard_50', title: 'Glutton for punishment', desc: 'Solve 50 Hard problems', icon: 'bolt', metric: 'hardSolved', goal: 50 },
  { id: 'blind75_half', title: 'Halfway blind', desc: 'Solve 38 Blind 75 problems', icon: 'map', metric: 'blind75Solved', goal: 38 },
  { id: 'blind75', title: 'Blind 75', desc: 'Finish the Blind 75', icon: 'map', metric: 'blind75Solved', goal: 75 },
  { id: 'neetcode150', title: 'NeetCode 150', desc: 'Finish the NeetCode 150', icon: 'map', metric: 'neetcode150Solved', goal: 150 },
  { id: 'reviewer', title: 'Spaced out', desc: 'Complete 10 reviews', icon: 'rotate', metric: 'reviewsDone', goal: 10 },
  { id: 'speedrun', title: 'Speedrun', desc: 'Solve a Medium in under 10 minutes', icon: 'clock', metric: 'fastMediumSolves', goal: 1 },
  { id: 'ice', title: 'Saved by the ice', desc: 'Have a streak freeze save your streak', icon: 'snowflake', metric: 'freezesUsed', goal: 1 },
  { id: 'night_owl', title: 'Night owl', desc: 'Get an accepted solve between midnight and 5am', icon: 'moon', metric: 'nightSolves', goal: 1 },
  { id: 'squad', title: 'Better together', desc: 'Join or create a squad', icon: 'users', metric: 'joinedSquad', goal: 1 },
  { id: 'duel_win', title: 'Quick draw', desc: 'Win a 1v1 duel', icon: 'swords', metric: 'duelWins', goal: 1 },
  { id: 'duel_10', title: 'Duelist', desc: 'Win 10 duels', icon: 'trophy', metric: 'duelWins', goal: 10 },
];

/** Build the metric bag achievements are measured against from storage + roadmaps. */
export function achievementStats(data = {}, roadmaps = {}) {
  const solved = new Set(data.user_solved_slugs || []);
  const inList = list => (list || []).filter(p => solved.has(p.slug)).length;
  return {
    totalSolved: Math.max(data.total_solved || 0, solved.size),
    hardSolved: data.solved_hard_count || 0,
    longestStreak: computeLongestStreak(data.solve_history, data.frozen_days),
    blind75Solved: inList(roadmaps.blind75),
    neetcode150Solved: inList(roadmaps.neetcode150),
    reviewsDone: data.reviews_done || 0,
    fastMediumSolves: data.fast_medium_solves || 0,
    freezesUsed: data.freezes_used || 0,
    nightSolves: data.night_solves || 0,
    joinedSquad: data.my_squad_code || data.ever_joined_squad ? 1 : 0,
    duelWins: (data.duel_history || []).filter(d => d.won).length,
  };
}

export function evaluateAchievements(stats, unlocked = {}) {
  return ACHIEVEMENTS.map(a => {
    const value = Math.min(stats[a.metric] || 0, a.goal);
    return { ...a, value, progress: value / a.goal, unlocked: Boolean(unlocked[a.id]) || value >= a.goal, unlockedAt: unlocked[a.id] || null };
  });
}

/** Achievements newly earned compared with what has already been recorded. */
export function newlyUnlocked(stats, unlocked = {}) {
  return ACHIEVEMENTS.filter(a => !unlocked[a.id] && (stats[a.metric] || 0) >= a.goal);
}
