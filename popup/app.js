/**
 * LeetX Squads popup - shell, routing and shared state.
 * Views render from cached chrome.storage state first (instant open), then
 * refresh from the network.
 */

import { computeStreak, levelFromXp, msUntilMidnight, toDateKey } from '../scripts/core.js';
import { applyDefaults, applyFreezesToStorage, migrateLegacyState, recordAchievements } from '../scripts/state.js';
import { h, icon, iconButton, mount, toast } from './ui.js';
import { renderToday } from './views/today.js';
import { renderProgress } from './views/progress.js';
import { renderSquad } from './views/squad.js';
import { renderDuels } from './views/duels.js';
import { renderRoadmap } from './views/roadmap.js';
import { renderSettings } from './views/settings.js';
import { renderOnboarding } from './views/onboarding.js';
import { applyTheme } from './theme.js';

const TABS = [
  { id: 'today', label: 'Today', icon: 'home' },
  { id: 'progress', label: 'Progress', icon: 'chart' },
  { id: 'squad', label: 'Squad', icon: 'users', also: ['duels'] },
  { id: 'roadmap', label: 'Roadmap', icon: 'map' },
];

export const store = {
  data: {},
  view: 'today',
  roadmaps: null,
  badges: { duels: 0 },
};

const cleanups = [];
let renderQueued = false;
let pendingRenderOnBlur = false;

export const ctx = {
  store,
  navigate,
  rerender: scheduleRender,
  onCleanup: fn => cleanups.push(fn),
  async set(values) {
    Object.assign(store.data, values);
    await chrome.storage.local.set(values);
  },
  derived() {
    const today = toDateKey();
    const streak = computeStreak(store.data.solve_history, today, store.data.frozen_days);
    return {
      today,
      ...streak,
      goal: Math.max(1, Number(store.data.daily_goal) || 1),
      level: levelFromXp(store.data.user_xp || 0),
      msLeft: msUntilMidnight(),
      solvedSlugs: new Set(store.data.user_solved_slugs || []),
      freezes: store.data.streak_freezes || 0,
      frozenDays: new Set(store.data.frozen_days || []),
    };
  },
  async getRoadmaps() {
    if (store.roadmaps) return store.roadmaps;
    store.roadmapsPromise ||= (async () => {
      const load = async name => (await fetch(chrome.runtime.getURL(`assets/data/${name}.json`))).json();
      const [blind75, neetcode150] = await Promise.all([load('blind75'), load('neetcode150')]);
      store.roadmaps = { blind75, neetcode150 };
      return store.roadmaps;
    })().catch(err => { store.roadmapsPromise = null; throw err; });
    return store.roadmapsPromise;
  },
  sendMessage(message) {
    return chrome.runtime.sendMessage(message).catch(err => ({ success: false, error: err.message }));
  },
};

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function renderHeader() {
  const d = ctx.derived();
  const risk = !d.solvedToday && d.streak > 0 && d.msLeft < 3 * 3600 * 1000;
  const flameState = d.solvedToday ? 'hot' : risk ? 'risk' : d.streak > 0 ? 'warm' : 'cold';
  const streakLabel = d.streak === 0
    ? 'No active streak'
    : `${d.streak}-day streak${d.solvedToday ? ', done for today' : ', not solved today yet'}`;

  return h('header.topbar',
    h('div.brand',
      h('img.brand-mark', { src: '../assets/icons/icon48.png', alt: '', width: 20, height: 20 }),
      h('span.brand-name', 'LeetX'),
    ),
    h('div.topbar-right',
      h(`button.chip.streak-chip.is-${flameState}`, { type: 'button', title: streakLabel, 'aria-label': streakLabel, onclick: () => navigate('today') },
        icon('flame', { size: 14 }),
        h('span.chip-num', String(d.streak)),
      ),
      h('span.chip.level-chip', { title: `${d.level.xp} XP · ${d.level.toNext} XP to level ${d.level.level + 1}` },
        h('span.chip-label', 'Lv'),
        h('span.chip-num', String(d.level.level)),
      ),
      iconButton('settings', 'Settings', { class: store.view === 'settings' ? 'is-active' : '', onclick: () => navigate(store.view === 'settings' ? 'today' : 'settings') }),
    ),
  );
}

function renderTabs() {
  const nav = h('nav.tabs', { role: 'tablist', 'aria-label': 'Sections' });
  TABS.forEach((tab, index) => {
    const active = store.view === tab.id || (tab.also || []).includes(store.view);
    const badge = tab.id === 'squad' && store.badges.duels > 0 ? h('span.tab-dot', { 'aria-label': `${store.badges.duels} duel invites` }) : null;
    nav.appendChild(h(`button.tab${active ? '.is-active' : ''}`, {
      type: 'button',
      role: 'tab',
      id: `tab-${tab.id}`,
      'aria-selected': String(active),
      'aria-controls': 'view',
      'aria-keyshortcuts': String(index + 1),
      tabIndex: active ? 0 : -1,
      onclick: () => navigate(tab.id),
      onkeydown: e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = TABS[(index + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        navigate(next.id).then(() => document.getElementById(`tab-${next.id}`)?.focus());
      },
    }, icon(tab.icon, { size: 15 }), h('span', tab.label), badge));
  });
  return nav;
}

const VIEWS = {
  today: renderToday,
  progress: renderProgress,
  squad: renderSquad,
  duels: renderDuels,
  roadmap: renderRoadmap,
  settings: renderSettings,
};

async function render() {
  renderQueued = false;
  const app = document.getElementById('app');

  if (!store.data.onboarded) {
    runCleanups();
    mount(app, renderOnboarding(ctx));
    return;
  }

  const active = document.activeElement;
  const typing = active && app.contains(active) && active.matches('input[type="text"], input[type="password"], input[type="search"], textarea');
  if (typing || app.querySelector('.sheet-backdrop')) {
    pendingRenderOnBlur = true;
    return;
  }

  runCleanups();
  const scrollTop = document.getElementById('view')?.scrollTop || 0;
  const sameView = app.dataset.view === store.view;
  const tabId = TABS.find(t => t.id === store.view || (t.also || []).includes(store.view))?.id || store.view;
  const view = h('main#view.view', { role: 'tabpanel', 'aria-labelledby': `tab-${tabId}`, tabIndex: -1 });
  const content = await VIEWS[store.view](ctx);
  mount(view, content);

  mount(app,
    renderHeader(),
    store.view === 'settings' ? null : renderTabs(),
    view,
    h('div#toast-region.toast-region', { 'aria-live': 'polite' }),
  );
  app.dataset.view = store.view;
  if (sameView) view.scrollTop = scrollTop;
}

function runCleanups() {
  while (cleanups.length) {
    try { cleanups.pop()(); } catch { /* ignore */ }
  }
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => render().catch(err => console.error('[LeetX] render', err)));
}

export async function navigate(view) {
  if (!VIEWS[view]) view = 'today';
  store.view = view;
  if (view !== 'settings') chrome.storage.session?.set({ last_view: view }).catch(() => {});
  await render();
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

const RERENDER_KEYS = new Set([
  'solve_history', 'user_xp', 'user_solved_slugs', 'total_solved', 'solved_easy_count', 'solved_med_count',
  'solved_hard_count', 'lc_calendar', 'sync_status', 'github_token', 'github_repo_owner', 'my_squad_code',
  'daily_goal', 'duel_history', 'current_duel_id', 'review_schedule', 'onboarded', 'github_last_error',
  'frozen_days', 'streak_freezes', 'achievements', 'checklist_dismissed',
]);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let relevant = false;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (newValue === undefined) delete store.data[key];
    else store.data[key] = newValue;
    if (RERENDER_KEYS.has(key)) relevant = true;
  }
  if (changes.theme_preference) applyTheme(store.data.theme_preference);
  if (relevant) scheduleRender();
});

document.addEventListener('focusout', () => {
  if (!pendingRenderOnBlur) return;
  setTimeout(() => {
    const active = document.activeElement;
    if (active?.matches?.('input, textarea')) return;
    pendingRenderOnBlur = false;
    scheduleRender();
  }, 0);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.querySelector('.sheet-backdrop')) {
    document.querySelector('.sheet-backdrop')?.dispatchEvent(new Event('close'));
    return;
  }
  // Single-key shortcuts, ignored while typing or when a modifier is held.
  if (!store.data.onboarded || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.sheet-backdrop')) return;
  if (e.target instanceof Element && e.target.matches('input, textarea, select, [contenteditable]')) return;
  const tab = TABS[Number(e.key) - 1];
  if (tab) { e.preventDefault(); navigate(tab.id); return; }
  if (e.key === ',') { e.preventDefault(); navigate('settings'); return; }
  if (e.key === '/') {
    e.preventDefault();
    navigate('roadmap').then(() => document.querySelector('.input-search')?.focus());
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  await migrateLegacyState();
  await applyDefaults();
  const freeze = await applyFreezesToStorage();
  store.data = await chrome.storage.local.get(null);
  // Users upgrading from v1 already connected GitHub - skip the welcome flow.
  if (!store.data.onboarded && store.data.github_token) {
    store.data.onboarded = true;
    await chrome.storage.local.set({ onboarded: true });
  }
  applyTheme(store.data.theme_preference);

  const session = (await chrome.storage.session?.get(['open_view', 'last_view']).catch(() => ({}))) || {};
  if (session.open_view) {
    store.view = session.open_view;
    chrome.storage.session.remove('open_view').catch(() => {});
  } else if (session.last_view) {
    store.view = session.last_view;
  }

  await render();
  document.body.classList.add('is-ready');

  if (freeze.used.length) {
    toast(`A streak freeze covered ${freeze.used.length === 1 ? 'yesterday' : `${freeze.used.length} days`}. Your ${freeze.streak}-day streak is safe.`, { tone: 'success' });
  }
  recordAchievements(await ctx.getRoadmaps().catch(() => ({}))).then(fresh => {
    if (fresh.length) toast(`Achievement unlocked: ${fresh.map(a => a.title).join(', ')}`, { tone: 'success' });
  }).catch(() => {});

  // Show a dot on the Duels tab when a challenge is waiting.
  if (store.data.my_squad_code && store.view !== 'duels' && store.view !== 'squad') {
    import('../scripts/firebase.js')
      .then(({ Duels }) => Duels.listMine())
      .then(({ incoming }) => {
        if (incoming.length !== store.badges.duels) {
          store.badges.duels = incoming.length;
          scheduleRender();
        }
      })
      .catch(() => {});
  }

  // Background refresh of LeetCode totals / calendar (cheap, cached by the worker).
  const age = Date.now() - (store.data.stats_updated_at || 0);
  if (age > 10 * 60 * 1000) ctx.sendMessage({ type: 'REFRESH_STATE' });
}

boot().catch(err => {
  console.error('[LeetX] boot failed', err);
  mount(document.getElementById('app'), h('div.fatal', h('strong', 'LeetX could not start.'), h('p', err.message)));
});
