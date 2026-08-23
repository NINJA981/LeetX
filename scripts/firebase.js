/**
 * Firebase Firestore Client for LeetSync Squads
 * Real-time Squad Rooms, Live Leaderboards, Nudges, and 1v1 Duels.
 */

export class FirebaseSquads {
  /**
   * Get dynamic Firestore endpoint from configured Project ID.
   */
  static async getApiUrl() {
    const data = await chrome.storage.local.get('firebase_project_id');
    const projectId = data.firebase_project_id || 'leetsync-squads-app';
    return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  }

  /**
   * Helper to format Firestore document values.
   */
  static encodeValue(val) {
    if (typeof val === 'string') return { stringValue: val };
    if (typeof val === 'number') {
      return Number.isInteger(val) ? { integerValue: val.toString() } : { doubleValue: val };
    }
    if (typeof val === 'boolean') return { booleanValue: val };
    if (Array.isArray(val)) return { arrayValue: { values: val.map(this.encodeValue.bind(this)) } };
    if (val && typeof val === 'object') {
      const fields = {};
      for (const [k, v] of Object.entries(val)) {
        fields[k] = this.encodeValue(v);
      }
      return { mapValue: { fields } };
    }
    return { nullValue: null };
  }

  /**
   * Helper to decode Firestore document values into plain JS objects.
   */
  static decodeValue(obj) {
    if (!obj) return null;
    if ('stringValue' in obj) return obj.stringValue;
    if ('integerValue' in obj) return parseInt(obj.integerValue, 10);
    if ('doubleValue' in obj) return parseFloat(obj.doubleValue);
    if ('booleanValue' in obj) return obj.booleanValue;
    if ('arrayValue' in obj) return (obj.arrayValue.values || []).map(this.decodeValue.bind(this));
    if ('mapValue' in obj) {
      const res = {};
      for (const [k, v] of Object.entries(obj.mapValue.fields || {})) {
        res[k] = this.decodeValue(v);
      }
      return res;
    }
    return null;
  }

  /**
   * Generate a random 6-character room code (e.g. #ALGO99).
   */
  static generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `#${code}`;
  }

  /**
   * Fetch squad document from remote Firestore.
   */
  static async fetchRemoteSquad(cleanCode) {
    try {
      const baseUrl = await this.getApiUrl();
      const docId = cleanCode.replace('#', '');
      const response = await fetch(`${baseUrl}/squads/${docId}`);
      if (!response.ok) return null;
      const data = await response.json();
      return this.decodeValue({ mapValue: { fields: data.fields } });
    } catch (err) {
      console.warn('[FirebaseSquads] Remote fetch offline notice:', err);
      return null;
    }
  }

  /**
   * Save squad document to remote Firestore.
   */
  static async saveRemoteSquad(cleanCode, squadObj) {
    try {
      const baseUrl = await this.getApiUrl();
      const docId = cleanCode.replace('#', '');
      const encodedFields = {};
      for (const [k, v] of Object.entries(squadObj)) {
        encodedFields[k] = this.encodeValue(v);
      }

      await fetch(`${baseUrl}/squads/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: encodedFields }),
      });
    } catch (err) {
      console.warn('[FirebaseSquads] Remote save offline notice:', err);
    }
  }

  /**
   * Create or Join a Squad Room with live cloud sync + local cache.
   */
  static async joinOrCreateSquad(roomCode, userProfile) {
    const cleanCode = (roomCode || this.generateRoomCode()).toUpperCase().replace(/[^A-Z0-9#]/g, '');
    const storageKey = `squad_${cleanCode}`;

    // 1. Try remote Firestore first
    let squad = await this.fetchRemoteSquad(cleanCode);

    // 2. Fallback to local cache
    if (!squad) {
      const stored = await chrome.storage.local.get(storageKey);
      squad = stored[storageKey] || {
        code: cleanCode,
        name: `Squad ${cleanCode}`,
        members: [],
        groupStreak: 1,
        shieldActive: false,
        activityFeed: [],
        createdAt: Date.now(),
      };
    }

    // Upsert member
    const existingIndex = squad.members.findIndex(m => m.username === userProfile.username);
    const memberObj = {
      username: userProfile.username,
      avatarUrl: userProfile.avatarUrl || 'https://assets.leetcode.com/users/default_avatar.png',
      streak: userProfile.streak || 1,
      todaySolved: userProfile.todaySolved || 0,
      totalSolved: userProfile.totalSolved || 0,
      xp: userProfile.xp || 100,
      lastActive: Date.now(),
      status: 'online',
    };

    if (existingIndex >= 0) {
      squad.members[existingIndex] = { ...squad.members[existingIndex], ...memberObj };
    } else {
      squad.members.push(memberObj);
      squad.activityFeed.unshift({
        id: `act_${Date.now()}`,
        type: 'join',
        username: userProfile.username,
        text: `${userProfile.username} joined the squad!`,
        timestamp: Date.now(),
      });
    }

    await chrome.storage.local.set({
      [storageKey]: squad,
      my_squad_code: cleanCode,
    });
    this.saveRemoteSquad(cleanCode, squad).catch(() => {});

    return squad;
  }

  /**
   * Broadcast a problem solve event to the squad activity feed.
   */
  static async broadcastSolve(squadCode, { username, title, runtimeDisplay, memoryDisplay, xpEarned }) {
    if (!squadCode) return;
    const storageKey = `squad_${squadCode}`;
    const stored = await chrome.storage.local.get(storageKey);
    const squad = stored[storageKey];
    if (!squad) return;

    // Update user stats in squad
    const member = squad.members.find(m => m.username === username);
    if (member) {
      member.todaySolved = (member.todaySolved || 0) + 1;
      member.totalSolved = (member.totalSolved || 0) + 1;
      member.xp = (member.xp || 0) + (xpEarned || 25);
      member.lastActive = Date.now();
    }

    // Add to activity feed
    squad.activityFeed.unshift({
      id: `act_${Date.now()}`,
      type: 'solve',
      username,
      text: `${username} crushed "${title}" (${runtimeDisplay || 'Accepted'})!`,
      xpEarned: xpEarned || 25,
      timestamp: Date.now(),
    });

    if (squad.activityFeed.length > 30) {
      squad.activityFeed.pop();
    }

    // Check if all members solved today -> increase group streak!
    const allSolved = squad.members.every(m => m.todaySolved > 0);
    if (allSolved) {
      squad.groupStreak = (squad.groupStreak || 0) + 1;
      squad.shieldActive = true;
    }

    await chrome.storage.local.set({ [storageKey]: squad });
    this.saveRemoteSquad(squadCode, squad).catch(() => {});
  }

  /**
   * Send an emoji nudge (👋, 🔥, 🚨) to a squad member.
   */
  static async sendNudge(squadCode, fromUser, toUser, emoji = '👋') {
    if (!squadCode) return;
    const storageKey = `squad_${squadCode}`;
    const stored = await chrome.storage.local.get(storageKey);
    const squad = stored[storageKey];
    if (!squad) return;

    squad.activityFeed.unshift({
      id: `nudge_${Date.now()}`,
      type: 'nudge',
      fromUser,
      toUser,
      emoji,
      text: `${fromUser} sent a nudge ${emoji} to @${toUser}!`,
      timestamp: Date.now(),
    });

    await chrome.storage.local.set({ [storageKey]: squad });
    this.saveRemoteSquad(squadCode, squad).catch(() => {});
  }

  /**
   * Create or challenge a squad member to a 1v1 problem race.
   */
  static async createDuel(squadCode, challengerUser, opponentUser, problem) {
    const duelId = `duel_${Date.now()}`;
    const duel = {
      id: duelId,
      squadCode,
      challenger: challengerUser,
      opponent: opponentUser,
      problemTitle: problem.title,
      problemSlug: problem.slug,
      status: 'active', // active, completed
      startTime: Date.now(),
      winner: null,
    };

    await chrome.storage.local.set({ [duelId]: duel, active_duel_id: duelId });
    return duel;
  }
}
