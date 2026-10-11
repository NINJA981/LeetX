import { formatTimeAgo, toDateKey } from '../../scripts/core.js';
import { Duels, Squads } from '../../scripts/firebase.js';
import { LeetCodeAPI } from '../../scripts/leetcode.js';
import { duelRecord, getProfile, recordDuelOutcome } from '../../scripts/state.js';
import {
  avatar, busy, button, emptyState, h, icon, mount, openExternal, problemUrl, sectionHeader, segmented, skeleton, toast,
} from '../ui.js';
import { squadSwitch } from './squad.js';

const FORMATS = [
  { value: 'random_blind75', label: 'Blind 75' },
  { value: 'random_neetcode150', label: 'NeetCode' },
  { value: 'daily', label: 'Daily' },
  { value: 'random_easy', label: 'Easy' },
  { value: 'random_hard', label: 'Hard' },
];
const FORMAT_NAMES = {
  random_blind75: 'Blind 75', random_neetcode150: 'NeetCode 150', daily: 'Daily challenge', random_easy: 'Easy sprint', random_hard: 'Hard boss',
};

let setup = { opponentUid: null, format: 'random_blind75' };
let clockTimer = null;

export async function renderDuels(ctx) {
  const code = ctx.store.data.my_squad_code;
  if (!code) {
    return emptyState({
      iconName: 'swords',
      title: 'Duels happen inside a squad',
      body: 'Join or create a squad, then race a friend to solve the same hidden problem first.',
      actions: [button('Go to squad', { variant: 'primary', onclick: () => ctx.navigate('squad') })],
    });
  }

  const root = h('div.stack-lg', squadSwitch(ctx, 'duels'), skeleton(3));
  // Poll fast only while something is happening; idle screens cost ~3 reads per refresh.
  let live = false;
  let lastRefresh = 0;
  const refresh = async () => {
    lastRefresh = Date.now();
    try {
      const [mine, finished] = await Promise.all([Duels.listMine(), loadFinished(ctx)]);
      live = Boolean(mine.active || mine.outgoing);
      ctx.store.badges.duels = mine.incoming.length;
      const content = await duelsContent(ctx, code, mine, finished);
      mount(root, content);
    } catch (err) {
      console.warn('[LeetX] duels refresh', err);
      if (root.querySelector('.skeleton')) {
        mount(root, squadSwitch(ctx, 'duels'), emptyState({ iconName: 'alert', title: "Couldn't load duels", body: 'Check your connection and try again.', actions: [button('Retry', { onclick: () => ctx.rerender() })] }));
      }
    }
  };
  refresh();
  const timer = setInterval(() => {
    if (document.visibilityState !== 'visible' || root.querySelector('input:focus')) return;
    if (Date.now() - lastRefresh >= (live ? 8000 : 20000)) refresh();
  }, 4000);
  ctx.onCleanup(() => clearInterval(timer));
  return root;
}

/** The last duel this device took part in, if it finished and hasn't been dismissed. */
async function loadFinished(ctx) {
  const id = ctx.store.data.current_duel_id;
  if (!id) return null;
  const duel = await Duels.get(id).catch(() => null);
  if (!duel) return null;
  if (['completed', 'forfeited'].includes(duel.status)) {
    const problem = await Duels.getProblem(id).catch(() => null);
    const uid = (await chrome.storage.local.get('fb_session')).fb_session?.uid;
    await recordDuelOutcome({ ...duel, problemTitle: problem?.title }, uid);
    return { ...duel, problem, uid };
  }
  if (['declined', 'cancelled'].includes(duel.status)) return { ...duel, uid: null };
  return null;
}

async function duelsContent(ctx, code, mine, finished) {
  const parts = [squadSwitch(ctx, 'duels')];
  if (mine.incoming.length) parts.push(incomingList(ctx, mine.incoming));

  if (mine.active) parts.push(await arena(ctx, mine.active, mine.uid));
  else if (finished) parts.push(resultCard(ctx, finished));
  else if (mine.outgoing) parts.push(waitingCard(ctx, mine.outgoing));
  else parts.push(await setupForm(ctx, code, mine.uid));

  parts.push(record(ctx));
  return parts;
}

function incomingList(ctx, invites) {
  return h('section',
    sectionHeader(invites.length > 1 ? `${invites.length} challenges` : 'Challenge'),
    h('ul.invites', invites.map(inv => h('li.invite',
      avatar(inv.challengerName, { size: 32 }),
      h('div.invite-text',
        h('div.invite-title', h('strong', inv.challengerName), ' wants to race'),
        h('div.invite-sub', `${inv.difficulty} · ${FORMAT_NAMES[inv.format] || 'Random'} · ${formatTimeAgo(inv.createdAt)}`),
      ),
      h('div.invite-actions',
        button('Decline', { size: 'sm', variant: 'ghost', onclick: busy(async () => { await Duels.decline(inv); toast('Declined'); ctx.rerender(); }) }),
        button('Accept', {
          size: 'sm',
          variant: 'primary',
          onclick: busy(async () => {
            const problem = await Duels.accept(inv, await getProfile());
            toast(problem ? `Go: ${problem.title}` : 'Duel on', { tone: 'success' });
            ctx.store.data.current_duel_id = inv.id;
            ctx.rerender();
          }),
        }),
      ),
    ))),
  );
}

async function arena(ctx, duel, uid) {
  const problem = await Duels.getProblem(duel.id).catch(() => null);
  const opponent = duel.challengerUid === uid ? duel.opponentName : duel.challengerName;
  const clock = h('div.arena-clock', { 'aria-live': 'off' }, '00:00');
  const tick = () => {
    const s = Math.max(0, Math.floor((Date.now() - (duel.acceptedAt || Date.now())) / 1000));
    clock.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  clearInterval(clockTimer);
  clockTimer = setInterval(tick, 1000);
  ctx.onCleanup(() => clearInterval(clockTimer));

  return h('section.arena',
    h('div.arena-top', h('span.live-dot'), h('span', 'Live duel'), h('span.arena-vs', `vs ${opponent}`)),
    clock,
    problem
      ? h('div.arena-problem', h('div.arena-title', problem.id ? `${problem.id}. ${problem.title}` : problem.title), h(`span.diff.diff-${problem.difficulty.toLowerCase()}`, problem.difficulty))
      : h('div.arena-problem.muted', 'Loading problem…'),
    h('p.arena-note', 'First accepted submission wins. LeetX detects it automatically.'),
    h('div.arena-actions',
      problem ? button('Open problem', { variant: 'primary', iconRight: 'external', onclick: () => openExternal(problemUrl(problem.slug)) }) : null,
      button('Forfeit', {
        variant: 'ghost',
        iconName: 'flag',
        onclick: busy(async () => {
          if (!confirm(`Forfeit and give ${opponent} the win?`)) return;
          await Duels.forfeit(duel, await getProfile());
          toast('Duel forfeited');
          ctx.rerender();
        }),
      }),
    ),
  );
}

function waitingCard(ctx, duel) {
  return h('section.waiting',
    h('div.waiting-row',
      avatar(duel.opponentName, { size: 36, ring: 'pending' }),
      h('div',
        h('div.waiting-title', `Waiting for ${duel.opponentName}`),
        h('div.muted', `${duel.difficulty} · ${FORMAT_NAMES[duel.format] || 'Random'} · sent ${formatTimeAgo(duel.createdAt)} ago`),
      ),
    ),
    h('p.muted', 'The problem stays hidden until they accept, so nobody gets a head start.'),
    button('Cancel challenge', { size: 'sm', variant: 'ghost', onclick: busy(async () => { await Duels.cancel(duel); toast('Challenge cancelled'); ctx.rerender(); }) }),
  );
}

function resultCard(ctx, duel) {
  const dismiss = async () => {
    await chrome.storage.local.remove('current_duel_id');
    delete ctx.store.data.current_duel_id;
    ctx.rerender();
  };
  if (duel.status === 'declined' || duel.status === 'cancelled') {
    return h('section.result',
      h('div.result-title', duel.status === 'declined' ? `${duel.opponentName} declined` : 'Challenge cancelled'),
      button('New duel', { variant: 'primary', onclick: dismiss }),
    );
  }
  const won = duel.winnerUid === duel.uid;
  return h(`section.result${won ? '.is-win' : '.is-loss'}`,
    h('div.result-icon', icon(won ? 'trophy' : 'flag', { size: 22 })),
    h('div.result-title', won ? 'You won' : `${duel.winnerName} won`),
    h('p.result-body',
      duel.problem ? `${duel.problem.title}` : '',
      duel.runtime ? ` · ${duel.runtime}` : '',
      duel.status === 'forfeited' ? ' · by forfeit' : '',
      won ? ' · +50 XP' : '',
    ),
    h('div.result-actions',
      duel.problem && !won ? button('Solve it anyway', { variant: 'ghost', onclick: () => openExternal(problemUrl(duel.problem.slug)) }) : null,
      button(won ? 'Next duel' : 'Rematch', { variant: 'primary', onclick: dismiss }),
    ),
  );
}

async function setupForm(ctx, code, uid) {
  const cached = ctx.store.data.squad_cache?.code === code ? ctx.store.data.squad_cache.snapshot : null;
  let members = cached?.members;
  if (!members) {
    const snap = await Squads.getSnapshot(code, { previous: cached }).catch(() => null);
    members = snap?.members || [];
  }
  const today = toDateKey();
  const opponents = members.filter(m => m.uid !== uid);

  if (opponents.length === 0) {
    return emptyState({
      iconName: 'userPlus',
      title: 'Invite someone to race',
      body: 'Duels need at least two people in your squad. Share your squad code first.',
      actions: [button('Copy squad code', {
        onclick: async () => { await navigator.clipboard.writeText(`Join my LeetX squad: ${code}`); toast('Invite copied', { tone: 'success' }); },
      })],
    });
  }
  if (!opponents.some(o => o.uid === setup.opponentUid)) setup.opponentUid = opponents[0].uid;

  const picker = h('div.pick-list', { role: 'radiogroup', 'aria-label': 'Opponent' },
    opponents.map(o => {
      const selected = o.uid === setup.opponentUid;
      return h(`button.pick${selected ? '.is-selected' : ''}`, {
        type: 'button',
        role: 'radio',
        'aria-checked': String(selected),
        onclick: () => { setup.opponentUid = o.uid; ctx.rerender(); },
      },
      avatar(o.name, { size: 26 }),
      h('span.pick-name', o.name),
      h('span.pick-meta', o.todayDate === today && o.todaySolved ? 'solved today' : `${o.streak || 0}d streak`),
      h('span.pick-radio'));
    }));

  return h('section.stack',
    sectionHeader('Start a duel'),
    h('p.muted', 'You both get the same problem. It stays hidden until they accept, then the first accepted solve wins.'),
    h('div.field', h('span.field-label', 'Opponent'), picker),
    h('div.field',
      h('span.field-label', 'Problem'),
      segmented(FORMATS, setup.format, v => { setup.format = v; ctx.rerender(); }, { label: 'Problem set', size: 'sm' }),
    ),
    button('Send challenge', {
      variant: 'primary',
      iconName: 'swords',
      class: 'btn-block',
      onclick: busy(async () => {
        const opponent = opponents.find(o => o.uid === setup.opponentUid);
        const problem = await pickProblem(ctx, setup.format);
        await Duels.create({ code, opponent, format: setup.format, problem, profile: await getProfile() });
        ctx.store.data.current_duel_id = null;
        toast(`Challenge sent to ${opponent.name}`, { tone: 'success' });
        ctx.rerender();
      }),
    }),
  );
}

async function pickProblem(ctx, format) {
  if (format === 'daily') {
    const daily = await LeetCodeAPI.getDailyChallenge();
    if (daily) return daily;
  }
  const { blind75, neetcode150 } = await ctx.getRoadmaps();
  let pool = format === 'random_neetcode150' ? neetcode150 : blind75;
  if (format === 'random_easy') pool = neetcode150.filter(p => p.difficulty === 'Easy');
  if (format === 'random_hard') pool = neetcode150.filter(p => p.difficulty === 'Hard');
  const solved = new Set(ctx.store.data.user_solved_slugs || []);
  const fresh = pool.filter(p => !solved.has(p.slug));
  const source = fresh.length ? fresh : pool;
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return source[bytes[0] % source.length];
}

function record(ctx) {
  const history = ctx.store.data.duel_history || [];
  const r = duelRecord(history);
  return h('section',
    sectionHeader('Your record'),
    h('dl.record',
      h('div', h('dt', 'Won'), h('dd', String(r.wins))),
      h('div', h('dt', 'Lost'), h('dd', String(r.losses))),
      h('div', h('dt', 'Win rate'), h('dd', r.played ? `${r.winRate}%` : '—')),
    ),
    history.length
      ? h('ul.history', history.slice(0, 5).map(m => h('li',
        h(`span.history-mark.${m.won ? 'win' : 'loss'}`, m.won ? 'W' : 'L'),
        h('span.history-text', `vs ${m.opponentName}`, m.problemTitle ? h('span.muted', ` · ${m.problemTitle}`) : null),
        h('time.muted', formatTimeAgo(m.finishedAt)),
      )))
      : null,
  );
}
