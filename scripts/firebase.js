/**
 * LeetX Squads - Firebase client (Auth + Cloud Firestore over REST).
 *
 * Identity: every install signs in with Firebase Anonymous Auth. The uid is the
 * only identity the security rules trust; display names are cosmetic.
 *
 * Data model (see firestore.rules for the enforced contract):
 *   squads/{code}                     squad metadata + current challenge
 *   squads/{code}/members/{uid}       one doc per member, written only by that member
 *   squads/{code}/events/{id}         append-only activity feed
 *   duels/{id}                        duel state machine, readable by its two players
 *   duels/{id}/secret/problem         duel problem, hidden from the opponent until accepted
 */

import {
  MAX_SQUAD_MEMBERS,
  createChallenge,
  generateSquadCode,
  normalizeSquadCode,
  sanitizeName,
  toDateKey,
} from './core.js';

export const FIREBASE_PROJECT_ID = 'leetsync-squads-app';
// Firebase Web API keys identify the project; they are not secrets. Access is
// enforced by firestore.rules. Restrict this key to the Firestore and Identity
// Toolkit APIs in Google Cloud Console.
export const FIREBASE_API_KEY = 'AIzaSyAzWSsFeCpnY5v1fRwPRzgEZg3k8LOMNU4';

const DOCS_ROOT = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const FIRESTORE_API = `https://firestore.googleapis.com/v1/${DOCS_ROOT}`;
const SESSION_KEY = 'fb_session';
const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DUEL_TTL_MS = 60 * 24 * 60 * 60 * 1000;
export const DUEL_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export class FirebaseError extends Error {
  constructor(httpStatus, code, message) {
    super(message || code || `HTTP ${httpStatus}`);
    this.name = 'FirebaseError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
  get isPermissionDenied() { return this.code === 'PERMISSION_DENIED' || this.httpStatus === 403; }
  get isNotFound() { return this.code === 'NOT_FOUND' || this.httpStatus === 404; }
  get isConflict() {
    return this.code === 'ALREADY_EXISTS' || this.code === 'FAILED_PRECONDITION' || this.code === 'ABORTED' || this.httpStatus === 409;
  }
}

export class SquadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SquadError';
    this.code = code;
  }
}

// ===========================================================================
// Auth
// ===========================================================================

let sessionPromise = null;

async function parseAuthError(res) {
  let code = `HTTP_${res.status}`;
  try {
    const body = await res.json();
    code = body?.error?.message || code;
  } catch { /* non-JSON body */ }
  return new FirebaseError(res.status, code, `Authentication failed (${code})`);
}

async function signUpAnonymously() {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!res.ok) throw await parseAuthError(res);
  const body = await res.json();
  return {
    uid: body.localId,
    idToken: body.idToken,
    refreshToken: body.refreshToken,
    expiresAt: Date.now() + Number(body.expiresIn || 3600) * 1000,
  };
}

async function refreshSession(session) {
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken }).toString(),
  });
  if (!res.ok) throw await parseAuthError(res);
  const body = await res.json();
  return {
    uid: body.user_id || session.uid,
    idToken: body.id_token,
    refreshToken: body.refresh_token || session.refreshToken,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
  };
}

const PERMANENT_REFRESH_ERRORS = ['TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN', 'INVALID_GRANT_TYPE'];

export const Auth = {
  async getSession({ forceRefresh = false } = {}) {
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async () => {
      const stored = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY];
      if (stored?.idToken && !forceRefresh && stored.expiresAt - 60_000 > Date.now()) return stored;

      if (stored?.refreshToken) {
        try {
          const next = await refreshSession(stored);
          await chrome.storage.local.set({ [SESSION_KEY]: next });
          return next;
        } catch (err) {
          if (!PERMANENT_REFRESH_ERRORS.some(c => String(err.code || '').includes(c))) throw err;
        }
      }

      const fresh = await signUpAnonymously();
      // Another extension context (popup vs worker) may have signed up at the same time; keep the first.
      const raced = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY];
      if (raced?.uid && raced.uid !== stored?.uid && raced.expiresAt > Date.now()) return raced;
      await chrome.storage.local.set({ [SESSION_KEY]: fresh });
      return fresh;
    })().finally(() => { sessionPromise = null; });
    return sessionPromise;
  },

  async getUid() {
    return (await this.getSession()).uid;
  },
};

// ===========================================================================
// Firestore REST
// ===========================================================================

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') return { mapValue: { fields: encodeFields(value) } };
  return { stringValue: String(value) };
}

function encodeFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = encodeValue(v);
  }
  return fields;
}

function decodeValue(field) {
  if (!field || typeof field !== 'object') return null;
  if ('nullValue' in field) return null;
  if ('booleanValue' in field) return field.booleanValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return Number(field.doubleValue);
  if ('stringValue' in field) return field.stringValue;
  if ('timestampValue' in field) return field.timestampValue;
  if ('arrayValue' in field) return (field.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in field) return decodeFields(field.mapValue.fields || {});
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}

function decodeDoc(doc) {
  if (!doc?.name) return null;
  return {
    id: doc.name.split('/').pop(),
    name: doc.name,
    updateTime: doc.updateTime,
    data: decodeFields(doc.fields),
  };
}

function docUrl(path) {
  return `${FIRESTORE_API}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

async function firestoreFetch(method, url, body, attempt = 0) {
  const session = await Auth.getSession({ forceRefresh: attempt > 0 });
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.idToken}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && attempt === 0) return firestoreFetch(method, url, body, 1);
  if ((res.status === 429 || res.status === 503) && attempt < 2) {
    await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
    return firestoreFetch(method, url, body, attempt + 1);
  }
  if (!res.ok) {
    let code = '';
    let message = '';
    try {
      const err = (await res.json())?.error || {};
      code = err.status || '';
      message = err.message || '';
    } catch { /* ignore */ }
    throw new FirebaseError(res.status, code, message || `Firestore ${method} failed (${res.status})`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function buildFilter([field, op, value]) {
  const opMap = { '==': 'EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', in: 'IN' };
  const encoded = op === 'in' ? { arrayValue: { values: value.map(encodeValue) } } : encodeValue(value);
  return { fieldFilter: { field: { fieldPath: field }, op: opMap[op], value: encoded } };
}

export const Firestore = {
  async get(path) {
    try {
      return decodeDoc(await firestoreFetch('GET', docUrl(path)));
    } catch (err) {
      if (err instanceof FirebaseError && err.isNotFound) return null;
      throw err;
    }
  },

  /** Create a document with a fixed id; throws a conflict error if it already exists. */
  async create(collectionPath, id, data) {
    const url = `${docUrl(collectionPath)}?documentId=${encodeURIComponent(id)}`;
    return decodeDoc(await firestoreFetch('POST', url, { fields: encodeFields(data) }));
  },

  /**
   * Replace the whole document. With `updateTime`, the write only succeeds if
   * nobody changed the document since it was read (optimistic concurrency).
   */
  async set(path, data, { updateTime } = {}) {
    if (updateTime) {
      await this.commit([{ update: { path, data }, updateTime }]);
      return this.get(path);
    }
    return decodeDoc(await firestoreFetch('PATCH', docUrl(path), { fields: encodeFields(data) }));
  },

  /** Merge only the given top-level fields into an existing document. */
  async update(path, data, { updateTime } = {}) {
    if (updateTime) {
      await this.commit([{ update: { path, data }, mask: Object.keys(data), updateTime }]);
      return this.get(path);
    }
    const params = new URLSearchParams();
    for (const key of Object.keys(data)) params.append('updateMask.fieldPaths', key);
    params.append('currentDocument.exists', 'true');
    return decodeDoc(await firestoreFetch('PATCH', `${docUrl(path)}?${params}`, { fields: encodeFields(data) }));
  },

  async delete(path) {
    await firestoreFetch('DELETE', docUrl(path));
  },

  /**
   * @param parentPath '' for root collections, or a document path like 'squads/ABC123'
   * @param where array of [field, op, value]
   * @param orderBy [field, 'asc'|'desc']
   */
  async query(parentPath, collectionId, { where = [], orderBy = null, limit = 50 } = {}) {
    const structuredQuery = { from: [{ collectionId }], limit };
    if (where.length === 1) structuredQuery.where = buildFilter(where[0]);
    if (where.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters: where.map(buildFilter) } };
    if (orderBy) {
      structuredQuery.orderBy = [{ field: { fieldPath: orderBy[0] }, direction: orderBy[1] === 'desc' ? 'DESCENDING' : 'ASCENDING' }];
    }
    const url = parentPath ? `${docUrl(parentPath)}:runQuery` : `${FIRESTORE_API}:runQuery`;
    const rows = await firestoreFetch('POST', url, { structuredQuery });
    return (rows || []).filter(r => r.document).map(r => decodeDoc(r.document));
  },

  /** Atomic multi-document write. Each write: { create|update: { path, data }, mask?: string[], updateTime?: string } */
  async commit(writes) {
    const body = {
      writes: writes.map(w => {
        if (w.create) {
          return {
            update: { name: `${DOCS_ROOT}/${w.create.path}`, fields: encodeFields(w.create.data) },
            currentDocument: { exists: false },
          };
        }
        const out = { update: { name: `${DOCS_ROOT}/${w.update.path}`, fields: encodeFields(w.update.data) } };
        if (w.mask) out.updateMask = { fieldPaths: w.mask };
        out.currentDocument = w.updateTime ? { updateTime: w.updateTime } : { exists: true };
        return out;
      }),
    };
    return firestoreFetch('POST', `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`, body);
  },
};

// ===========================================================================
// Squads
// ===========================================================================

function randomId(prefix = '') {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const rand = Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

function memberDoc(uid, profile, existing = null) {
  const today = toDateKey();
  return {
    uid,
    name: sanitizeName(profile.name),
    streak: Math.max(0, Math.floor(profile.streak || 0)),
    todaySolved: Math.max(0, Math.floor(profile.todaySolved || 0)),
    todayDate: profile.todayDate || today,
    totalSolved: Math.max(0, Math.floor(profile.totalSolved || 0)),
    xp: Math.max(0, Math.floor(profile.xp || 0)),
    joinedAt: existing?.joinedAt || Date.now(),
    lastActive: Date.now(),
  };
}

function newSquadDoc(code, uid, ownerName) {
  return {
    schema: 2,
    code,
    ownerUid: uid,
    ownerName: sanitizeName(ownerName),
    createdAt: Date.now(),
    lastActive: Date.now(),
    challenge: createChallenge(),
    completedChallenges: 0,
    squadXp: 0,
    bannedUids: [],
  };
}

export const Squads = {
  normalizeCode: normalizeSquadCode,

  async getSquad(code) {
    const clean = normalizeSquadCode(code);
    if (!clean) return null;
    return Firestore.get(`squads/${clean}`);
  },

  async listMembers(code) {
    const docs = await Firestore.query(`squads/${code}`, 'members', { limit: 50 });
    return docs.map(d => d.data);
  },

  async listEvents(code, { since = 0, limit = 30 } = {}) {
    const where = since ? [['createdAt', '>', since]] : [];
    const docs = await Firestore.query(`squads/${code}`, 'events', { where, orderBy: ['createdAt', 'desc'], limit });
    return docs.map(d => ({ id: d.id, ...d.data }));
  },

  async postEvent(code, event) {
    const uid = await Auth.getUid();
    const now = Date.now();
    const data = {
      ...event,
      actorUid: uid,
      actorName: sanitizeName(event.actorName),
      createdAt: now,
      expireAt: new Date(now + EVENT_TTL_MS),
    };
    for (const k of Object.keys(data)) if (data[k] === undefined || data[k] === null) delete data[k];
    const id = randomId('e');
    await Firestore.create(`squads/${code}/events`, id, data);
    return { id, ...data };
  },

  /** Create a brand-new squad owned by the current user and join it. */
  async createSquad(profile) {
    const uid = await Auth.getUid();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateSquadCode(6);
      try {
        await Firestore.create('squads', code, newSquadDoc(code, uid, profile.name));
      } catch (err) {
        if (err instanceof FirebaseError && err.isConflict) continue;
        throw err;
      }
      await this.joinSquad(code, profile, { announce: false });
      return code;
    }
    throw new SquadError('code_collision', 'Could not allocate a squad code. Try again.');
  },

  /**
   * Join (or re-join) a squad. Squads created by v1.x (no ownerUid) are migrated
   * in place: the first v2 member to arrive becomes the owner.
   */
  async joinSquad(rawCode, profile, { announce = true } = {}) {
    const code = normalizeSquadCode(rawCode);
    if (!code) throw new SquadError('invalid_code', 'Squad codes are 4–12 letters or digits.');
    const uid = await Auth.getUid();

    let squad = await Firestore.get(`squads/${code}`);
    if (!squad) throw new SquadError('not_found', `No squad found for ${code}.`);

    if (!squad.data.ownerUid) {
      squad = await Firestore.set(`squads/${code}`, newSquadDoc(code, uid, profile.name), { updateTime: squad.updateTime });
    }
    if ((squad.data.bannedUids || []).includes(uid)) {
      throw new SquadError('banned', 'The squad leader removed you from this squad.');
    }

    const existing = await Firestore.get(`squads/${code}/members/${uid}`);
    if (existing) {
      await Firestore.update(`squads/${code}/members/${uid}`, {
        name: sanitizeName(profile.name),
        lastActive: Date.now(),
      });
    } else {
      const members = await this.listMembers(code).catch(() => []);
      if (members.length >= MAX_SQUAD_MEMBERS) {
        throw new SquadError('full', `This squad is full (${MAX_SQUAD_MEMBERS} members).`);
      }
      await Firestore.create(`squads/${code}/members`, uid, memberDoc(uid, profile));
      if (announce) await this.postEvent(code, { type: 'join', actorName: profile.name }).catch(() => {});
    }

    await chrome.storage.local.set({ my_squad_code: code, squad_last_seen_event: Date.now(), ever_joined_squad: true });
    return code;
  },

  /** Returns everything the squad view needs in one round of requests. */
  /**
   * Everything the squad view needs. Pass the previous snapshot to refresh
   * incrementally: only new events are read, members are re-read when the feed
   * shows a change (or once a minute), and challenge progress only when it can
   * have moved. A typical refresh costs ~2 reads instead of ~40.
   */
  async getSnapshot(code, { previous = null } = {}) {
    const uid = await Auth.getUid();
    const squad = await Firestore.get(`squads/${code}`);
    if (!squad) return { status: 'missing' };
    if (!squad.data.ownerUid) return { status: 'legacy' };
    if (previous?.status === 'ok' && previous.uid === uid && previous.squad?.code === squad.data.code) {
      try {
        const incremental = await this.refreshSnapshot(code, uid, squad, previous);
        if (incremental) return incremental;
      } catch (err) {
        // Lost access (kicked / left elsewhere): fall through to the full check below.
        if (!(err instanceof FirebaseError && err.isPermissionDenied)) throw err;
      }
    }
    const me = await Firestore.get(`squads/${code}/members/${uid}`);
    if (!me) {
      const banned = (squad.data.bannedUids || []).includes(uid);
      return { status: banned ? 'banned' : 'not_member', squad: squad.data };
    }
    const [members, events] = await Promise.all([this.listMembers(code), this.listEvents(code, { limit: 30 })]);
    let challengeProgress = 0;
    if (squad.data.challenge?.id) {
      challengeProgress = await this.countChallengeProgress(code, squad.data.challenge).catch(() => 0);
    }
    return {
      status: 'ok',
      uid,
      squad: squad.data,
      squadUpdateTime: squad.updateTime,
      members,
      events,
      challengeProgress,
      isOwner: squad.data.ownerUid === uid,
      membersFetchedAt: Date.now(),
    };
  },

  async refreshSnapshot(code, uid, squad, previous) {
    const newest = previous.events?.[0]?.createdAt || 0;
    const fresh = newest ? await this.listEvents(code, { since: newest, limit: 30 }) : await this.listEvents(code, { limit: 30 });
    const events = newest ? [...fresh, ...previous.events].slice(0, 30) : fresh;

    const rosterChanged = fresh.some(e => ['join', 'leave', 'kick', 'solve'].includes(e.type));
    const membersStale = Date.now() - (previous.membersFetchedAt || 0) > 60_000;
    const members = rosterChanged || membersStale ? await this.listMembers(code) : previous.members;
    if (!members.some(m => m.uid === uid)) return null; // let the full path decide banned vs not_member

    const challenge = squad.data.challenge;
    const challengeMoved = challenge?.id !== previous.squad?.challenge?.id || fresh.some(e => e.challengeId && e.challengeId === challenge?.id);
    const challengeProgress = challenge?.id && challengeMoved
      ? await this.countChallengeProgress(code, challenge).catch(() => previous.challengeProgress || 0)
      : previous.challengeProgress || 0;

    return {
      status: 'ok',
      uid,
      squad: squad.data,
      squadUpdateTime: squad.updateTime,
      members,
      events,
      challengeProgress,
      isOwner: squad.data.ownerUid === uid,
      membersFetchedAt: rosterChanged || membersStale ? Date.now() : previous.membersFetchedAt,
    };
  },

  async updateMyStats(code, profile) {
    const uid = await Auth.getUid();
    const path = `squads/${code}/members/${uid}`;
    const existing = await Firestore.get(path);
    if (!existing) return false;
    await Firestore.set(path, memberDoc(uid, profile, existing.data));
    return true;
  },

  async leaveSquad(code, profile) {
    const uid = await Auth.getUid();
    try {
      const squad = await Firestore.get(`squads/${code}`);
      if (squad?.data.ownerUid === uid) {
        const others = (await this.listMembers(code)).filter(m => m.uid !== uid);
        if (others.length > 0) {
          const heir = others.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0];
          await Firestore.update(`squads/${code}`, { ownerUid: heir.uid, ownerName: heir.name, lastActive: Date.now() });
        }
      }
      await this.postEvent(code, { type: 'leave', actorName: profile.name }).catch(() => {});
      await Firestore.delete(`squads/${code}/members/${uid}`);
    } finally {
      await chrome.storage.local.remove(['my_squad_code', 'squad_cache']);
    }
  },

  async kickMember(code, target, profile) {
    const snapshot = await Firestore.get(`squads/${code}`);
    const banned = Array.from(new Set([...(snapshot?.data.bannedUids || []), target.uid])).slice(-200);
    await Firestore.update(`squads/${code}`, { bannedUids: banned, lastActive: Date.now() });
    await this.postEvent(code, { type: 'kick', actorName: profile.name, targetUid: target.uid, targetName: target.name });
    await Firestore.delete(`squads/${code}/members/${target.uid}`);
  },

  async clearBans(code) {
    await Firestore.update(`squads/${code}`, { bannedUids: [], lastActive: Date.now() });
  },

  async sendNudge(code, target, profile) {
    await this.postEvent(code, { type: 'nudge', actorName: profile.name, targetUid: target.uid, targetName: target.name });
  },

  async rerollChallenge(code, profile) {
    const squad = await Firestore.get(`squads/${code}`);
    if (!squad) throw new SquadError('not_found', 'Squad not found.');
    const next = createChallenge(squad.data.challenge?.key);
    await Firestore.update(`squads/${code}`, { challenge: next, lastActive: Date.now() }, { updateTime: squad.updateTime });
    await this.postEvent(code, { type: 'challenge_reroll', actorName: profile.name, challengeTitle: next.title }).catch(() => {});
    return next;
  },

  async countChallengeProgress(code, challenge) {
    const docs = await Firestore.query(`squads/${code}`, 'events', {
      where: [['challengeId', '==', challenge.id]],
      limit: Math.max(1, challenge.target),
    });
    return docs.length;
  },

  /**
   * Broadcast an accepted solve, update this member's stats and rotate the
   * challenge when this solve completes it.
   * @returns {{ countedForChallenge: boolean, completedChallenge: object|null }}
   */
  async recordSolve(code, profile, problem, { matchesChallenge }) {
    const squad = await Firestore.get(`squads/${code}`);
    if (!squad?.data.ownerUid) return { countedForChallenge: false, completedChallenge: null };
    const challenge = squad.data.challenge;
    const counts = Boolean(challenge?.id && matchesChallenge(challenge, problem));

    await this.postEvent(code, {
      type: 'solve',
      actorName: profile.name,
      streak: profile.streak,
      problem: {
        id: String(problem.id || ''),
        title: String(problem.title || problem.slug || 'Problem').slice(0, 120),
        slug: String(problem.slug || '').slice(0, 120),
        difficulty: problem.difficulty || 'Medium',
      },
      challengeId: counts ? challenge.id : undefined,
    });
    await this.updateMyStats(code, profile).catch(() => {});

    if (!counts) return { countedForChallenge: false, completedChallenge: null };

    const progress = await this.countChallengeProgress(code, challenge);
    if (progress < challenge.target) return { countedForChallenge: true, completedChallenge: null };

    try {
      await Firestore.update(`squads/${code}`, {
        challenge: createChallenge(challenge.key),
        completedChallenges: (squad.data.completedChallenges || 0) + 1,
        squadXp: (squad.data.squadXp || 0) + (challenge.rewardXp || 0),
        lastActive: Date.now(),
      }, { updateTime: squad.updateTime });
    } catch (err) {
      // Another member rotated it first (precondition failed) - their event announces it.
      if (err instanceof FirebaseError && err.isConflict) return { countedForChallenge: true, completedChallenge: null };
      throw err;
    }
    await this.postEvent(code, {
      type: 'challenge_complete',
      actorName: profile.name,
      challengeId: undefined,
      challengeTitle: challenge.title,
      rewardXp: challenge.rewardXp,
    }).catch(() => {});
    return { countedForChallenge: true, completedChallenge: challenge };
  },
};

// ===========================================================================
// Duels
// ===========================================================================

function cleanProblem(problem) {
  return {
    id: String(problem.id || ''),
    title: String(problem.title || 'Problem').slice(0, 120),
    slug: String(problem.slug || '').slice(0, 120),
    difficulty: problem.difficulty || 'Medium',
    category: String(problem.category || '').slice(0, 60),
  };
}

export const Duels = {
  async create({ code, opponent, format, problem, profile }) {
    const uid = await Auth.getUid();
    const id = randomId('d');
    const now = Date.now();
    const prob = cleanProblem(problem);
    const duel = {
      squadCode: code,
      challengerUid: uid,
      challengerName: sanitizeName(profile.name),
      opponentUid: opponent.uid,
      opponentName: sanitizeName(opponent.name),
      format: String(format || 'random_blind75').slice(0, 40),
      difficulty: prob.difficulty,
      category: prob.category,
      status: 'pending',
      createdAt: now,
      acceptedAt: null,
      finishedAt: null,
      winnerUid: null,
      winnerName: null,
      runtime: null,
      expireAt: new Date(now + DUEL_TTL_MS),
    };
    await Firestore.commit([
      { create: { path: `duels/${id}`, data: duel } },
      { create: { path: `duels/${id}/secret/problem`, data: prob } },
    ]);
    await Squads.postEvent(code, {
      type: 'duel_challenge',
      actorName: profile.name,
      targetUid: opponent.uid,
      targetName: opponent.name,
      duelId: id,
    }).catch(() => {});
    await chrome.storage.local.set({ current_duel_id: id });
    return { id, ...duel };
  },

  async get(id) {
    const doc = await Firestore.get(`duels/${id}`);
    return doc ? { id: doc.id, ...doc.data } : null;
  },

  async getProblem(id) {
    const doc = await Firestore.get(`duels/${id}/secret/problem`);
    return doc?.data || null;
  },

  /** Incoming invites, my outgoing pending invite, and my active match. */
  async listMine() {
    const uid = await Auth.getUid();
    const [asOpponent, asChallenger] = await Promise.all([
      Firestore.query('', 'duels', { where: [['opponentUid', '==', uid], ['status', 'in', ['pending', 'active']]], limit: 20 }),
      Firestore.query('', 'duels', { where: [['challengerUid', '==', uid], ['status', 'in', ['pending', 'active']]], limit: 20 }),
    ]);
    const fresh = d => d.status !== 'pending' || Date.now() - d.createdAt < DUEL_INVITE_TTL_MS;
    const all = [...asOpponent, ...asChallenger].map(d => ({ id: d.id, ...d.data })).filter(fresh);
    return {
      uid,
      incoming: all.filter(d => d.status === 'pending' && d.opponentUid === uid).sort((a, b) => b.createdAt - a.createdAt),
      outgoing: all.find(d => d.status === 'pending' && d.challengerUid === uid) || null,
      active: all.filter(d => d.status === 'active').sort((a, b) => b.acceptedAt - a.acceptedAt)[0] || null,
    };
  },

  async accept(duel, profile) {
    await Firestore.update(`duels/${duel.id}`, { status: 'active', acceptedAt: Date.now() });
    await chrome.storage.local.set({ current_duel_id: duel.id });
    await Squads.postEvent(duel.squadCode, {
      type: 'duel_accepted',
      actorName: profile.name,
      targetUid: duel.challengerUid,
      targetName: duel.challengerName,
      duelId: duel.id,
    }).catch(() => {});
    return this.getProblem(duel.id);
  },

  async decline(duel) {
    await Firestore.update(`duels/${duel.id}`, { status: 'declined', finishedAt: Date.now() });
  },

  async cancel(duel) {
    await Firestore.update(`duels/${duel.id}`, { status: 'cancelled', finishedAt: Date.now() });
    await chrome.storage.local.remove('current_duel_id');
  },

  async forfeit(duel, profile) {
    const uid = await Auth.getUid();
    const iAmChallenger = duel.challengerUid === uid;
    const winnerUid = iAmChallenger ? duel.opponentUid : duel.challengerUid;
    const winnerName = iAmChallenger ? duel.opponentName : duel.challengerName;
    await Firestore.update(`duels/${duel.id}`, { status: 'forfeited', winnerUid, winnerName, finishedAt: Date.now() });
    await Squads.postEvent(duel.squadCode, {
      type: 'duel_forfeit',
      actorName: profile.name,
      targetUid: winnerUid,
      targetName: winnerName,
      duelId: duel.id,
    }).catch(() => {});
  },

  /** First participant to land an accepted solve wins. Returns false if the match was already decided. */
  async claimWin(duel, profile, runtime) {
    const uid = await Auth.getUid();
    try {
      await Firestore.update(`duels/${duel.id}`, {
        status: 'completed',
        winnerUid: uid,
        winnerName: sanitizeName(profile.name),
        finishedAt: Date.now(),
        runtime: runtime ? String(runtime).slice(0, 20) : null,
      });
    } catch (err) {
      if (err instanceof FirebaseError && (err.isPermissionDenied || err.isConflict)) return false;
      throw err;
    }
    const loser = duel.challengerUid === uid
      ? { uid: duel.opponentUid, name: duel.opponentName }
      : { uid: duel.challengerUid, name: duel.challengerName };
    await Squads.postEvent(duel.squadCode, {
      type: 'duel_result',
      actorName: profile.name,
      targetUid: loser.uid,
      targetName: loser.name,
      duelId: duel.id,
    }).catch(() => {});
    return true;
  },
};
