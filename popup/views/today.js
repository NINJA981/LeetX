import {
  MAX_FREEZES,
  computeLongestStreak,
  formatDuration,
  formatTimeAgo,
  fromDateKey,
  isReviewDue,
  nextReview,
  shiftDateKey,
} from '../../scripts/core.js';
import { LeetCodeAPI } from '../../scripts/leetcode.js';
import {
  busy, button, difficultyTag, h, icon, iconButton, mount, openExternal, problemUrl, progressBar, sectionHeader, skeleton, toast,
} from '../ui.js';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MAX_DUE_ROWS = 3;

let dailyCache = null;
let lcSignedIn = null;
let pinnedCache = null;

export async function renderToday(ctx) {
  const d = ctx.derived();
  const data = ctx.store.data;

  return h('div.stack-lg',
    lcSignedIn === false ? signInBanner() : null,
    streakHero(ctx, d),
    await setupChecklist(ctx),
    dailyProblem(ctx, d),
    await upNext(ctx, d),
    githubRow(ctx, data),
  );
}

// ---------------------------------------------------------------------------

function signInBanner() {
  return h('div.banner',
    icon('logIn', { size: 16 }),
    h('div.banner-text', h('strong', 'Sign in to LeetCode'), h('span', 'LeetX reads your solves from your leetcode.com session.')),
    button('Open', { size: 'sm', onclick: () => openExternal('https://leetcode.com/accounts/login/') }),
  );
}

function streakHero(ctx, d) {
  const data = ctx.store.data;
  const risk = !d.solvedToday && d.streak > 0 && d.msLeft < 3 * 3600 * 1000;
  const goalMet = d.todayCount >= d.goal;
  const longest = computeLongestStreak(data.solve_history, data.frozen_days);

  // Celebrate a streak that grew since the popup was last opened.
  const grew = d.streak > (data.streak_seen || 0);
  if (d.streak !== data.streak_seen) ctx.set({ streak_seen: d.streak });

  let tone = 'muted';
  let status;
  if (d.solvedToday && goalMet) {
    tone = 'success';
    status = d.goal > 1 ? `Goal hit: ${d.todayCount} solved today` : 'Done for today. See you tomorrow.';
  } else if (d.solvedToday) {
    tone = 'success';
    status = `Streak safe · ${d.goal - d.todayCount} more to hit your goal`;
  } else if (d.streak > 0) {
    tone = risk ? 'danger' : 'warning';
    status = `${formatDuration(d.msLeft)} left to keep your streak`;
  } else {
    status = 'Solve one problem today to start a streak';
  }

  const best = longest > d.streak ? `Best ${longest} days` : d.streak > 1 ? 'Your best streak yet' : null;
  const freezeTitle = `Streak freezes cover a missed day automatically. You earn one every 7 streak days (max ${MAX_FREEZES}).`;

  return h('section.hero', { 'aria-label': 'Streak' },
    h('div.hero-main',
      h('div.hero-figure',
        h(`span.hero-flame.is-${d.solvedToday ? 'hot' : risk ? 'risk' : d.streak ? 'warm' : 'cold'}`, icon('flame', { size: 26 })),
        h(`span.hero-number${grew ? '.is-new' : ''}`, String(d.streak)),
        h('span.hero-unit', d.streak === 1 ? 'day' : 'days'),
      ),
      h(`p.hero-status.tone-${tone}`, h('span.status-dot'), status),
      h('p.hero-sub',
        best ? h('span', best) : null,
        h(`span.freeze${d.freezes ? '' : '.is-empty'}`, { title: freezeTitle },
          icon('snowflake', { size: 12 }),
          d.freezes ? `${d.freezes} ${d.freezes === 1 ? 'freeze' : 'freezes'}` : 'No freezes',
        ),
      ),
    ),
    goalRing(d),
    weekStrip(data.solve_history, d),
  );
}

function goalRing(d) {
  const pct = Math.min(1, d.todayCount / d.goal);
  const r = 22;
  const c = 2 * Math.PI * r;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 56 56');
  svg.setAttribute('class', 'ring');
  for (const [cls, dash] of [['ring-track', null], ['ring-fill', `${c * pct} ${c}`]]) {
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', 28);
    circle.setAttribute('cy', 28);
    circle.setAttribute('r', r);
    circle.setAttribute('class', cls);
    if (dash) circle.setAttribute('stroke-dasharray', dash);
    svg.appendChild(circle);
  }
  return h(`div.goal${pct >= 1 ? '.is-done' : pct === 0 ? '.is-empty' : ''}`, { title: `Daily goal: ${d.todayCount} of ${d.goal}`, role: 'img', 'aria-label': `Daily goal ${d.todayCount} of ${d.goal}` },
    svg,
    h('div.goal-label',
      pct >= 1 ? icon('check', { size: 18 }) : h('span.goal-count', `${Math.min(d.todayCount, d.goal)}/${d.goal}`),
    ),
    h('span.goal-caption', 'today'),
  );
}

function weekStrip(history = {}, d) {
  const todayDate = fromDateKey(d.today);
  const monday = shiftDateKey(d.today, -((todayDate.getDay() + 6) % 7));
  return h('ol.week', { 'aria-label': 'This week' },
    WEEKDAYS.map((label, i) => {
      const key = shiftDateKey(monday, i);
      const done = (history[key] || 0) > 0;
      const frozen = !done && d.frozenDays.has(key);
      let state = key === d.today ? (done ? 'done today' : 'today') : key > d.today ? 'future' : done ? 'done' : 'missed';
      if (frozen) state = 'frozen';
      const title = `${fromDateKey(key).toDateString()}${done ? ` · ${history[key]} solved` : frozen ? ' · covered by a streak freeze' : ''}`;
      return h(`li.week-day.${state.split(' ').join('.')}`, { title },
        h('span.week-label', label),
        h('span.week-cell', done ? icon('check', { size: 12 }) : frozen ? icon('snowflake', { size: 12 }) : null),
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// Setup checklist: shown to new users until done or dismissed
// ---------------------------------------------------------------------------

async function isPinned() {
  if (pinnedCache !== null) return pinnedCache;
  try {
    pinnedCache = chrome.action.getUserSettings ? Boolean((await chrome.action.getUserSettings()).isOnToolbar) : null;
  } catch {
    pinnedCache = null;
  }
  return pinnedCache;
}

async function setupChecklist(ctx) {
  const data = ctx.store.data;
  if (data.checklist_dismissed) return null;
  const pinned = await isPinned();
  const items = [
    { done: lcSignedIn === true || Boolean(data.leetcode_username), title: 'Sign in to LeetCode', action: () => openExternal('https://leetcode.com/accounts/login/') },
    { done: Boolean(data.last_solve), title: 'Solve a problem with LeetX on', action: () => openExternal('https://leetcode.com/problemset/') },
    { done: Boolean(data.github_token), title: 'Back up solutions to GitHub', action: () => ctx.navigate('settings') },
    { done: Boolean(data.my_squad_code || data.ever_joined_squad), title: 'Join or start a squad', action: () => ctx.navigate('squad') },
  ];
  if (pinned !== null) items.push({ done: pinned, title: 'Pin LeetX to your toolbar', hint: 'Puzzle icon → pin LeetX, so your streak is always visible' });
  const done = items.filter(i => i.done).length;
  if (done === items.length) return null;

  return h('section.checklist',
    h('div.checklist-head',
      h('div',
        h('div.checklist-title', 'Get set up'),
        h('div.muted', `${done} of ${items.length} done`),
      ),
      iconButton('x', 'Dismiss setup checklist', { onclick: async () => { await ctx.set({ checklist_dismissed: true }); ctx.rerender(); } }),
    ),
    progressBar(done / items.length, { tone: 'success', label: 'Setup progress' }),
    h('ul.checklist-items', items.map(item => h(`li.check-item${item.done ? '.is-done' : ''}`,
      h('span.check-mark', icon(item.done ? 'circleCheck' : 'circle', { size: 16 })),
      h('div.check-text', h('span', item.title), item.hint && !item.done ? h('span.check-hint', item.hint) : null),
      !item.done && item.action ? iconButton('chevronRight', item.title, { onclick: item.action }) : null,
    ))),
  );
}

// ---------------------------------------------------------------------------

function dailyProblem(ctx, d) {
  const container = h('section.daily', { 'aria-label': "Today's problem" }, skeleton(2));

  const paint = daily => {
    if (!daily) {
      mount(container,
        h('div.daily-body',
          h('div.eyebrow', 'Daily challenge'),
          h('div.daily-title.muted', "Couldn't reach LeetCode"),
        ),
        button('Open', { size: 'sm', onclick: () => openExternal('https://leetcode.com/problemset/') }),
      );
      return;
    }
    const solved = d.solvedSlugs.has(daily.slug);
    mount(container,
      h('div.daily-body',
        h('div.eyebrow', h('span', 'Daily challenge'), h('span.eyebrow-sep', '·'), h('span', fromDateKey(d.today).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))),
        h('a.daily-title', { href: daily.url, onclick: e => { e.preventDefault(); openExternal(daily.url); } }, `${daily.id}. ${daily.title}`),
        h('div.daily-meta', difficultyTag(daily.difficulty), daily.topics.slice(0, 2).map(t => h('span.topic', t))),
      ),
      solved
        ? h('span.solved-pill', icon('check', { size: 14 }), 'Solved')
        : button('Solve', { variant: 'primary', size: 'sm', iconRight: 'arrowRight', onclick: () => openExternal(daily.url) }),
    );
  };

  if (dailyCache?.date === d.today) {
    paint(dailyCache.data);
  } else {
    (async () => {
      const [daily, user] = await Promise.all([
        LeetCodeAPI.getDailyChallenge(),
        lcSignedIn === null ? LeetCodeAPI.getCurrentUser() : Promise.resolve(undefined),
      ]);
      dailyCache = { date: d.today, data: daily };
      if (container.isConnected) paint(daily);
      if (user !== undefined) {
        const was = lcSignedIn;
        lcSignedIn = Boolean(user);
        // Refresh once so the sign-in banner and setup checklist reflect reality.
        if (was === null) ctx.rerender();
      }
    })();
  }
  return container;
}

// ---------------------------------------------------------------------------
// Up next: contests, due reviews, then the next roadmap problem
// ---------------------------------------------------------------------------

async function rateReview(ctx, slug, rating) {
  const schedule = { ...(ctx.store.data.review_schedule || {}) };
  const next = nextReview(schedule[slug], rating);
  if (next) schedule[slug] = next;
  else delete schedule[slug];
  await ctx.set({ review_schedule: schedule, reviews_done: (ctx.store.data.reviews_done || 0) + (rating === 'again' ? 0 : 1) });
  if (rating === 'again') toast("It'll come back tomorrow");
  else toast(next ? `Nice. Next review in ${next.interval} days` : 'Mastered. Dropped from reviews', { tone: 'success' });
  ctx.rerender();
}

function contestRow(data) {
  const now = Date.now();
  const contest = (data.contests_cache?.list || []).find(c => c.startTime > now && c.startTime - now < 24 * 3600 * 1000);
  if (!contest) return null;
  const url = `https://leetcode.com/contest/${encodeURIComponent(contest.slug)}/`;
  return h('li.list-row',
    h('button.list-main', { type: 'button', onclick: () => openExternal(url) },
      h('span.list-icon.tone-warning', icon('trophy', { size: 14 })),
      h('span.list-text',
        h('span.list-title', contest.title),
        h('span.list-sub', `Starts in ${formatDuration(contest.startTime - now)} · ${new Date(contest.startTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`),
      ),
      h('span.row-cta', 'Register'),
    ),
  );
}

async function upNext(ctx, d) {
  const data = ctx.store.data;
  const rows = [];

  const contest = contestRow(data);
  if (contest) rows.push(contest);

  const due = Object.entries(data.review_schedule || {})
    .filter(([, item]) => isReviewDue(item))
    .sort((a, b) => a[1].dueDate - b[1].dueDate);
  for (const [slug, item] of due.slice(0, MAX_DUE_ROWS)) {
    const overdue = item.dueDate < Date.now() - 86400000;
    rows.push(h('li.list-row',
      h('button.list-main', { type: 'button', onclick: () => openExternal(problemUrl(slug)), title: 'Solving it again counts as the review' },
        h('span.list-icon.tone-accent', icon('rotate', { size: 14 })),
        h('span.list-text',
          h('span.list-title', item.title),
          h('span.list-sub', `${overdue ? 'Review overdue' : 'Review due'}${item.reps ? ` · round ${item.reps + 1}` : ''}`),
        ),
      ),
      h('div.review-actions',
        button('Again', { size: 'sm', variant: 'ghost', title: 'Struggled: see it again tomorrow', onclick: busy(() => rateReview(ctx, slug, 'again')) }),
        button('Got it', { size: 'sm', title: 'Remembered it: push the next review out', onclick: busy(() => rateReview(ctx, slug, 'good')) }),
      ),
    ));
  }
  const moreDue = due.length - MAX_DUE_ROWS;

  const roadmaps = await ctx.getRoadmaps().catch(() => null);
  const type = data.roadmap_type === 'neetcode150' ? 'neetcode150' : 'blind75';
  const list = roadmaps?.[type] || [];
  const next = list.find(p => !d.solvedSlugs.has(p.slug));
  if (next) {
    const solvedCount = list.filter(p => d.solvedSlugs.has(p.slug)).length;
    rows.push(h('li.list-row',
      h('button.list-main', { type: 'button', onclick: () => openExternal(problemUrl(next.slug)) },
        h('span.list-icon', icon('map', { size: 14 })),
        h('span.list-text',
          h('span.list-title', next.title),
          h('span.list-sub', `${type === 'blind75' ? 'Blind 75' : 'NeetCode 150'} · ${solvedCount}/${list.length} · ${next.category}`),
        ),
        difficultyTag(next.difficulty),
      ),
    ));
  }

  if (!rows.length) return null;
  return h('section',
    sectionHeader('Up next', moreDue > 0 ? h('span.section-meta', `+${moreDue} more reviews`) : null),
    h('ul.list', rows),
  );
}

// ---------------------------------------------------------------------------

function githubRow(ctx, data) {
  if (!data.github_token) {
    return h('section.gh-row',
      h('span.gh-icon', icon('github', { size: 16 })),
      h('div.gh-text', h('span.gh-title', 'Back up every solve to GitHub'), h('span.gh-sub', 'Code, notes and runtime, one commit per problem')),
      button('Connect', { size: 'sm', onclick: () => ctx.navigate('settings') }),
    );
  }

  const status = data.sync_status || {};
  const repo = `${data.github_repo_owner || ''}/${data.github_repo_name || 'leetcode-submissions'}`;
  const syncing = status.state === 'syncing' && Date.now() - (status.updatedAt || 0) < 120000;
  const err = status.state === 'error' ? status.message : data.github_last_error?.message;
  let sub;
  if (syncing) sub = status.message || 'Syncing…';
  else if (err) sub = err;
  else if (data.github_last_commit) sub = `Last commit ${formatTimeAgo(data.github_last_commit.at)} ago · ${data.github_last_commit.title}`;
  else if (status.lastSync) sub = `Synced ${formatTimeAgo(status.lastSync)} ago`;
  else sub = 'Every accepted solve is committed automatically';

  return h('section.gh-row', { class: err && !syncing ? 'has-error' : '' },
    h('span.gh-icon', icon('github', { size: 16 })),
    h('div.gh-text',
      h('a.gh-title', { href: `https://github.com/${repo}`, onclick: e => { e.preventDefault(); openExternal(`https://github.com/${repo}`); } }, repo),
      h(`span.gh-sub${err && !syncing ? '.tone-danger' : ''}`, sub),
      syncing ? progressBar((status.progress || 5) / 100, { label: 'Sync progress' }) : null,
    ),
    iconButton('refresh', syncing ? 'Syncing' : 'Sync all solutions', {
      class: syncing ? 'is-spinning' : '',
      disabled: syncing,
      onclick: busy(async () => {
        const res = await ctx.sendMessage({ type: 'START_FULL_SYNC' });
        if (res?.success === false) throw new Error(res.error);
        toast('Sync started. You can close this popup.');
      }),
    }),
  );
}
