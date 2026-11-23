import { MAX_SQUAD_MEMBERS, formatTimeAgo, getCatalogEntry, toDateKey } from '../../scripts/core.js';
import { Squads, SquadError } from '../../scripts/firebase.js';
import { getProfile } from '../../scripts/state.js';
import {
  avatar, busy, button, confirmButton, confirmDialog, emptyState, h, icon, iconButton, mount, sectionHeader, segmented, skeleton, toast,
} from '../ui.js';

/** Members / Duels switch shown at the top of both squad screens. */
export function squadSwitch(ctx, active) {
  const invites = ctx.store.badges.duels || 0;
  return h('div.squad-switch',
    segmented([
      { value: 'squad', label: 'Members', icon: 'users' },
      { value: 'duels', label: invites ? `Duels · ${invites}` : 'Duels', icon: 'swords' },
    ], active, v => ctx.navigate(v), { label: 'Squad section' }),
  );
}

const NUDGE_COOLDOWN_MS = 4 * 60 * 60 * 1000;
// Refreshes are incremental (~2 reads each), see Squads.getSnapshot.
const POLL_MS = 30000;

let manageMode = false;

export async function renderSquad(ctx) {
  const code = ctx.store.data.my_squad_code;
  if (!code) return noSquad(ctx);

  const root = h('div.stack-lg');
  const cached = ctx.store.data.squad_cache;
  if (cached?.code === code && cached.snapshot?.status === 'ok') {
    mount(root, squadContent(ctx, code, cached.snapshot));
  } else {
    mount(root, squadSwitch(ctx, 'squad'), h('div.stack', skeleton(2), skeleton(3), skeleton(3)));
  }

  const refresh = async () => {
    try {
      const prev = ctx.store.data.squad_cache?.code === code ? ctx.store.data.squad_cache.snapshot : null;
      let snapshot = await Squads.getSnapshot(code, { previous: prev });
      const migrating = snapshot.status === 'legacy' || (snapshot.status === 'not_member' && ctx.store.data.squad_needs_rejoin);
      if (migrating) {
        await Squads.joinSquad(code, await getProfile(), { announce: false });
        await chrome.storage.local.remove('squad_needs_rejoin');
        delete ctx.store.data.squad_needs_rejoin;
        snapshot = await Squads.getSnapshot(code);
      }
      if (snapshot.status !== 'ok') return handleLostSquad(ctx, snapshot.status);
      await chrome.storage.local.set({ squad_cache: { code, snapshot, at: Date.now() } });
      ctx.store.data.squad_cache = { code, snapshot, at: Date.now() };
      if (!root.querySelector('.menu, .is-armed')) mount(root, squadContent(ctx, code, snapshot));
    } catch (err) {
      console.warn('[LeetX] squad refresh', err);
      if (!cached) {
        mount(root, emptyState({
          iconName: 'alert',
          title: 'Squad is unreachable',
          body: 'Check your connection. Your solves are still recorded locally and will sync.',
          actions: [button('Try again', { onclick: () => ctx.rerender() })],
        }));
      }
    }
  };
  refresh();
  const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
  ctx.onCleanup(() => clearInterval(timer));
  return root;
}

async function handleLostSquad(ctx, status) {
  await chrome.storage.local.remove(['my_squad_code', 'squad_cache']);
  const msg = {
    banned: 'The squad leader removed you from this squad.',
    not_member: "You're no longer a member of that squad.",
    missing: 'That squad no longer exists.',
  }[status] || 'Squad unavailable.';
  toast(msg);
}

// ---------------------------------------------------------------------------
// No squad yet
// ---------------------------------------------------------------------------

function noSquad(ctx) {
  const input = h('input.input.input-code', {
    type: 'text',
    placeholder: 'K9X2P4',
    maxLength: 12,
    autocomplete: 'off',
    spellcheck: false,
    'aria-label': 'Squad code',
    oninput: e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); },
    onkeydown: e => { if (e.key === 'Enter') joinBtn.click(); },
  });
  const joinBtn = button('Join', {
    onclick: busy(async () => {
      const code = Squads.normalizeCode(input.value);
      if (!code) { toast('Enter the 6-character code your friend shared'); input.focus(); return; }
      await Squads.joinSquad(code, await getProfile()).catch(rethrowFriendly);
      toast(`Joined squad ${code}`, { tone: 'success' });
      ctx.store.data.my_squad_code = code;
      ctx.rerender();
    }),
  });

  return h('div.stack-lg',
    h('section.intro',
      h('div.intro-art', avatarCluster()),
      h('h1.intro-title', 'Practice is easier together'),
      h('p.intro-body', "Start a squad, share the code, and you'll see who has solved today, nudge each other and race in 1v1 duels."),
      button('Create a squad', {
        variant: 'primary',
        iconName: 'plus',
        class: 'btn-block',
        onclick: busy(async () => {
          const code = await Squads.createSquad(await getProfile()).catch(rethrowFriendly);
          toast(`Squad ${code} created. Share the code to invite friends.`, { tone: 'success' });
          ctx.store.data.my_squad_code = code;
          ctx.rerender();
        }),
      }),
    ),
    h('div.divider-label', h('span', 'or join with a code')),
    h('div.join-row', input, joinBtn),
  );
}

function avatarCluster() {
  return h('div.cluster', ['Ada', 'Linus', 'Grace'].map((n, i) => avatar(n, { size: 34, ring: i === 1 ? 'done' : null })));
}

function rethrowFriendly(err) {
  if (err instanceof SquadError) throw err;
  if (err?.isPermissionDenied) throw new Error("You don't have access to that squad.");
  throw new Error(navigator.onLine ? 'Could not reach the squad server. Try again.' : "You're offline.");
}

// ---------------------------------------------------------------------------
// Squad
// ---------------------------------------------------------------------------

function isSolvedToday(m, today) {
  return m.todayDate === today && (m.todaySolved || 0) > 0;
}

function squadContent(ctx, code, snap) {
  const today = toDateKey();
  const members = [...snap.members].sort((a, b) =>
    Number(isSolvedToday(b, today)) - Number(isSolvedToday(a, today))
    || (b.streak || 0) - (a.streak || 0)
    || (b.xp || 0) - (a.xp || 0));
  const solvedToday = members.filter(m => isSolvedToday(m, today));
  if (!snap.isOwner || members.length < 2) manageMode = false;

  return [
    squadSwitch(ctx, 'squad'),
    squadHeader(ctx, code, snap, members),
    todaySummary(members, solvedToday, snap.uid),
    challengeBlock(ctx, code, snap),
    memberList(ctx, code, snap, members, today),
    feed(snap),
  ];
}

function squadHeader(ctx, code, snap, members) {
  const menuBtn = iconButton('more', 'Squad options', {
    'aria-haspopup': 'menu',
    onclick: e => openMenu(e.currentTarget, ctx, code, snap, members),
  });
  return h('section.squad-head',
    h('div',
      h('div.eyebrow', `Squad · ${members.length}/${MAX_SQUAD_MEMBERS}`),
      h('button.code-btn', {
        type: 'button',
        title: 'Copy invite',
        onclick: async () => {
          await navigator.clipboard.writeText(`Join my LeetX squad: ${code}`);
          toast('Invite copied', { tone: 'success' });
        },
      }, h('span.code', code), icon('copy', { size: 14 })),
    ),
    menuBtn,
  );
}

function openMenu(anchor, ctx, code, snap, members) {
  document.querySelector('.menu')?.remove();
  const close = () => { menu.remove(); document.removeEventListener('click', outside, true); };
  const outside = e => { if (!menu.contains(e.target) && e.target !== anchor) close(); };
  const item = (label, iconName, onClick, danger = false) =>
    h(`button.menu-item${danger ? '.is-danger' : ''}`, { type: 'button', role: 'menuitem', onclick: async () => { close(); await onClick(); } }, icon(iconName, { size: 15 }), h('span', label));

  const items = [
    item('Copy invite message', 'copy', async () => {
      await navigator.clipboard.writeText(`Join my LeetX squad and keep me honest on LeetCode. Code: ${code}`);
      toast('Invite copied', { tone: 'success' });
    }),
  ];
  if (snap.isOwner) {
    items.push(item('New challenge', 'shuffle', busy(async () => {
      const next = await Squads.rerollChallenge(code, await getProfile());
      toast(`New challenge: ${next.title}`);
      ctx.rerender();
    })));
    if (members.length > 1) {
      items.push(item(manageMode ? 'Done managing' : 'Remove members', 'userMinus', () => { manageMode = !manageMode; ctx.rerender(); }));
    }
    const banned = (snap.squad.bannedUids || []).length;
    if (banned) {
      items.push(item(`Let removed members rejoin (${banned})`, 'userPlus', busy(async () => {
        await Squads.clearBans(code);
        toast('Removed members can rejoin with the code', { tone: 'success' });
        ctx.rerender();
      })));
    }
  }
  items.push(item('Leave squad', 'logOut', async () => {
    const ok = await confirmDialog({
      title: 'Leave this squad?',
      body: snap.isOwner && members.length > 1 ? 'Leadership passes to the most active member.' : 'You can rejoin later with the squad code.',
      confirmLabel: 'Leave squad',
      danger: true,
    });
    if (!ok) return;
    await Squads.leaveSquad(code, await getProfile());
    delete ctx.store.data.my_squad_code;
    toast('You left the squad');
    ctx.rerender();
  }, true));

  const menu = h('div.menu', { role: 'menu' }, items);
  anchor.closest('section').appendChild(menu);
  setTimeout(() => document.addEventListener('click', outside, true));
  menu.querySelector('button')?.focus();
}

function todaySummary(members, solvedToday, uid) {
  const total = members.length;
  const meDone = solvedToday.some(m => m.uid === uid);
  let line;
  if (total === 1) line = 'Just you so far. Share the code to bring friends in.';
  else if (solvedToday.length === total) line = 'Everyone solved today. Squad goals.';
  else if (!meDone && solvedToday.length > 0) line = `${solvedToday.length} solved today. You're up.`;
  else if (meDone) line = `${total - solvedToday.length} still to go today.`;
  else line = 'Nobody has solved yet today. Be first.';

  return h('section.today-squad',
    h('div.today-squad-top',
      h('div.avatars', members.slice(0, 8).map(m => avatar(m.name, { size: 26, ring: isSolvedToday(m, toDateKey()) ? 'done' : 'pending' }))),
      h('span.today-count', h('strong', String(solvedToday.length)), `/${total} today`),
    ),
    h('p.today-line', line),
  );
}

function challengeBlock(ctx, code, snap) {
  const ch = snap.squad.challenge;
  if (!ch) return null;
  const progress = Math.min(ch.target, snap.challengeProgress || 0);
  const entry = getCatalogEntry(ch.key);
  const segments = h('div.segments', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': ch.target, 'aria-valuenow': progress, 'aria-label': 'Challenge progress' },
    Array.from({ length: ch.target }, (_, i) => h(`span.segment-pip${i < progress ? '.is-filled' : ''}`)));

  return h('section.challenge',
    h('div.challenge-top',
      h('div.eyebrow', icon('target', { size: 13 }), 'Squad challenge'),
      h('span.reward', `+${ch.rewardXp} XP each`),
    ),
    h('div.challenge-title', ch.title),
    segments,
    h('div.challenge-foot',
      h('span.muted', `${progress} of ${ch.target}${snap.squad.completedChallenges ? ` · ${snap.squad.completedChallenges} cleared so far` : ''}`),
      entry?.roadmapCategory
        ? h('button.link-btn', {
          type: 'button',
          onclick: async () => {
            await ctx.set({ roadmap_category: entry.roadmapCategory });
            ctx.navigate('roadmap');
          },
        }, 'Find problems', icon('arrowRight', { size: 13 }))
        : null,
    ),
  );
}

function memberList(ctx, code, snap, members, today) {
  const nudges = ctx.store.data.nudges_sent || {};
  return h('section',
    sectionHeader(manageMode ? 'Remove members' : 'Leaderboard',
      manageMode ? button('Done', { size: 'sm', variant: 'ghost', onclick: () => { manageMode = false; ctx.rerender(); } }) : null),
    h('ol.members', members.map((m, i) => {
      const isMe = m.uid === snap.uid;
      const done = isSolvedToday(m, today);
      const isLeader = m.uid === snap.squad.ownerUid;
      const nudgedAt = nudges[`${code}:${m.uid}`] || 0;
      const canNudge = !isMe && !done && Date.now() - nudgedAt > NUDGE_COOLDOWN_MS;

      let action;
      if (manageMode && !isMe) {
        action = confirmButton('Remove', 'Confirm', async () => {
          await Squads.kickMember(code, m, await getProfile());
          toast(`${m.name} removed`);
          ctx.rerender();
        }, { iconName: 'userMinus' });
      } else if (done) {
        action = h('span.state-done', { title: 'Solved today' }, icon('check', { size: 14 }), h('span.sr-only', 'Solved today'));
      } else if (isMe) {
        action = h('span.state-pending', 'Not yet');
      } else {
        action = button(canNudge ? 'Nudge' : 'Nudged', {
          size: 'sm',
          variant: 'ghost',
          iconName: 'bell',
          disabled: !canNudge,
          title: canNudge ? `Remind ${m.name} to solve today` : 'You can nudge again in a few hours',
          onclick: busy(async () => {
            await Squads.sendNudge(code, m, await getProfile());
            await ctx.set({ nudges_sent: { ...nudges, [`${code}:${m.uid}`]: Date.now() } });
            toast(`Nudged ${m.name}`, { tone: 'success' });
            ctx.rerender();
          }),
        });
      }

      return h(`li.member${isMe ? '.is-me' : ''}`,
        h('span.rank', String(i + 1)),
        avatar(m.name, { size: 30, ring: done ? 'done' : null }),
        h('div.member-text',
          h('div.member-name',
            h('span.name', m.name),
            isMe ? h('span.tag', 'you') : null,
            isLeader ? h('span.tag.tag-leader', { title: 'Squad leader' }, icon('crown', { size: 11 })) : null,
          ),
          h('div.member-sub',
            h('span', { class: m.streak ? 'flame-text' : '' }, icon('flame', { size: 11 }), `${m.streak || 0}d`),
            h('span', `${m.totalSolved || 0} solved`),
            h('span', `${(m.xp || 0).toLocaleString()} XP`),
          ),
        ),
        action,
      );
    })),
  );
}

// ---------------------------------------------------------------------------
// Activity feed (every string goes through textContent)
// ---------------------------------------------------------------------------

const FEED_ICONS = {
  solve: 'check', join: 'userPlus', leave: 'logOut', kick: 'userMinus', nudge: 'bell',
  challenge_complete: 'trophy', challenge_reroll: 'shuffle', duel_challenge: 'swords',
  duel_accepted: 'swords', duel_result: 'trophy', duel_forfeit: 'flag',
};

function describe(e) {
  const b = text => h('strong', text);
  switch (e.type) {
    case 'solve': return [b(e.actorName), ' solved ', b(e.problem?.title || 'a problem')];
    case 'join': return [b(e.actorName), ' joined the squad'];
    case 'leave': return [b(e.actorName), ' left the squad'];
    case 'kick': return [b(e.actorName), ' removed ', b(e.targetName)];
    case 'nudge': return [b(e.actorName), ' nudged ', b(e.targetName)];
    case 'challenge_complete': return ['Squad cleared ', b(e.challengeTitle || 'the challenge'), ` · +${e.rewardXp || 0} XP`];
    case 'challenge_reroll': return [b(e.actorName), ' picked a new challenge: ', e.challengeTitle || ''];
    case 'duel_challenge': return [b(e.actorName), ' challenged ', b(e.targetName), ' to a duel'];
    case 'duel_accepted': return [b(e.actorName), ' accepted ', b(e.targetName), "'s duel"];
    case 'duel_result': return [b(e.actorName), ' won a duel against ', b(e.targetName)];
    case 'duel_forfeit': return [b(e.actorName), ' forfeited to ', b(e.targetName)];
    default: return [b(e.actorName), ' did something'];
  }
}

function feed(snap) {
  const events = snap.events || [];
  return h('section',
    sectionHeader('Activity'),
    events.length === 0
      ? h('p.muted.pad', 'Nothing yet. Solves, nudges and duels show up here.')
      : h('ul.feed', events.map(e => h(`li.feed-item.type-${e.type}`,
        h('span.feed-icon', icon(FEED_ICONS[e.type] || 'bolt', { size: 13 })),
        h('span.feed-text', describe(e), e.type === 'solve' && e.problem?.difficulty ? h(`i.dot.${e.problem.difficulty.toLowerCase()}`, { title: e.problem.difficulty }) : null),
        h('time.feed-time', { datetime: new Date(e.createdAt).toISOString() }, formatTimeAgo(e.createdAt)),
      ))),
  );
}

