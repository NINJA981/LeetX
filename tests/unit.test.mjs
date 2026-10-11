/**
 * Unit tests for pure domain logic and the GitHub / LeetCode clients.
 *   node --test tests/unit.test.mjs
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  computeLongestStreak,
  computeStreak,
  createChallenge,
  levelFromXp,
  normalizeSquadCode,
  parseLeetCodeCalendar,
  recordSolveInHistory,
  sameSlug,
  sanitizeName,
  shiftDateKey,
  solveMatchesChallenge,
  xpForLevel,
  xpForSolve,
} from '../scripts/core.js';

const TODAY = '2026-10-11';

describe('streaks', () => {
  it('counts consecutive days ending today', () => {
    const h = { [TODAY]: 1, '2026-10-10': 2, '2026-10-09': 1, '2026-10-07': 1 };
    assert.deepEqual(computeStreak(h, TODAY), { streak: 3, solvedToday: true, todayCount: 1 });
  });

  it('keeps yesterday-ending streaks alive until midnight', () => {
    const h = { '2026-10-10': 1, '2026-10-09': 1 };
    assert.equal(computeStreak(h, TODAY).streak, 2);
    assert.equal(computeStreak(h, TODAY).solvedToday, false);
  });

  it('resets after a missed day even if no alarm ran (v1 bug)', () => {
    const h = { '2026-10-08': 1, '2026-10-07': 1, '2026-10-06': 1 };
    assert.equal(computeStreak(h, TODAY).streak, 0);
    const after = recordSolveInHistory(h, TODAY);
    assert.equal(computeStreak(after, TODAY).streak, 1);
  });

  it('handles month and DST boundaries', () => {
    assert.equal(shiftDateKey('2026-03-01', -1), '2026-02-28');
    assert.equal(shiftDateKey('2026-11-01', 1), '2026-11-02');
    const h = { '2026-03-01': 1, '2026-02-28': 1, '2026-02-27': 1 };
    assert.equal(computeStreak(h, '2026-03-01').streak, 3);
  });

  it('finds the longest run', () => {
    assert.equal(computeLongestStreak({ '2026-01-01': 1, '2026-01-02': 1, '2026-01-05': 1, '2026-01-06': 1, '2026-01-07': 1 }), 3);
  });

  it('parses the LeetCode submission calendar', () => {
    const ts = Date.UTC(2026, 9, 10) / 1000;
    assert.deepEqual(parseLeetCodeCalendar(JSON.stringify({ [ts]: 4 })), { '2026-10-10': 4 });
    assert.deepEqual(parseLeetCodeCalendar('not json'), {});
  });
});

describe('xp & levels', () => {
  it('rewards new problems by difficulty and repeats minimally', () => {
    assert.equal(xpForSolve({ difficulty: 'Hard', isNewProblem: true, isFirstSolveToday: false }), 50);
    assert.equal(xpForSolve({ difficulty: 'easy', isNewProblem: true, isFirstSolveToday: true }), 20);
    assert.equal(xpForSolve({ difficulty: 'Medium', isNewProblem: false, isFirstSolveToday: false }), 3);
  });

  it('computes levels on a quadratic curve', () => {
    assert.equal(xpForLevel(1), 0);
    assert.equal(xpForLevel(2), 100);
    assert.equal(levelFromXp(0).level, 1);
    assert.equal(levelFromXp(99).level, 1);
    assert.equal(levelFromXp(100).level, 2);
    const l = levelFromXp(1340);
    assert.equal(l.level, 5);
    assert.equal(l.toNext, 160);
  });
});

describe('challenges', () => {
  const roadmaps = {
    blind75: [{ slug: 'merge-intervals', category: 'Intervals' }, { slug: 'two-sum', category: 'Arrays & Hashing' }],
    neetcode150: [],
  };

  it('creates unique instance ids', () => {
    const a = createChallenge(null, 1000, () => 0.1);
    const b = createChallenge(null, 2000, () => 0.1);
    assert.equal(a.key, b.key);
    assert.notEqual(a.id, b.id);
  });

  it('matches by topic tag, roadmap category, difficulty and list', () => {
    const trees = createChallenge(null, 1, () => 6.5 / 21);
    assert.equal(trees.key, 'trees');
    assert.ok(solveMatchesChallenge(trees, { slug: 'x', topicTags: ['binary-tree'] }, roadmaps));
    assert.ok(!solveMatchesChallenge(trees, { slug: 'x', topicTags: ['array'] }, roadmaps));

    const intervals = { key: 'intervals', id: 'i' };
    assert.ok(solveMatchesChallenge(intervals, { slug: 'merge-intervals', topicTags: [] }, roadmaps));
    assert.ok(solveMatchesChallenge({ key: 'hard', id: 'h' }, { slug: 'x', difficulty: 'Hard' }, roadmaps));
    assert.ok(solveMatchesChallenge({ key: 'blind75', id: 'b' }, { slug: 'two-sum' }, roadmaps));
    assert.ok(!solveMatchesChallenge({ key: 'blind75', id: 'b' }, { slug: 'three-sum' }, roadmaps));
  });

  it('never treats a substring slug as the duel problem (v1 bug)', () => {
    assert.ok(!sameSlug('two-sum', 'two-sum-ii-input-array-is-sorted'));
    assert.ok(sameSlug('Two-Sum ', 'two-sum'));
    assert.ok(!sameSlug('', ''));
  });
});

describe('codes & names', () => {
  it('normalizes squad codes and rejects junk instead of falling back to ALGO99 (v1 bug)', () => {
    assert.equal(normalizeSquadCode('#k9x2p4'), 'K9X2P4');
    assert.equal(normalizeSquadCode(' k9-x2 p4 '), 'K9X2P4');
    assert.equal(normalizeSquadCode(''), null);
    assert.equal(normalizeSquadCode(null), null);
    assert.equal(normalizeSquadCode('ab'), null);
  });

  it('sanitizes display names', () => {
    assert.equal(sanitizeName('  bob\u0000\n '), 'bob');
    assert.equal(sanitizeName(''), 'Player');
    assert.equal(sanitizeName('x'.repeat(80)).length, 40);
  });
});

// ---------------------------------------------------------------------------
// GitHub client (fetch mocked)
// ---------------------------------------------------------------------------

describe('GitHubAPI', async () => {
  const { GitHubAPI } = await import('../scripts/github.js');
  let calls;
  let routes;

  beforeEach(() => {
    calls = [];
    routes = [];
    globalThis.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      calls.push({ method, url, body: opts.body ? JSON.parse(opts.body) : null });
      const route = routes.find(r => r.method === method && url.includes(r.match));
      if (!route) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      const out = typeof route.reply === 'function' ? route.reply(url, opts) : route.reply;
      return new Response(JSON.stringify(out.body ?? {}), { status: out.status || 200 });
    };
  });

  const commitRoutes = (refPatchReplies) => {
    let patchCount = 0;
    routes.push(
      { method: 'GET', match: '/git/ref/heads/main', reply: { body: { object: { sha: 'head1' } } } },
      { method: 'GET', match: '/git/commits/head1', reply: { body: { tree: { sha: 'tree0' }, author: { name: 'n', email: 'e' } } } },
      { method: 'POST', match: '/git/trees', reply: { body: { sha: 'tree1' } } },
      { method: 'POST', match: '/git/commits', reply: { body: { sha: 'commit1' } } },
      { method: 'PATCH', match: '/git/refs/heads/main', reply: () => refPatchReplies[patchCount++] || { body: {} } },
    );
  };

  const problem = { frontendId: 1, title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy', content: '<p>x</p>', code: 'print(1)', lang: 'python3', branch: 'main', timestamp: 1700000000 };

  it('never force-pushes and retries a non-fast-forward', async () => {
    commitRoutes([{ status: 422, body: { message: 'Update is not a fast forward' } }, { body: {} }]);
    const res = await new GitHubAPI('t').commitProblemSolution('me', 'repo', problem);
    assert.equal(res.commitSha, 'commit1');
    const patches = calls.filter(c => c.method === 'PATCH');
    assert.equal(patches.length, 2);
    assert.ok(patches.every(p => p.body.force === false));
  });

  it('refuses to commit without real code (no placeholder files)', async () => {
    await assert.rejects(() => new GitHubAPI('t').commitProblemSolution('me', 'repo', { ...problem, code: '' }));
    assert.equal(calls.length, 0);
  });

  it('writes the solution under Difficulty/0001-slug with notes', async () => {
    commitRoutes([]);
    await new GitHubAPI('t').commitProblemSolution('me', 'repo', { ...problem, notes: 'hash map' });
    const tree = calls.find(c => c.url.endsWith('/git/trees') && c.method === 'POST').body.tree.map(t => t.path);
    assert.deepEqual(tree, ['Easy/0001-two-sum/README.md', 'Easy/0001-two-sum/two-sum.py', 'Easy/0001-two-sum/Notes.md']);
  });

  it('skips the commit when content is unchanged', async () => {
    routes.push(
      { method: 'GET', match: '/git/ref/heads/main', reply: { body: { object: { sha: 'head1' } } } },
      { method: 'GET', match: '/git/commits/head1', reply: { body: { tree: { sha: 'same' } } } },
      { method: 'POST', match: '/git/trees', reply: { body: { sha: 'same' } } },
    );
    const res = await new GitHubAPI('t').commitProblemSolution('me', 'repo', problem);
    assert.equal(res.unchanged, true);
    assert.ok(!calls.some(c => c.method === 'PATCH'));
  });

  it('treats v1 placeholder stubs as missing so real code gets synced', async () => {
    const stub = Buffer.from('// Solution for Two Sum\n// Runtime: N/A, Memory: N/A\n').toString('base64');
    const short = Buffer.from('print(sum(x))').toString('base64');
    routes.push(
      { method: 'GET', match: '/git/ref/heads/main', reply: { body: { object: { sha: 'h' } } } },
      { method: 'GET', match: '/git/trees/h', reply: { body: { tree: [
        { type: 'blob', path: 'Easy/0001-two-sum/two-sum.py', size: 60, sha: 'stub' },
        { type: 'blob', path: 'Easy/0007-reverse-integer/reverse-integer.py', size: 13, sha: 'short' },
        { type: 'blob', path: 'Medium/0015-3sum/3sum.java', size: 900, sha: 'big' },
      ] } } },
      { method: 'GET', match: '/git/blobs/stub', reply: { body: { content: stub } } },
      { method: 'GET', match: '/git/blobs/short', reply: { body: { content: short } } },
    );
    const slugs = await new GitHubAPI('t').getExistingProblemSlugs('me', 'repo', 'main');
    assert.deepEqual([...slugs].sort(), ['3sum', 'reverse-integer']);
  });

  it('creates repositories private by default', async () => {
    routes.push(
      { method: 'GET', match: '/user', reply: { body: { login: 'me' } } },
      { method: 'POST', match: '/user/repos', reply: { status: 201, body: { name: 'repo' } } },
    );
    const res = await new GitHubAPI('t').ensureRepository('repo');
    assert.equal(res.created, true);
    assert.equal(calls.find(c => c.method === 'POST').body.private, true);
  });
});

// ---------------------------------------------------------------------------
// LeetCode pagination
// ---------------------------------------------------------------------------

describe('LeetCodeAPI.fetchAllAcceptedSubmissions', async () => {
  const { LeetCodeAPI } = await import('../scripts/leetcode.js');

  it('walks past 500 submissions using lastKey (v1 stopped at ~520)', async () => {
    let page = 0;
    const seenKeys = [];
    globalThis.fetch = async (_url, opts) => {
      const { variables } = JSON.parse(opts.body);
      seenKeys.push(variables.lastKey);
      const subs = Array.from({ length: 20 }, (_, i) => ({ statusDisplay: i % 2 ? 'Wrong Answer' : 'Accepted', titleSlug: `p-${page}-${i}`, id: String(page * 100 + i) }));
      page += 1;
      return new Response(JSON.stringify({ data: { submissionList: { hasNext: page < 40, lastKey: `k${page}`, submissions: subs } } }));
    };
    const original = setTimeout;
    globalThis.setTimeout = (fn) => original(fn, 0);
    try {
      const accepted = await LeetCodeAPI.fetchAllAcceptedSubmissions();
      assert.equal(page, 40);
      assert.equal(accepted.length, 400);
      assert.equal(seenKeys[1], 'k1');
    } finally {
      globalThis.setTimeout = original;
    }
  });
});

// ---------------------------------------------------------------------------
// v2.1: freezes, spaced review, achievements, mastery
// ---------------------------------------------------------------------------

describe('streak freezes', async () => {
  const { applyStreakFreezes, earnsFreeze, MAX_FREEZES } = await import('../scripts/core.js');
  const streakDays = (end, n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [shiftDateKey(end, -i), 1]));

  it('covers a single missed day and keeps the streak alive', () => {
    const history = streakDays('2026-10-09', 10); // solved through the 9th, missed the 10th
    const res = applyStreakFreezes({ history, frozenDays: [], freezes: 1, today: TODAY });
    assert.deepEqual(res.used, ['2026-10-10']);
    assert.equal(res.freezes, 0);
    assert.equal(computeStreak(history, TODAY, res.frozenDays).streak, 10);
    assert.equal(computeStreak(history, TODAY, []).streak, 0);
  });

  it('covers a two-day gap only with two freezes', () => {
    const history = streakDays('2026-10-08', 5);
    assert.deepEqual(applyStreakFreezes({ history, freezes: 1, today: TODAY }).used, []);
    assert.deepEqual(applyStreakFreezes({ history, freezes: 2, today: TODAY }).used, ['2026-10-09', '2026-10-10']);
  });

  it('never spends a freeze when there is no streak to save, or it is already covered', () => {
    assert.deepEqual(applyStreakFreezes({ history: {}, freezes: 2, today: TODAY }).used, []);
    const history = streakDays('2026-10-09', 3);
    const first = applyStreakFreezes({ history, freezes: 2, today: TODAY });
    const again = applyStreakFreezes({ history, frozenDays: first.frozenDays, freezes: first.freezes, today: TODAY });
    assert.deepEqual(again.used, [], 'idempotent');
    assert.equal(again.freezes, 1);
  });

  it('frozen days bridge but do not add to the count', () => {
    const history = { [TODAY]: 1, '2026-10-09': 1, '2026-10-08': 1 };
    assert.equal(computeStreak(history, TODAY, ['2026-10-10']).streak, 3);
    assert.equal(computeLongestStreak(history, ['2026-10-10']), 3);
  });

  it('earns one freeze every 7 days, capped', () => {
    assert.ok(earnsFreeze(7, true, 0));
    assert.ok(earnsFreeze(14, true, 1));
    assert.ok(!earnsFreeze(14, true, MAX_FREEZES));
    assert.ok(!earnsFreeze(7, false, 0), 'only on the first solve of the day');
    assert.ok(!earnsFreeze(6, true, 0));
  });
});

describe('spaced review', async () => {
  const { nextReview, newReviewEntry, isReviewDue, startOfDay, DAY_MS } = await import('../scripts/core.js');
  const now = new Date(2026, 9, 11, 15).getTime();

  it('schedules new problems three days out at midnight', () => {
    const e = newReviewEntry({ id: '1', title: 'Two Sum', difficulty: 'Medium' }, now);
    assert.equal(e.interval, 3);
    assert.equal(e.dueDate, startOfDay(now + 3 * DAY_MS));
    assert.ok(!isReviewDue(e, now));
    assert.ok(isReviewDue(e, now + 3 * DAY_MS));
  });

  it('grows intervals on success, resets on lapse, and graduates', () => {
    let e = newReviewEntry({ id: '1', title: 'x' }, now);
    e = nextReview(e, 'good', now);
    assert.equal(e.interval, 8);
    e = nextReview(e, 'good', now);
    assert.equal(e.interval, 20);
    assert.equal(nextReview(e, 'again', now).interval, 1);
    assert.equal(nextReview(e, 'hard', now).interval, 24);
    e = nextReview(e, 'good', now);
    assert.equal(e.interval, 50);
    assert.equal(nextReview(e, 'good', now), null, 'graduates past 120 days');
  });
});

describe('achievements & mastery', async () => {
  const {
    ACHIEVEMENTS, achievementStats, evaluateAchievements, newlyUnlocked, topicMastery, weakestTopic, weekSummary, formatClock, median,
  } = await import('../scripts/core.js');

  it('has unique ids and sane goals', () => {
    const ids = ACHIEVEMENTS.map(a => a.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ACHIEVEMENTS.every(a => a.goal > 0 && a.title && a.desc));
  });

  it('measures progress from stored state and only reports new unlocks once', () => {
    const data = {
      total_solved: 120, solved_hard_count: 3, user_solved_slugs: ['two-sum'],
      solve_history: { [TODAY]: 1, '2026-10-10': 1, '2026-10-09': 1 },
      duel_history: [{ won: true }, { won: false }], reviews_done: 2,
    };
    const stats = achievementStats(data, { blind75: [{ slug: 'two-sum' }], neetcode150: [] });
    assert.equal(stats.longestStreak, 3);
    assert.equal(stats.blind75Solved, 1);
    const fresh = newlyUnlocked(stats, {}).map(a => a.id);
    assert.ok(fresh.includes('solved_100') && fresh.includes('streak_3') && fresh.includes('duel_win'));
    assert.ok(!fresh.includes('solved_250'));
    const unlocked = Object.fromEntries(fresh.map(id => [id, 1]));
    assert.deepEqual(newlyUnlocked(stats, unlocked), []);
    const hard = evaluateAchievements(stats, unlocked).find(a => a.id === 'hard_10');
    assert.equal(hard.progress, 0.3);
  });

  it('ranks topics and finds the weakest with an easiest-first next problem', () => {
    const roadmaps = {
      blind75: [{ slug: 'a', category: 'Trees', difficulty: 'Easy' }],
      neetcode150: [
        { slug: 'a', category: 'Trees', difficulty: 'Easy' },
        { slug: 'b', category: 'Trees', difficulty: 'Medium' },
        { slug: 'c', category: 'Graphs', difficulty: 'Hard' },
        { slug: 'd', category: 'Graphs', difficulty: 'Medium' },
      ],
    };
    const mastery = topicMastery(roadmaps, new Set(['a']));
    assert.deepEqual(mastery.map(t => [t.category, t.solved, t.total]), [['Trees', 1, 2], ['Graphs', 0, 2]]);
    // Earliest topic in roadmap order that is under 60% covered: fundamentals first.
    const weak = weakestTopic(mastery);
    assert.equal(weak.category, 'Trees');
    assert.equal(weak.next.slug, 'b');
    const later = weakestTopic(topicMastery(roadmaps, new Set(['a', 'b'])));
    assert.equal(later.category, 'Graphs');
    assert.equal(later.next.slug, 'd', 'easiest unsolved first');
  });

  it('summarises weeks and formats times', () => {
    assert.deepEqual(weekSummary({ '2026-10-05': 2, '2026-10-07': 1, '2026-10-12': 9 }, '2026-10-05'), { solves: 3, days: 2 });
    assert.equal(formatClock(845), '14:05');
    assert.equal(formatClock(3725), '1:02:05');
    assert.equal(median([300, 100, 200]), 200);
    assert.equal(median([]), null);
  });
});
