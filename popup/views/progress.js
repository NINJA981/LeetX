import {
  achievementStats,
  computeLongestStreak,
  evaluateAchievements,
  formatClock,
  fromDateKey,
  median,
  shiftDateKey,
  topicMastery,
  weakestTopic,
  weekStart,
  weekSummary,
} from '../../scripts/core.js';
import { button, difficultyTag, h, icon, openExternal, problemUrl, progressBar, sectionHeader } from '../ui.js';

const HEATMAP_WEEKS = 26;
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const TOPICS_COLLAPSED = 6;
const LOCKED_PREVIEW = 3;

// Expanded/collapsed state survives re-renders while the popup is open.
const expanded = { topics: false, badges: false };

export async function renderProgress(ctx) {
  const d = ctx.derived();
  const data = ctx.store.data;
  const roadmaps = await ctx.getRoadmaps().catch(() => ({ blind75: [], neetcode150: [] }));

  return h('div.stack-lg',
    overview(data, d),
    thisWeek(data, d),
    activity(data, d),
    topics(ctx, roadmaps, d),
    speed(data),
    achievements(ctx, data, roadmaps),
  );
}

// ---------------------------------------------------------------------------

function overview(data, d) {
  const easy = data.solved_easy_count || 0;
  const med = data.solved_med_count || 0;
  const hard = data.solved_hard_count || 0;
  const total = Math.max(data.total_solved || 0, easy + med + hard);
  const { level } = d;

  return h('section.progress-grid',
    h('div.metric',
      h('div.metric-value', String(total)),
      h('div.metric-label', 'problems solved'),
      h('div.split-bar', { role: 'img', 'aria-label': `${easy} easy, ${med} medium, ${hard} hard` },
        easy + med + hard === 0 ? h('span.split.empty', { style: { flexGrow: 1 } }) : [
          h('span.split.easy', { style: { flexGrow: easy } }),
          h('span.split.medium', { style: { flexGrow: med } }),
          h('span.split.hard', { style: { flexGrow: hard } }),
        ],
      ),
      h('div.split-legend',
        h('span', h('i.dot.easy'), `${easy} easy`),
        h('span', h('i.dot.medium'), `${med} med`),
        h('span', h('i.dot.hard'), `${hard} hard`),
      ),
    ),
    h('div.metric',
      h('div.metric-value', h('span.metric-prefix', 'Lv'), String(level.level)),
      h('div.metric-label', `${level.xp.toLocaleString()} XP`),
      progressBar(level.progress, { label: 'Level progress' }),
      h('div.split-legend', h('span', `${level.toNext.toLocaleString()} XP to level ${level.level + 1}`)),
    ),
  );
}

function thisWeek(data, d) {
  const history = data.solve_history || {};
  const monday = weekStart(d.today);
  const week = weekSummary(history, monday);
  const prev = weekSummary(history, shiftDateKey(monday, -7));
  const delta = week.solves - prev.solves;
  const days = Array.from({ length: 7 }, (_, i) => {
    const key = shiftDateKey(monday, i);
    return { key, n: history[key] || 0, future: key > d.today };
  });
  const max = Math.max(1, ...days.map(x => x.n));

  let deltaText = 'Same as last week';
  if (delta > 0) deltaText = `${delta} more than last week`;
  if (delta < 0) deltaText = `${-delta} fewer than last week`;

  return h('section',
    sectionHeader('This week'),
    h('div.week-compare',
      h('div.week-figures',
        h('div.metric-value', String(week.solves)),
        h('div.metric-label', `${week.solves === 1 ? 'solve' : 'solves'} on ${week.days} ${week.days === 1 ? 'day' : 'days'}`),
        h(`div.delta.${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}`, deltaText),
      ),
      h('div.week-bars', { role: 'img', 'aria-label': days.map((x, i) => `${DAY_LABELS[i]} ${x.n}`).join(', ') },
        days.map((x, i) => h(`div.week-bar${x.key === d.today ? '.is-today' : ''}${x.future ? '.is-future' : ''}`,
          h('span.week-bar-fill', { style: { height: `${x.n ? Math.max(12, (x.n / max) * 100) : 0}%` }, title: `${x.n} solved` }),
          h('span.week-bar-label', DAY_LABELS[i]),
        )),
      ),
    ),
  );
}

function activity(data, d) {
  const merged = {};
  for (const src of [data.lc_calendar || {}, data.solve_history || {}]) {
    for (const [k, v] of Object.entries(src)) merged[k] = Math.max(merged[k] || 0, v);
  }
  const lastMonday = weekStart(d.today);
  const start = shiftDateKey(lastMonday, -(HEATMAP_WEEKS - 1) * 7);

  const months = h('div.heat-months', { 'aria-hidden': 'true' });
  const grid = h('div.heatmap', { role: 'img' });
  let activeDays = 0;
  let lastMonth = null;
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    const weekKey = shiftDateKey(start, w * 7);
    const month = fromDateKey(weekKey).getMonth();
    months.appendChild(h('span.heat-month', month !== lastMonth && w < HEATMAP_WEEKS - 1 ? fromDateKey(weekKey).toLocaleDateString(undefined, { month: 'short' }) : ''));
    lastMonth = month;

    const col = h('div.heat-col');
    for (let day = 0; day < 7; day++) {
      const key = shiftDateKey(start, w * 7 + day);
      const n = merged[key] || 0;
      if (key > d.today) { col.appendChild(h('span.heat.future')); continue; }
      if (n) activeDays += 1;
      const level = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4;
      const frozen = !n && d.frozenDays.has(key);
      col.appendChild(h(`span.heat.l${level}${frozen ? '.frozen' : ''}${key === d.today ? '.is-today' : ''}`, {
        title: `${fromDateKey(key).toDateString()} · ${frozen ? 'streak freeze' : `${n} ${n === 1 ? 'submission' : 'submissions'}`}`,
      }));
    }
    grid.appendChild(col);
  }
  grid.setAttribute('aria-label', `${activeDays} active days in the last ${HEATMAP_WEEKS} weeks`);

  return h('section',
    sectionHeader('Activity', h('span.section-meta', `${activeDays} active days`)),
    h('div.activity-block',
      months,
      grid,
      h('div.heat-foot',
        h('span.muted', `Longest run ${computeLongestStreak(merged, data.frozen_days)}d`),
        h('span.heat-legend', 'Less', [0, 1, 2, 3, 4].map(l => h(`span.heat.l${l}`)), 'More'),
      ),
    ),
  );
}

function topics(ctx, roadmaps, d) {
  const mastery = topicMastery(roadmaps, d.solvedSlugs);
  const weakest = weakestTopic(mastery);
  if (!mastery.length) return null;

  return h('section',
    sectionHeader('Topics', h('span.section-meta', 'Blind 75 + NeetCode 150')),
    weakest ? h('div.focus-card',
      h('div.focus-text',
        h('div.eyebrow', icon('target', { size: 12 }), 'Focus next'),
        h('div.focus-title', weakest.category),
        h('div.muted', `${weakest.solved} of ${weakest.total} solved · next: ${weakest.next.title}`),
      ),
      button('Practice', { size: 'sm', variant: 'primary', onclick: () => openExternal(problemUrl(weakest.next.slug)) }),
    ) : null,
    h('ul.topic-list', visibleTopics(mastery, weakest).map(t => h(`li.topic-row${t === weakest ? '.is-weakest' : ''}`,
      h('button.topic-main', {
        type: 'button',
        title: `Show ${t.category} in the roadmap`,
        onclick: async () => {
          const inBlind = (roadmaps.blind75 || []).some(p => p.category === t.category);
          await ctx.set({ roadmap_type: inBlind ? 'blind75' : 'neetcode150', roadmap_category: t.category });
          ctx.navigate('roadmap');
        },
      },
      h('span.topic-name', t.category),
      h('span.topic-bar', h('span.topic-fill', { style: { width: `${Math.round(t.ratio * 100)}%` } })),
      h('span.topic-count', `${t.solved}/${t.total}`)),
    ))),
    mastery.length > TOPICS_COLLAPSED ? toggleButton(ctx, 'topics', `Show all ${mastery.length} topics`) : null,
  );
}

/** Collapsed: the first topics in roadmap order, always including the focus topic. */
function visibleTopics(mastery, weakest) {
  if (expanded.topics || mastery.length <= TOPICS_COLLAPSED) return mastery;
  const shown = mastery.slice(0, TOPICS_COLLAPSED);
  if (weakest && !shown.includes(weakest)) shown[shown.length - 1] = weakest;
  return shown;
}

function toggleButton(ctx, key, label) {
  return h('button.link-btn.more-btn', {
    type: 'button',
    'aria-expanded': String(expanded[key]),
    onclick: () => { expanded[key] = !expanded[key]; ctx.rerender(); },
  }, expanded[key] ? 'Show less' : label);
}

function speed(data) {
  const times = Object.values(data.solve_times || {});
  if (!times.length) {
    return h('section',
      sectionHeader('Solve speed'),
      h('p.muted', 'Keep the LeetCode tab open while you work. LeetX times each attempt (only while the tab is visible) and tracks your personal bests.'),
    );
  }
  const by = diff => times.filter(t => t.difficulty === diff).map(t => t.last);
  const rows = ['Easy', 'Medium', 'Hard'].map(diff => ({ diff, med: median(by(diff)), count: by(diff).length }));
  const fastest = Object.entries(data.solve_times)
    .filter(([, t]) => t.best)
    .sort((a, b) => a[1].best - b[1].best)
    .slice(0, 3);

  return h('section',
    sectionHeader('Solve speed', h('span.section-meta', `${times.length} timed`)),
    h('dl.speed-grid', rows.map(r => h('div',
      h('dt', difficultyTag(r.diff)),
      h('dd', r.med ? formatClock(r.med) : '—'),
      h('span.speed-sub', r.count ? `median of ${r.count}` : 'no data yet'),
    ))),
    fastest.length ? h('ul.list.compact', fastest.map(([slug, t]) => h('li.list-row',
      h('button.list-main', { type: 'button', onclick: () => openExternal(problemUrl(slug)) },
        h('span.list-icon.tone-warning', icon('clock', { size: 13 })),
        h('span.list-text', h('span.list-title', slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())), h('span.list-sub', `Personal best · ${t.difficulty}`)),
        h('span.mono', formatClock(t.best)),
      ),
    ))) : null,
  );
}

function achievements(ctx, data, roadmaps) {
  const list = evaluateAchievements(achievementStats(data, roadmaps), data.achievements || {});
  const unlocked = list.filter(a => a.unlocked);
  // Unlocked first (most recent first), then the closest locked ones.
  const ordered = [
    ...unlocked.sort((a, b) => (b.unlockedAt || 0) - (a.unlockedAt || 0)),
    ...list.filter(a => !a.unlocked).sort((a, b) => b.progress - a.progress),
  ];
  const shown = expanded.badges ? ordered : ordered.slice(0, unlocked.length + LOCKED_PREVIEW);

  return h('section',
    sectionHeader('Achievements', h('span.section-meta', `${unlocked.length} of ${list.length}`)),
    h('ul.badges', shown.map(a => h(`li.badge${a.unlocked ? '.is-unlocked' : ''}`, { title: `${a.title}: ${a.desc}` },
      h('span.badge-icon', icon(a.icon, { size: 16 })),
      h('span.badge-title', a.title),
      h('span.badge-desc', a.unlocked ? a.desc : `${a.value} / ${a.goal}`),
      a.unlocked ? null : h('span.badge-bar', h('span.badge-fill', { style: { width: `${Math.round(a.progress * 100)}%` } })),
    ))),
    shown.length < ordered.length || expanded.badges ? toggleButton(ctx, 'badges', `Show all ${list.length} achievements`) : null,
  );
}
