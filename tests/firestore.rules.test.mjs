/**
 * Security rules tests - run against the Firestore emulator:
 *   npm run test:emulator
 */
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const CODE = 'ABC234';
let env;

const now = () => Date.now();
const challenge = (over = {}) => ({
  key: 'trees', id: `trees_${now()}`, title: 'Solve 5 Tree problems', target: 5, rewardXp: 150,
  category: 'Trees', roadmapCategory: 'Trees', startedAt: now(), ...over,
});
const squadDoc = (ownerUid, over = {}) => ({
  schema: 2, code: CODE, ownerUid, ownerName: ownerUid, createdAt: now(), lastActive: now(),
  challenge: challenge(), completedChallenges: 0, squadXp: 0, bannedUids: [], ...over,
});
const memberDoc = (uid, over = {}) => ({
  uid, name: uid, streak: 1, todaySolved: 0, todayDate: '2026-10-11', totalSolved: 3, xp: 40,
  joinedAt: now(), lastActive: now(), ...over,
});
const eventDoc = (actorUid, over = {}) => ({
  type: 'solve', actorUid, actorName: actorUid, createdAt: now(),
  expireAt: Timestamp.fromMillis(now() + 86400000),
  problem: { id: '1', title: 'Two Sum', slug: 'two-sum', difficulty: 'Easy' }, ...over,
});
const duelDoc = (over = {}) => ({
  squadCode: CODE, challengerUid: 'alice', challengerName: 'alice', opponentUid: 'bob', opponentName: 'bob',
  format: 'random_blind75', difficulty: 'Medium', category: 'Trees', status: 'pending', createdAt: now(),
  acceptedAt: null, finishedAt: null, winnerUid: null, winnerName: null, runtime: null,
  expireAt: Timestamp.fromMillis(now() + 86400000), ...over,
});
const problem = { id: '104', title: 'Maximum Depth of Binary Tree', slug: 'maximum-depth-of-binary-tree', difficulty: 'Easy', category: 'Trees' };

const db = uid => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());

async function seed(fn) {
  await env.withSecurityRulesDisabled(async ctx => fn(ctx.firestore()));
}

async function seedSquad({ members = ['alice', 'bob'], owner = 'alice', squad = {} } = {}) {
  await seed(async fs => {
    await setDoc(doc(fs, 'squads', CODE), squadDoc(owner, squad));
    for (const m of members) await setDoc(doc(fs, 'squads', CODE, 'members', m), memberDoc(m));
  });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-leetx',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => env.clearFirestore());

describe('squads', () => {
  it('requires sign-in to read and forbids listing', async () => {
    await seedSquad();
    await assertFails(getDoc(doc(db(null), 'squads', CODE)));
    await assertSucceeds(getDoc(doc(db('mallory'), 'squads', CODE)));
    await assertFails(getDocs(collection(db('mallory'), 'squads')));
  });

  it('lets a user create a squad only as its owner', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), 'squads', CODE), squadDoc('alice')));
    await env.clearFirestore();
    await assertFails(setDoc(doc(db('mallory'), 'squads', CODE), squadDoc('alice')));
    await assertFails(setDoc(doc(db('alice'), 'squads', 'bad code'), squadDoc('alice', { code: 'bad code' })));
    await assertFails(setDoc(doc(db('alice'), 'squads', CODE), squadDoc('alice', { squadXp: 9999 })));
  });

  it('blocks takeover of an owned squad', async () => {
    await seedSquad();
    await assertFails(updateDoc(doc(db('bob'), 'squads', CODE), { ownerUid: 'bob' }));
    await assertFails(setDoc(doc(db('mallory'), 'squads', CODE), squadDoc('mallory')));
    await assertFails(updateDoc(doc(db('bob'), 'squads', CODE), { bannedUids: ['alice'] }));
  });

  it('allows migrating a legacy v1 squad exactly once', async () => {
    await seed(fs => setDoc(doc(fs, 'squads', CODE), { members: [], activityFeed: [], code: '#ABC234' }));
    await assertFails(setDoc(doc(db('bob'), 'squads', CODE), { members: [{ username: 'x' }] }));
    await assertSucceeds(setDoc(doc(db('bob'), 'squads', CODE), squadDoc('bob')));
    await assertFails(setDoc(doc(db('mallory'), 'squads', CODE), squadDoc('mallory')));
  });

  it('lets the owner transfer ownership only to a member', async () => {
    await seedSquad();
    await assertFails(updateDoc(doc(db('alice'), 'squads', CODE), { ownerUid: 'mallory', ownerName: 'mallory' }));
    await assertSucceeds(updateDoc(doc(db('alice'), 'squads', CODE), { ownerUid: 'bob', ownerName: 'bob' }));
  });

  it('lets members rotate a challenge only with one completion and the right reward', async () => {
    await seedSquad();
    const ref = doc(db('bob'), 'squads', CODE);
    await assertFails(updateDoc(ref, { challenge: challenge({ id: 'x_1' }) }));
    await assertFails(updateDoc(ref, { challenge: challenge({ id: 'x_2' }), completedChallenges: 1, squadXp: 5000 }));
    await assertSucceeds(updateDoc(ref, { challenge: challenge({ id: 'x_3' }), completedChallenges: 1, squadXp: 150, lastActive: now() }));
    await assertFails(updateDoc(doc(db('mallory'), 'squads', CODE), { lastActive: now() }));
  });
});

describe('members', () => {
  it('only lets users create their own membership', async () => {
    await seedSquad({ members: ['alice'] });
    await assertSucceeds(setDoc(doc(db('bob'), 'squads', CODE, 'members', 'bob'), memberDoc('bob')));
    await assertFails(setDoc(doc(db('bob'), 'squads', CODE, 'members', 'carol'), memberDoc('carol')));
  });

  it('keeps banned users out', async () => {
    await seedSquad({ members: ['alice'], squad: { bannedUids: ['mallory'] } });
    await assertFails(setDoc(doc(db('mallory'), 'squads', CODE, 'members', 'mallory'), memberDoc('mallory')));
  });

  it('hides the roster from non-members', async () => {
    await seedSquad();
    await assertSucceeds(getDocs(collection(db('bob'), 'squads', CODE, 'members')));
    await assertFails(getDocs(collection(db('mallory'), 'squads', CODE, 'members')));
  });

  it('only lets users edit their own stats', async () => {
    await seedSquad();
    await assertSucceeds(updateDoc(doc(db('bob'), 'squads', CODE, 'members', 'bob'), { streak: 9 }));
    await assertFails(updateDoc(doc(db('bob'), 'squads', CODE, 'members', 'alice'), { streak: 0 }));
    await assertFails(updateDoc(doc(db('bob'), 'squads', CODE, 'members', 'bob'), { isAdmin: true }));
  });

  it('enforces kicks server-side', async () => {
    await seedSquad({ members: ['alice', 'bob', 'carol'] });
    await assertFails(deleteDoc(doc(db('bob'), 'squads', CODE, 'members', 'carol')));
    await assertSucceeds(deleteDoc(doc(db('alice'), 'squads', CODE, 'members', 'carol')));
    await assertSucceeds(deleteDoc(doc(db('bob'), 'squads', CODE, 'members', 'bob')));
  });
});

describe('events', () => {
  it('accepts well-formed events from members only', async () => {
    await seedSquad();
    const events = uid => collection(db(uid), 'squads', CODE, 'events');
    await assertSucceeds(setDoc(doc(events('bob'), 'e1'), eventDoc('bob')));
    await assertFails(setDoc(doc(events('mallory'), 'e2'), eventDoc('mallory')));
  });

  it('rejects forged actors, stale timestamps and markup-sized payloads', async () => {
    await seedSquad();
    const ref = id => doc(db('bob'), 'squads', CODE, 'events', id);
    await assertFails(setDoc(ref('a'), eventDoc('alice')));
    await assertFails(setDoc(ref('b'), eventDoc('bob', { createdAt: now() - 3600_000 })));
    await assertFails(setDoc(ref('c'), eventDoc('bob', { text: '<img src=x onerror=alert(1)>' })));
    await assertFails(setDoc(ref('d'), eventDoc('bob', { actorName: 'x'.repeat(200) })));
    await assertFails(setDoc(ref('e'), eventDoc('bob', { type: 'kick', targetUid: 'alice', targetName: 'alice' })));
  });

  it('is append-only and hidden from outsiders', async () => {
    await seedSquad();
    await seed(fs => setDoc(doc(fs, 'squads', CODE, 'events', 'e1'), eventDoc('alice')));
    await assertFails(updateDoc(doc(db('bob'), 'squads', CODE, 'events', 'e1'), { streak: 99 }));
    await assertFails(deleteDoc(doc(db('bob'), 'squads', CODE, 'events', 'e1')));
    await assertFails(getDocs(collection(db('mallory'), 'squads', CODE, 'events')));
  });
});

describe('duels', () => {
  async function createDuel(fs = db('alice'), over = {}) {
    const batch = writeBatch(fs);
    batch.set(doc(fs, 'duels', 'd1'), duelDoc(over));
    batch.set(doc(fs, 'duels', 'd1', 'secret', 'problem'), problem);
    return batch.commit();
  }

  it('creates duels only between squad members, as yourself', async () => {
    await seedSquad();
    await assertSucceeds(createDuel());
    await env.clearFirestore();
    await seedSquad();
    await assertFails(createDuel(db('bob')));
    await assertFails(createDuel(db('alice'), { opponentUid: 'mallory', opponentName: 'mallory' }));
    await assertFails(createDuel(db('alice'), { status: 'completed', winnerUid: 'alice' }));
  });

  it('hides the problem from the opponent until they accept', async () => {
    await seedSquad();
    await createDuel();
    await assertSucceeds(getDoc(doc(db('alice'), 'duels', 'd1', 'secret', 'problem')));
    await assertFails(getDoc(doc(db('bob'), 'duels', 'd1', 'secret', 'problem')));
    await assertFails(getDoc(doc(db('mallory'), 'duels', 'd1')));
    await assertSucceeds(updateDoc(doc(db('bob'), 'duels', 'd1'), { status: 'active', acceptedAt: now() }));
    await assertSucceeds(getDoc(doc(db('bob'), 'duels', 'd1', 'secret', 'problem')));
  });

  it('enforces the duel state machine', async () => {
    await seedSquad();
    await createDuel();
    const ref = uid => doc(db(uid), 'duels', 'd1');
    await assertFails(updateDoc(ref('alice'), { status: 'active', acceptedAt: now() }));
    await assertFails(updateDoc(ref('bob'), { status: 'completed', winnerUid: 'bob', winnerName: 'bob', finishedAt: now() }));
    await assertSucceeds(updateDoc(ref('bob'), { status: 'active', acceptedAt: now() }));
    await assertFails(updateDoc(ref('mallory'), { status: 'completed', winnerUid: 'mallory', winnerName: 'm', finishedAt: now() }));
    await assertFails(updateDoc(ref('bob'), { status: 'completed', winnerUid: 'alice', winnerName: 'alice', finishedAt: now() }));
    await assertFails(updateDoc(ref('bob'), { status: 'forfeited', winnerUid: 'bob', winnerName: 'bob', finishedAt: now() }));
    await assertSucceeds(updateDoc(ref('bob'), { status: 'completed', winnerUid: 'bob', winnerName: 'bob', finishedAt: now(), runtime: '3 ms' }));
    await assertFails(updateDoc(ref('alice'), { status: 'completed', winnerUid: 'alice', winnerName: 'alice', finishedAt: now() }));
  });

  it('lets players query their own duels only', async () => {
    await seedSquad();
    await createDuel();
    await assertSucceeds(getDocs(query(collection(db('bob'), 'duels'), where('opponentUid', '==', 'bob'), where('status', 'in', ['pending', 'active']))));
    await assertFails(getDocs(query(collection(db('mallory'), 'duels'), where('status', '==', 'pending'))));
  });
});
