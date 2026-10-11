/**
 * End-to-end multiplayer suite: drives the real scripts/firebase.js client as
 * several users against the Firestore emulator with the production rules.
 *
 *   npm run test:emulator   (starts the emulator via firebase-tools)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node tests/e2e_full_suite.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
if (!EMU) {
  console.log('SKIP e2e: FIRESTORE_EMULATOR_HOST is not set (run `npm run test:emulator`).');
  process.exit(0);
}
const EMU_URL = `http://${EMU}`;
const PROJECT = 'leetsync-squads-app';

// ---------------------------------------------------------------------------
// Environment: per-user chrome.storage + network routing
// ---------------------------------------------------------------------------

const stores = new Map();
let currentUser = null;

function storageFor(uid) {
  if (!stores.has(uid)) stores.set(uid, {});
  return stores.get(uid);
}

globalThis.chrome = {
  runtime: { getURL: p => `chrome-extension://test/${p}`, id: 'test' },
  storage: {
    local: {
      async get(keys) {
        const data = storageFor(currentUser);
        if (keys == null) return { ...data };
        const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
        return Object.fromEntries(list.filter(k => k in data).map(k => [k, data[k]]));
      },
      async set(items) { Object.assign(storageFor(currentUser), structuredClone(items)); },
      async remove(keys) { for (const k of [].concat(keys)) delete storageFor(currentUser)[k]; },
    },
  },
};

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(uid) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, user_id: uid, iat: now, exp: now + 3600, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, firebase: { sign_in_provider: 'anonymous' } })}.`;
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://identitytoolkit.googleapis.com/')) {
    return new Response(JSON.stringify({ localId: currentUser, idToken: token(currentUser), refreshToken: `r_${currentUser}`, expiresIn: '3600' }));
  }
  if (u.startsWith('https://firestore.googleapis.com/')) return realFetch(u.replace('https://firestore.googleapis.com', EMU_URL), opts);
  throw new Error(`Unexpected network call in test: ${u}`);
};

function as(uid) { currentUser = uid; }

async function admin(method, path, body) {
  const res = await realFetch(`${EMU_URL}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
    method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  });
  return res.ok ? res.json() : null;
}

const { Squads, Duels, Firestore, SquadError } = await import('../scripts/firebase.js');
const { solveMatchesChallenge } = await import('../scripts/core.js');
const { recordDuelOutcome, duelRecord } = await import('../scripts/state.js');

const profile = (name, extra = {}) => ({ name, streak: 3, todaySolved: 1, todayDate: '2026-10-11', totalSolved: 10, xp: 100, ...extra });
const anyChallenge = target => ({ key: 'any', id: `any_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, title: 'Log solves', target, rewardXp: 100, category: 'Any', startedAt: Date.now() });
const setChallenge = (code, ch) => admin('PATCH', `squads/${code}?updateMask.fieldPaths=challenge`, {
  fields: { challenge: { mapValue: { fields: Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v }])) } } },
});
const matchesAll = (c, p) => solveMatchesChallenge(c, p, {});
const problem = { id: '1', title: 'Two Sum', slug: 'two-sum', difficulty: 'Easy', topicTags: ['array'] };

before(async () => {
  const content = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const res = await realFetch(`${EMU_URL}/emulator/v1/projects/${PROJECT}:securityRules`, { method: 'PUT', body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }) });
  assert.ok(res.ok, 'rules loaded');
  await realFetch(`${EMU_URL}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
});
after(() => { globalThis.fetch = realFetch; });

// ---------------------------------------------------------------------------

let code;

describe('squad lifecycle', () => {
  it('creates a squad owned by the creator', async () => {
    as('alice');
    code = await Squads.createSquad(profile('alice'));
    assert.match(code, /^[2-9A-HJ-NP-Z]{6}$/);
    const snap = await Squads.getSnapshot(code);
    assert.equal(snap.status, 'ok');
    assert.equal(snap.isOwner, true);
    assert.equal(snap.members.length, 1);
    assert.equal((await chrome.storage.local.get('my_squad_code')).my_squad_code, code);
  });

  it('lets friends join with a messy code and announces it', async () => {
    as('bob');
    await Squads.joinSquad(`#${code.toLowerCase()}`, profile('bob'));
    as('carol');
    await Squads.joinSquad(code, profile('carol'));
    const snap = await Squads.getSnapshot(code);
    assert.equal(snap.members.length, 3);
    assert.equal(snap.isOwner, false);
    assert.deepEqual(snap.events.filter(e => e.type === 'join').map(e => e.actorName).sort(), ['bob', 'carol']);
  });

  it('rejects unknown codes instead of joining a shared default room', async () => {
    as('dave');
    await assert.rejects(() => Squads.joinSquad('ZZZZZZ', profile('dave')), e => e instanceof SquadError && e.code === 'not_found');
    await assert.rejects(() => Squads.joinSquad('', profile('dave')), e => e.code === 'invalid_code');
  });

  it('keeps the roster and feed private to members', async () => {
    as('mallory');
    await assert.rejects(() => Squads.listMembers(code), e => e.isPermissionDenied);
    await assert.rejects(() => Squads.listEvents(code), e => e.isPermissionDenied);
    const snap = await Squads.getSnapshot(code);
    assert.equal(snap.status, 'not_member');
  });

  it('stops identity forgery and markup injection at the server', async () => {
    as('bob');
    await assert.rejects(() => Firestore.create(`squads/${code}/events`, 'forged', {
      type: 'solve', actorUid: 'alice', actorName: 'alice', createdAt: Date.now(), expireAt: new Date(Date.now() + 1e7),
    }), e => e.isPermissionDenied);
    await assert.rejects(() => Firestore.create(`squads/${code}/events`, 'xss', {
      type: 'solve', actorUid: 'bob', actorName: 'bob', text: '<img src=x onerror=alert(1)>', createdAt: Date.now(), expireAt: new Date(Date.now() + 1e7),
    }), e => e.isPermissionDenied);
    await assert.rejects(() => Firestore.update(`squads/${code}`, { ownerUid: 'bob' }), e => e.isPermissionDenied);
  });

  it('enforces leader-only kicks', async () => {
    as('bob');
    await assert.rejects(() => Squads.kickMember(code, { uid: 'carol', name: 'carol' }, profile('bob')), e => e.isPermissionDenied);
    as('carol');
    assert.equal((await Squads.getSnapshot(code)).status, 'ok');
  });
});

describe('squad challenge', () => {
  it('counts matching solves and rotates exactly once on completion', async () => {
    await setChallenge(code, anyChallenge(2));
    as('bob');
    const first = await Squads.recordSolve(code, profile('bob'), problem, { matchesChallenge: matchesAll });
    assert.equal(first.countedForChallenge, true);
    assert.equal(first.completedChallenge, null);

    as('carol');
    const second = await Squads.recordSolve(code, profile('carol'), problem, { matchesChallenge: matchesAll });
    assert.ok(second.completedChallenge);
    const snap = await Squads.getSnapshot(code);
    assert.equal(snap.squad.completedChallenges, 1);
    assert.equal(snap.squad.squadXp, 100);
    assert.notEqual(snap.squad.challenge.id, second.completedChallenge.id);
    assert.ok(snap.events.some(e => e.type === 'challenge_complete'));
  });

  it('survives two members finishing at the same moment', async () => {
    await setChallenge(code, anyChallenge(2));
    const before = (await admin('GET', `squads/${code}`)).fields.completedChallenges.integerValue;
    // Both solves are posted before either checks progress.
    as('bob');
    const p1 = Squads.recordSolve(code, profile('bob'), problem, { matchesChallenge: matchesAll });
    as('alice');
    const p2 = Squads.recordSolve(code, profile('alice'), problem, { matchesChallenge: matchesAll });
    const results = await Promise.allSettled([p1, p2]);
    assert.ok(results.every(r => r.status === 'fulfilled'), JSON.stringify(results));
    const afterCount = (await admin('GET', `squads/${code}`)).fields.completedChallenges.integerValue;
    assert.equal(Number(afterCount) - Number(before), 1);
  });

  it('lets only the owner reroll', async () => {
    as('carol');
    await assert.rejects(() => Squads.rerollChallenge(code, profile('carol')), e => e.isPermissionDenied);
    as('alice');
    const next = await Squads.rerollChallenge(code, profile('alice'));
    assert.ok(next.id);
  });
});

describe('duels', () => {
  let duel;

  it('creates a duel with the problem hidden from the opponent', async () => {
    as('alice');
    duel = await Duels.create({ code, opponent: { uid: 'bob', name: 'bob' }, format: 'random_blind75', problem: { id: '200', title: 'Number of Islands', slug: 'number-of-islands', difficulty: 'Medium', category: 'Graphs' }, profile: profile('alice') });
    assert.equal((await Duels.getProblem(duel.id)).slug, 'number-of-islands');

    as('bob');
    await assert.rejects(() => Duels.getProblem(duel.id), e => e.isPermissionDenied);
    const mine = await Duels.listMine();
    assert.equal(mine.incoming.length, 1);
    assert.equal(mine.incoming[0].difficulty, 'Medium');

    as('mallory');
    await assert.rejects(() => Duels.get(duel.id), e => e.isPermissionDenied);
  });

  it('reveals the problem on accept, and only the first finisher wins', async () => {
    as('bob');
    const revealed = await Duels.accept(duel, profile('bob'));
    assert.equal(revealed.slug, 'number-of-islands');

    as('alice');
    const active = (await Duels.listMine()).active;
    assert.equal(active.id, duel.id);
    assert.equal(await Duels.claimWin(active, profile('alice'), '12 ms'), true);

    as('bob');
    assert.equal(await Duels.claimWin(active, profile('bob'), '3 ms'), false);
    const final = await Duels.get(duel.id);
    assert.equal(final.winnerUid, 'alice');
    assert.equal(final.runtime, '12 ms');

    const outcome = await recordDuelOutcome({ ...final, problemTitle: revealed.title }, 'bob');
    assert.equal(outcome.won, false);
    await recordDuelOutcome({ ...final }, 'bob');
    assert.equal(duelRecord((await chrome.storage.local.get('duel_history')).duel_history).played, 1, 'recorded once');
  });

  it('cannot challenge someone outside the squad', async () => {
    as('alice');
    await assert.rejects(() => Duels.create({ code, opponent: { uid: 'mallory', name: 'mallory' }, format: 'daily', problem, profile: profile('alice') }), e => e.isPermissionDenied);
  });

  it('forfeit hands the win to the other player', async () => {
    as('carol');
    const d = await Duels.create({ code, opponent: { uid: 'bob', name: 'bob' }, format: 'random_easy', problem, profile: profile('carol') });
    as('bob');
    await Duels.accept(d, profile('bob'));
    await Duels.forfeit({ ...d, status: 'active' }, profile('bob'));
    as('carol');
    const final = await Duels.get(d.id);
    assert.equal(final.status, 'forfeited');
    assert.equal(final.winnerUid, 'carol');
  });
});

describe('membership changes', () => {
  it('transfers leadership when the owner leaves', async () => {
    as('alice');
    await Squads.leaveSquad(code, profile('alice'));
    assert.equal((await chrome.storage.local.get('my_squad_code')).my_squad_code, undefined);
    as('bob');
    const snap = await Squads.getSnapshot(code);
    assert.ok(['bob', 'carol'].includes(snap.squad.ownerUid));
    assert.equal(snap.members.length, 2);
  });

  it('kicked members are banned from rejoining', async () => {
    as('bob');
    let snap = await Squads.getSnapshot(code);
    const owner = snap.squad.ownerUid;
    const target = owner === 'bob' ? 'carol' : 'bob';
    as(owner);
    await Squads.kickMember(code, { uid: target, name: target }, profile(owner));
    as(target);
    snap = await Squads.getSnapshot(code);
    assert.equal(snap.status, 'banned');
    await assert.rejects(() => Squads.joinSquad(code, profile(target)), e => e.code === 'banned');

    as(target);
    await assert.rejects(() => Squads.clearBans(code), e => e.isPermissionDenied);
    as(owner);
    await Squads.clearBans(code);
    as(target);
    await Squads.joinSquad(code, profile(target));
    assert.equal((await Squads.getSnapshot(code)).status, 'ok');
  });

  it('migrates a v1 squad document on first join', async () => {
    await admin('PATCH', 'squads/LEGACY1', { fields: { members: { arrayValue: { values: [] } }, code: { stringValue: '#LEGACY1' } } });
    as('dave');
    await Squads.joinSquad('legacy1', profile('dave'));
    const snap = await Squads.getSnapshot('LEGACY1');
    assert.equal(snap.status, 'ok');
    assert.equal(snap.squad.ownerUid, 'dave');
    assert.equal(snap.squad.schema, 2);
    as('erin');
    await Squads.joinSquad('LEGACY1', profile('erin'));
    assert.equal((await Squads.getSnapshot('LEGACY1')).squad.ownerUid, 'dave', 'second visitor cannot re-claim');
  });

  it('returns only events newer than the cursor', async () => {
    as('dave');
    const t = Date.now();
    await new Promise(r => setTimeout(r, 5));
    await Squads.sendNudge('LEGACY1', { uid: 'erin', name: 'erin' }, profile('dave'));
    const fresh = await Squads.listEvents('LEGACY1', { since: t });
    assert.deepEqual(fresh.map(e => e.type), ['nudge']);
  });

  it('refreshes incrementally and still notices changes and removals', async () => {
    as('dave');
    const full = await Squads.getSnapshot('LEGACY1');
    assert.equal(full.status, 'ok');

    // Nothing changed: same data back.
    const same = await Squads.getSnapshot('LEGACY1', { previous: full });
    assert.equal(same.events.length, full.events.length);
    assert.equal(same.membersFetchedAt, full.membersFetchedAt, 'members not re-read');

    // A new solve shows up, and the roster is re-read because stats changed.
    as('erin');
    await Squads.recordSolve('LEGACY1', profile('erin', { streak: 9 }), problem, { matchesChallenge: () => false });
    as('dave');
    const next = await Squads.getSnapshot('LEGACY1', { previous: same });
    assert.equal(next.events[0].type, 'solve');
    assert.equal(next.events.length, same.events.length + 1);
    assert.equal(next.members.find(m => m.uid === 'erin').streak, 9);

    // Removed members fall back to the full check and learn they are out.
    as('dave');
    await Squads.kickMember('LEGACY1', { uid: 'erin', name: 'erin' }, profile('dave'));
    as('erin');
    const kicked = await Squads.getSnapshot('LEGACY1', { previous: next });
    assert.equal(kicked.status, 'banned');
  });
});
