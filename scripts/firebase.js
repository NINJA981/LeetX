/**
 * LeetSync Squads - Production Cloud Firestore Client & Multiplayer Relay
 * Direct multi-device synchronization for Squad Rooms, Live Leaderboards, and 1v1 Duels.
 * Zero external heavy dependencies — pure, resilient Firestore REST engine with offline caching.
 */

export class FirebaseSquads {
  // Production Firebase Project & Web API Key for LeetSync Squads
  static DEFAULT_PROJECT_ID = 'leetsync-squads-app';
  static DEFAULT_API_KEY = 'AIzaSyAzWSsFeCpnY5v1fRwPRzgEZg3k8LOMNU4';

  /**
   * Get active Firebase Project ID from storage or default.
   */
  static async getProjectId() {
    try {
      const data = await chrome.storage.local.get(['firebase_project_id']);
      return data.firebase_project_id || this.DEFAULT_PROJECT_ID;
    } catch {
      return this.DEFAULT_PROJECT_ID;
    }
  }

  /**
   * Get active Firebase Web API Key from storage or default.
   */
  static async getApiKey() {
    try {
      const data = await chrome.storage.local.get(['firebase_api_key']);
      return data.firebase_api_key || this.DEFAULT_API_KEY;
    } catch {
      return this.DEFAULT_API_KEY;
    }
  }

  /**
   * Base REST URL for Cloud Firestore documents.
   */
  static async getBaseUrl() {
    const projectId = await this.getProjectId();
    return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  }

  /**
   * Clean and normalize room code (e.g., #algo99 -> ALGO99).
   */
  static cleanCode(code) {
    if (!code) return 'ALGO99';
    return code.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'ALGO99';
  }

  /**
   * Generate an unambiguous 6-character random room code (e.g. K9X2P4).
   * Excludes confusing characters (0, O, 1, I).
   */
  static generateRandomCode(length = 6) {
    const charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
  }

  /**
   * Generate a unique 6-character room code not yet in use on Firestore.
   */
  static async generateUniqueRoomCode() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = this.generateRandomCode(6);
      const existing = await this.fetchRemoteSquad(candidate);
      if (!existing) {
        return `#${candidate}`;
      }
    }
    return `#${this.generateRandomCode(6)}`;
  }

  // ==========================================
  // FIRESTORE TYPE SERIALIZERS & DESERIALIZERS
  // ==========================================

  static toFirestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (typeof value === 'string') return { stringValue: value };
    if (Array.isArray(value)) {
      return { arrayValue: { values: value.map(v => this.toFirestoreValue(v)) } };
    }
    if (typeof value === 'object') {
      const fields = {};
      for (const [k, v] of Object.entries(value)) {
        if (v !== undefined) {
          fields[k] = this.toFirestoreValue(v);
        }
      }
      return { mapValue: { fields } };
    }
    return { stringValue: String(value) };
  }

  static fromFirestoreValue(field) {
    if (!field || typeof field !== 'object') return null;
    if ('nullValue' in field) return null;
    if ('booleanValue' in field) return field.booleanValue;
    if ('integerValue' in field) return parseInt(field.integerValue, 10);
    if ('doubleValue' in field) return parseFloat(field.doubleValue);
    if ('stringValue' in field) return field.stringValue;
    if ('timestampValue' in field) return field.timestampValue;
    if ('arrayValue' in field) {
      return (field.arrayValue.values || []).map(v => this.fromFirestoreValue(v));
    }
    if ('mapValue' in field) {
      const res = {};
      for (const [k, v] of Object.entries(field.mapValue.fields || {})) {
        res[k] = this.fromFirestoreValue(v);
      }
      return res;
    }
    return null;
  }

  static toFirestoreDoc(dataObj) {
    const fields = {};
    for (const [k, v] of Object.entries(dataObj)) {
      if (v !== undefined) {
        fields[k] = this.toFirestoreValue(v);
      }
    }
    return { fields };
  }

  static fromFirestoreDoc(doc) {
    if (!doc || !doc.fields) return null;
    const result = {};
    for (const [k, v] of Object.entries(doc.fields)) {
      result[k] = this.fromFirestoreValue(v);
    }
    return result;
  }

  // ==========================================
  // FIRESTORE REST API CORE PRIMITIVES
  // ==========================================

  /**
   * Fetch a document by collection and document ID.
   */
  static async getDocument(collection, docId) {
    try {
      const baseUrl = await this.getBaseUrl();
      const apiKey = await this.getApiKey();
      const url = `${baseUrl}/${collection}/${encodeURIComponent(docId)}?key=${apiKey}`;
      const res = await fetch(url, { method: 'GET' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Firestore GET ${res.status}: ${res.statusText}`);
      const json = await res.json();
      return this.fromFirestoreDoc(json);
    } catch (err) {
      console.warn(`[Firestore] getDocument (${collection}/${docId}) notice:`, err.message);
      return null;
    }
  }

  /**
   * Set or overwrite a document in Firestore.
   */
  static async setDocument(collection, docId, dataObj) {
    try {
      const baseUrl = await this.getBaseUrl();
      const apiKey = await this.getApiKey();
      const url = `${baseUrl}/${collection}/${encodeURIComponent(docId)}?key=${apiKey}`;
      const body = JSON.stringify(this.toFirestoreDoc(dataObj));
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) throw new Error(`Firestore SET ${res.status}: ${res.statusText}`);
      const json = await res.json();
      return this.fromFirestoreDoc(json);
    } catch (err) {
      console.warn(`[Firestore] setDocument (${collection}/${docId}) notice:`, err.message);
      return null;
    }
  }

  // ==========================================
  // SQUAD ROOM SUBSYSTEM (MULTI-DEVICE)
  // ==========================================

  /**
   * Fetch squad room state from Firestore (falling back to local cache).
   */
  static async fetchRemoteSquad(roomCode) {
    const code = this.cleanCode(roomCode);
    const storageKey = `squad_${code}`;

    // 1. Try fetching live document from Firestore
    const remoteDoc = await this.getDocument('squads', code);
    if (remoteDoc) {
      await chrome.storage.local.set({ [storageKey]: remoteDoc });
      return remoteDoc;
    }

    // 2. Fallback to local storage cache if network is offline
    const local = await chrome.storage.local.get(storageKey);
    return local[storageKey] || null;
  }

  /**
   * Save squad document to Firestore and update local cache.
   */
  static async saveRemoteSquad(roomCode, squadObj) {
    const code = this.cleanCode(roomCode);
    const storageKey = `squad_${code}`;

    // 1. Cache immediately in local storage
    await chrome.storage.local.set({ [storageKey]: squadObj });

    // 2. Sync to Cloud Firestore
    await this.setDocument('squads', code, squadObj);
  }

  // ==========================================
  // 25 SQUAD CHALLENGES CATALOG & CYCLER
  // ==========================================
  static SQUAD_CHALLENGES = [
    { id: 'ch_arr_1', title: 'Solve 5 Array & Hashing problems', target: 5, category: 'Arrays & Hashing', rewardXp: 100 },
    { id: 'ch_tp_2', title: 'Solve 4 Two Pointers problems', target: 4, category: 'Two Pointers', rewardXp: 120 },
    { id: 'ch_sw_3', title: 'Solve 3 Sliding Window problems', target: 3, category: 'Sliding Window', rewardXp: 150 },
    { id: 'ch_stk_4', title: 'Solve 4 Stack problems', target: 4, category: 'Stack', rewardXp: 120 },
    { id: 'ch_bs_5', title: 'Solve 4 Binary Search problems', target: 4, category: 'Binary Search', rewardXp: 140 },
    { id: 'ch_ll_6', title: 'Solve 4 Linked List problems', target: 4, category: 'Linked List', rewardXp: 120 },
    { id: 'ch_tr_7', title: 'Solve 5 Tree / BST problems', target: 5, category: 'Trees', rewardXp: 150 },
    { id: 'ch_trie_8', title: 'Solve 3 Trie problems', target: 3, category: 'Tries', rewardXp: 160 },
    { id: 'ch_heap_9', title: 'Solve 3 Heap / Priority Queue problems', target: 3, category: 'Heap / Priority Queue', rewardXp: 160 },
    { id: 'ch_bt_10', title: 'Solve 3 Backtracking problems', target: 3, category: 'Backtracking', rewardXp: 180 },
    { id: 'ch_grp_11', title: 'Solve 4 Graph problems', target: 4, category: 'Graphs', rewardXp: 180 },
    { id: 'ch_agrp_12', title: 'Solve 3 Advanced Graph problems', target: 3, category: 'Advanced Graphs', rewardXp: 200 },
    { id: 'ch_dp1_13', title: 'Solve 4 1-D DP problems', target: 4, category: '1-D DP', rewardXp: 180 },
    { id: 'ch_dp2_14', title: 'Solve 3 2-D DP problems', target: 3, category: '2-D DP', rewardXp: 220 },
    { id: 'ch_grd_15', title: 'Solve 4 Greedy problems', target: 4, category: 'Greedy', rewardXp: 150 },
    { id: 'ch_int_16', title: 'Solve 3 Intervals problems', target: 3, category: 'Intervals', rewardXp: 140 },
    { id: 'ch_mth_17', title: 'Solve 3 Math & Geometry problems', target: 3, category: 'Math & Geometry', rewardXp: 130 },
    { id: 'ch_bit_18', title: 'Solve 3 Bit Manipulation problems', target: 3, category: 'Bit Manipulation', rewardXp: 140 },
    { id: 'ch_med_19', title: 'Solve 6 Medium problems together', target: 6, category: 'Medium', rewardXp: 200 },
    { id: 'ch_hrd_20', title: 'Solve 2 Hard problems together', target: 2, category: 'Hard', rewardXp: 250 },
    { id: 'ch_srg_21', title: 'Complete 10 total squad solves', target: 10, category: 'Any', rewardXp: 250 },
    { id: 'ch_b75_22', title: 'Solve 5 Blind 75 problems together', target: 5, category: 'Blind 75', rewardXp: 175 },
    { id: 'ch_nc150_23', title: 'Solve 5 NeetCode 150 problems together', target: 5, category: 'NeetCode 150', rewardXp: 175 },
    { id: 'ch_ign_24', title: 'Log 5 squad streak solves', target: 5, category: 'Streak', rewardXp: 150 },
    { id: 'ch_wknd_25', title: 'Achieve 8 squad solves sprint', target: 8, category: 'Sprint', rewardXp: 220 },
  ];

  /**
   * Randomly select a challenge from the 25 pool, avoiding immediate repetition.
   */
  static getRandomChallenge(excludeId = null) {
    const pool = this.SQUAD_CHALLENGES.filter(c => c.id !== excludeId);
    const chosen = pool[Math.floor(Math.random() * pool.length)] || this.SQUAD_CHALLENGES[0];
    return {
      id: chosen.id,
      title: chosen.title,
      target: chosen.target,
      category: chosen.category,
      rewardXp: chosen.rewardXp,
      progress: 0,
      startedAt: Date.now(),
    };
  }

  /**
   * Join or Create a Squad Room across multiple devices.
   */
  static async joinOrCreateSquad(roomCode, userProfile) {
    const code = this.cleanCode(roomCode);
    const storageKey = `squad_${code}`;

    // 1. Fetch live squad state
    let squad = await this.fetchRemoteSquad(code);

    const username = (userProfile.username || 'Player').trim();
    if (!squad) {
      squad = {
        code: `#${code}`,
        owner: username,
        members: [],
        activityFeed: [],
        challenge: this.getRandomChallenge(),
        createdAt: Date.now(),
        lastActive: Date.now(),
      };
    }

    if (!Array.isArray(squad.members)) squad.members = [];
    if (!Array.isArray(squad.activityFeed)) squad.activityFeed = [];
    if (!squad.challenge || !squad.challenge.id) {
      squad.challenge = this.getRandomChallenge();
    }
    if (!squad.owner && squad.members.length > 0) {
      squad.owner = squad.members[0]?.username || username;
    } else if (!squad.owner) {
      squad.owner = username;
    }

    const existingIndex = squad.members.findIndex(
      m => (m.username || '').toLowerCase() === username.toLowerCase()
    );

    const memberObj = {
      username: username,
      avatarUrl: userProfile.avatarUrl || 'https://assets.leetcode.com/users/default_avatar.png',
      streak: userProfile.streak || 0,
      todaySolved: userProfile.todaySolved || 0,
      totalSolved: userProfile.totalSolved || 0,
      xp: userProfile.xp || 0,
      lastActive: Date.now(),
      status: 'online',
    };

    if (existingIndex >= 0) {
      squad.members[existingIndex] = { ...squad.members[existingIndex], ...memberObj };
    } else {
      squad.members.push(memberObj);
      squad.activityFeed.unshift({
        id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type: 'join',
        username: username,
        text: `@${username} joined the squad!`,
        timestamp: Date.now(),
      });
    }

    squad.lastActive = Date.now();
    squad.activityFeed = squad.activityFeed.slice(0, 30);

    // Save live state
    await this.saveRemoteSquad(code, squad);
    await chrome.storage.local.set({ my_squad_code: `#${code}` });

    return squad;
  }

  /**
   * Leave an active squad room.
   */
  static async leaveSquad(roomCode, username) {
    const code = this.cleanCode(roomCode);
    const cleanUser = (username || '').trim().toLowerCase();
    let squad = await this.fetchRemoteSquad(code);
    if (!squad || !Array.isArray(squad.members)) {
      await chrome.storage.local.remove(['my_squad_code']);
      return null;
    }

    const originalLength = squad.members.length;
    squad.members = squad.members.filter(
      m => (m.username || '').trim().toLowerCase() !== cleanUser
    );

    if (squad.members.length !== originalLength) {
      if (!Array.isArray(squad.activityFeed)) squad.activityFeed = [];
      squad.activityFeed.unshift({
        id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type: 'leave',
        username: username,
        text: `@${username} left the squad 🚪`,
        timestamp: Date.now(),
      });
      squad.activityFeed = squad.activityFeed.slice(0, 30);
      squad.lastActive = Date.now();

      // If leader left, transfer ownership to next remaining member
      if ((squad.owner || '').trim().toLowerCase() === cleanUser) {
        squad.owner = squad.members[0]?.username || null;
      }

      await this.saveRemoteSquad(code, squad);
    }

    await chrome.storage.local.remove(['my_squad_code']);
    return squad;
  }

  /**
   * Squad Leader removes/kicks a member from the squad room.
   */
  static async kickMember(roomCode, targetUsername, actorUsername) {
    const code = this.cleanCode(roomCode);
    const cleanTarget = (targetUsername || '').trim().toLowerCase();
    const cleanActor = (actorUsername || '').trim().toLowerCase();

    let squad = await this.fetchRemoteSquad(code);
    if (!squad || !Array.isArray(squad.members)) return null;

    const squadOwner = (squad.owner || squad.members[0]?.username || '').trim().toLowerCase();
    if (squadOwner !== cleanActor) {
      throw new Error('Only the Squad Leader can remove members.');
    }

    const originalLength = squad.members.length;
    squad.members = squad.members.filter(
      m => (m.username || '').trim().toLowerCase() !== cleanTarget
    );

    if (squad.members.length !== originalLength) {
      if (!Array.isArray(squad.activityFeed)) squad.activityFeed = [];
      squad.activityFeed.unshift({
        id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type: 'kick',
        username: targetUsername,
        actor: actorUsername,
        text: `@${actorUsername} removed @${targetUsername} from the squad 🚫`,
        timestamp: Date.now(),
      });
      squad.activityFeed = squad.activityFeed.slice(0, 30);
      squad.lastActive = Date.now();
      await this.saveRemoteSquad(code, squad);
    }

    return squad;
  }

  /**
   * Send a nudge to a squad mate.
   */
  static async sendNudge(roomCode, targetUsername, fromUsername) {
    const code = this.cleanCode(roomCode);
    let squad = await this.fetchRemoteSquad(code);
    if (!squad) return false;

    if (!Array.isArray(squad.activityFeed)) squad.activityFeed = [];

    squad.activityFeed.unshift({
      id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'nudge',
      fromUsername: fromUsername,
      targetUsername: targetUsername,
      text: `@${fromUsername} sent a nudge to @${targetUsername}! 👋`,
      timestamp: Date.now(),
    });

    squad.activityFeed = squad.activityFeed.slice(0, 30);
    squad.lastActive = Date.now();
    await this.saveRemoteSquad(code, squad);
    return true;
  }

  /**
   * Check if a solved problem satisfies the current squad challenge conditions.
   */
  static isSolveMatchingChallenge(challenge, problemData) {
    if (!challenge) return false;
    const cat = (challenge.category || '').toLowerCase().trim();
    if (!cat || cat === 'any' || cat === 'streak' || cat === 'sprint') return true;

    const probDiff = (problemData.difficulty || '').toLowerCase().trim();
    if (cat === 'easy') return probDiff === 'easy';
    if (cat === 'medium') return probDiff === 'medium';
    if (cat === 'hard') return probDiff === 'hard';

    const probCat = (problemData.category || '').toLowerCase();
    const probTopics = (problemData.topics || []).map(t => (typeof t === 'string' ? t.toLowerCase() : (t.name || '').toLowerCase()));
    const probTitle = (problemData.title || '').toLowerCase();
    const probSlug = (problemData.slug || problemData.titleSlug || '').toLowerCase();

    // Direct category match
    if (probCat && (probCat === cat || probCat.includes(cat) || cat.includes(probCat))) {
      return true;
    }

    const matchesWord = (...words) => words.some(w => 
      probCat.includes(w) || 
      probTopics.some(t => t.includes(w)) || 
      probTitle.includes(w) || 
      probSlug.includes(w)
    );

    if (cat.includes('tree') || cat.includes('bst')) {
      return matchesWord('tree', 'bst', 'binary search tree', 'treenode', 'root', 'node', 'depth', 'traversal', 'path-sum', 'diameter', 'ancestor', 'invert');
    }
    if (cat.includes('trie')) {
      return matchesWord('trie', 'prefix', 'autocomplete', 'word-search', 'word-dictionary');
    }
    if (cat.includes('graph')) {
      return matchesWord('graph', 'breadth-first', 'depth-first', 'topological', 'shortest path', 'union find', 'disjoint', 'bfs', 'dfs', 'island', 'network', 'course-schedule');
    }
    if (cat.includes('dp') || cat.includes('dynamic programming')) {
      return matchesWord('dp', 'dynamic programming', 'memoization', 'knapsack', 'subsequence', 'climb', 'house-robber', 'coin-change', 'target-sum');
    }
    if (cat.includes('stack')) {
      return matchesWord('stack', 'monotonic stack', 'parenthes', 'polish', 'daily-temperatures', 'largest-rectangle');
    }
    if (cat.includes('heap') || cat.includes('priority queue')) {
      return matchesWord('heap', 'priority queue', 'kth', 'top k', 'median', 'min-heap', 'max-heap');
    }
    if (cat.includes('binary search')) {
      return matchesWord('binary search', 'search in', 'find min', 'peak', 'koko', 'rotated');
    }
    if (cat.includes('sliding window')) {
      return matchesWord('sliding window', 'window', 'substring', 'longest-substring', 'buy-and-sell');
    }
    if (cat.includes('two pointer')) {
      return matchesWord('two pointer', 'two-pointer', 'palindrome', '3sum', 'container-with-most-water', 'trapping-rain-water');
    }
    if (cat.includes('linked list')) {
      return matchesWord('linked list', 'listnode', 'linked-list', 'reverse-linked', 'reorder-list', 'merge-k-sorted');
    }
    if (cat.includes('backtracking')) {
      return matchesWord('backtracking', 'combination', 'permutation', 'n-queens', 'subsets', 'letter-combinations');
    }
    if (cat.includes('greedy')) {
      return matchesWord('greedy', 'jump-game', 'gas-station', 'hand-of-straights');
    }
    if (cat.includes('intervals')) {
      return matchesWord('interval', 'meeting', 'insert-interval', 'non-overlapping');
    }
    if (cat.includes('math') || cat.includes('geometry')) {
      return matchesWord('math', 'geometry', 'matrix', 'rotate-image', 'spiral-matrix', 'pow', 'sqrt');
    }
    if (cat.includes('bit')) {
      return matchesWord('bit', 'bitwise', 'xor', 'and', 'or', '1-bits', 'counting-bits', 'reverse-bits');
    }
    if (cat.includes('array') || cat.includes('hash')) {
      return matchesWord('array', 'hash', 'duplicate', 'anagram', 'two-sum', 'product-of-array');
    }
    if (cat.includes('blind 75') || cat.includes('neetcode 150')) {
      return true;
    }

    return false;
  }

  /**
   * Broadcast a solve event to the squad room.
   */
  static async broadcastSolve(roomCode, username, problemData, currentStreak) {
    const code = this.cleanCode(roomCode);
    let squad = await this.fetchRemoteSquad(code);
    if (!squad) {
      squad = {
        code: `#${code}`,
        members: [],
        activityFeed: [],
        challenge: this.getRandomChallenge(),
        createdAt: Date.now()
      };
    }

    if (!Array.isArray(squad.members)) squad.members = [];
    if (!Array.isArray(squad.activityFeed)) squad.activityFeed = [];
    if (!squad.challenge || !squad.challenge.id) {
      squad.challenge = this.getRandomChallenge();
    }

    const probId = problemData.frontendId || problemData.id || '';
    const probTitle = problemData.title || (typeof problemData === 'string' ? problemData : 'Problem');
    const diff = problemData.difficulty || 'Medium';

    const event = {
      id: `solve_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'SOLVE',
      username: username,
      problemId: probId,
      problemTitle: probTitle,
      difficulty: diff,
      streak: currentStreak,
      text: `@${username} solved #${probId ? probId + ' ' : ''}${probTitle}! (🔥 ${currentStreak}d)`,
      timestamp: Date.now(),
    };

    squad.activityFeed.unshift(event);
    squad.activityFeed = squad.activityFeed.slice(0, 30);

    const member = squad.members.find(m => (m.username || '').toLowerCase() === username.toLowerCase());
    if (member) {
      member.todaySolved = (member.todaySolved || 0) + 1;
      member.totalSolved = (member.totalSolved || 0) + 1;
      member.streak = currentStreak;
      member.lastActive = Date.now();
    }

    // 🎯 Progress Squad Challenge only if problem matches category
    const isMatching = this.isSolveMatchingChallenge(squad.challenge, problemData);
    if (isMatching) {
      squad.challenge.progress = (squad.challenge.progress || 0) + 1;
      if (squad.challenge.progress >= squad.challenge.target) {
        const completedChallenge = squad.challenge;
        const bonusXp = completedChallenge.rewardXp || 150;

        // Award bonus XP to all active squad members
        squad.members.forEach(m => {
          m.xp = (m.xp || 0) + bonusXp;
        });

        // Post celebration in feed
        squad.activityFeed.unshift({
          id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          type: 'challenge_complete',
          text: `🎉 SQUAD CHALLENGE CLEARED: "${completedChallenge.title}"! (+${bonusXp} XP to all members)`,
          timestamp: Date.now(),
        });

        // Randomly cycle to the next challenge from 25 catalog (excluding the one just finished)
        squad.challenge = this.getRandomChallenge(completedChallenge.id);
      }
    }

    squad.lastActive = Date.now();
    await this.saveRemoteSquad(code, squad);
    return event;
  }

  /**
   * Dynamically reroll the squad challenge to a new challenge from the 25 pool.
   */
  static async rerollSquadChallenge(roomCode, username = 'Team') {
    const cleanRoom = this.cleanCode(roomCode);
    const squad = await this.fetchRemoteSquad(cleanRoom);
    if (!squad) return null;

    const currentId = squad.challenge?.id;
    const nextChallenge = this.getRandomChallenge(currentId);
    squad.challenge = nextChallenge;

    if (!Array.isArray(squad.activityFeed)) squad.activityFeed = [];
    squad.activityFeed.unshift({
      id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'challenge_reroll',
      text: `🎲 @${username} rotated the Squad Challenge to: "${nextChallenge.title}"`,
      timestamp: Date.now(),
    });

    squad.lastActive = Date.now();
    await this.saveRemoteSquad(cleanRoom, squad);
    return nextChallenge;
  }

  /**
   * Clear all recent activity feed events in a squad room and reset challenge progress.
   */
  static async clearActivityFeed(roomCode) {
    const cleanRoom = this.cleanCode(roomCode);
    const squad = await this.fetchRemoteSquad(cleanRoom);
    if (squad) {
      squad.activityFeed = [];
      if (squad.challenge) {
        squad.challenge.progress = 0;
      }
      await this.saveRemoteSquad(cleanRoom, squad);
    }
    return true;
  }

  // ==========================================
  // 1V1 REAL-TIME DUELS SUBSYSTEM
  // ==========================================

  /**
   * Create a new 1v1 Duel Challenge.
   */
  static async createDuel({ roomCode, challenger, opponent, format, problem }) {
    const cleanRoom = this.cleanCode(roomCode);
    const duelId = `duel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const duelDoc = {
      id: duelId,
      roomCode: cleanRoom,
      challenger: challenger,
      opponent: opponent,
      format: format || 'random_blind75',
      problem: {
        id: problem.id || 1,
        title: problem.title || 'Two Sum',
        slug: problem.slug || 'two-sum',
        difficulty: problem.difficulty || 'Easy',
        category: problem.category || 'Arrays & Hashing',
      },
      status: 'pending', // 'pending' | 'active' | 'completed' | 'forfeited' | 'declined' | 'expired'
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      winner: null,
      loser: null,
    };

    // Save to Firestore and local storage
    await this.setDocument('duels', duelId, duelDoc);
    await chrome.storage.local.set({ active_duel: duelDoc });

    // Also post challenge notice to squad activity
    let squad = await this.fetchRemoteSquad(cleanRoom);
    if (squad) {
      if (!Array.isArray(squad.activityFeed)) squad.activityFeed = [];
      squad.activityFeed.unshift({
        id: duelId,
        duelId: duelId,
        type: 'duel_challenge',
        challenger: challenger,
        opponent: opponent,
        problem: duelDoc.problem,
        format: duelDoc.format,
        text: `⚔️ @${challenger} challenged @${opponent} to a 1v1 Duel (${duelDoc.problem.difficulty})!`,
        timestamp: Date.now(),
      });
      await this.saveRemoteSquad(cleanRoom, squad);
    }

    await chrome.storage.local.set({ active_duel: duelDoc });
    return duelDoc;
  }

  /**
   * Accept an incoming duel challenge.
   */
  static async acceptDuel(duelId, username) {
    let duel = await this.getDocument('duels', duelId);
    if (!duel) {
      const local = await chrome.storage.local.get(['active_duel', 'incoming_duel']);
      duel = (local.incoming_duel && local.incoming_duel.id === duelId) ? local.incoming_duel : local.active_duel;
    }
    if (!duel) return null;

    duel.status = 'active';
    duel.startedAt = Date.now();
    duel.revealed = true;

    await this.setDocument('duels', duelId, duel);
    await chrome.storage.local.set({ active_duel: duel });
    await chrome.storage.local.remove(['incoming_duel']);

    // Post to squad feed with duel_accepted type so both parties get notified
    if (duel.roomCode) {
      let squad = await this.fetchRemoteSquad(duel.roomCode);
      if (squad) {
        if (!Array.isArray(squad.activityFeed)) squad.activityFeed = [];
        // Purge original pending challenge item from activity feed
        squad.activityFeed = squad.activityFeed.filter(act => act.id !== duelId && act.duelId !== duelId);
        squad.activityFeed.unshift({
          id: `act_${Date.now()}`,
          duelId: duelId,
          type: 'duel_accepted',
          challenger: duel.challenger,
          opponent: duel.opponent,
          problem: duel.problem,
          text: `⚔️ DUEL ACCEPTED: @${duel.opponent} accepted @${duel.challenger}'s match! Problem revealed: #${duel.problem.id} ${duel.problem.title}!`,
          timestamp: Date.now(),
        });
        await this.saveRemoteSquad(duel.roomCode, squad);
      }
    }

    return duel;
  }

  /**
   * Decline an incoming duel challenge.
   */
  static async declineDuel(duelId, username) {
    let duel = await this.getDocument('duels', duelId);
    if (duel) {
      duel.status = 'declined';
      duel.finishedAt = Date.now();
      await this.setDocument('duels', duelId, duel);

      if (duel.roomCode) {
        let squad = await this.fetchRemoteSquad(duel.roomCode);
        if (squad && Array.isArray(squad.activityFeed)) {
          squad.activityFeed = squad.activityFeed.filter(act => act.id !== duelId && act.duelId !== duelId);
          await this.saveRemoteSquad(duel.roomCode, squad);
        }
      }
    }
    await chrome.storage.local.remove(['incoming_duel', 'active_duel']);
    return true;
  }

  /**
   * Forfeit an active duel match.
   */
  static async forfeitDuel(duelId, username) {
    let duel = await this.getDocument('duels', duelId);
    if (!duel) {
      const local = await chrome.storage.local.get(['active_duel']);
      duel = local.active_duel;
    }
    if (!duel) return null;

    duel.status = 'forfeited';
    duel.winner = (duel.challenger.toLowerCase() === username.toLowerCase()) ? duel.opponent : duel.challenger;
    duel.loser = username;
    duel.finishedAt = Date.now();

    await this.setDocument('duels', duelId, duel);
    await chrome.storage.local.set({ active_duel: duel });

    // Update match history
    const matchData = await chrome.storage.local.get(['duel_matches', 'duel_wins']);
    await chrome.storage.local.set({
      duel_matches: (matchData.duel_matches || 0) + 1,
    });

    return duel;
  }

  /**
   * Submit an accepted LeetCode solve to complete an active duel.
   */
  static async submitDuelSolve(duelId, username, runtimeData = {}) {
    let duel = await this.getDocument('duels', duelId);
    if (!duel) {
      const local = await chrome.storage.local.get(['active_duel']);
      duel = local.active_duel;
    }
    if (!duel) return null;

    // Check if match was active/pending and not yet won
    if ((duel.status === 'active' || duel.status === 'pending') && !duel.winner) {
      const loser = (duel.challenger.toLowerCase() === username.toLowerCase()) ? duel.opponent : duel.challenger;
      duel.status = 'completed';
      duel.winner = username;
      duel.loser = loser;
      duel.finishedAt = Date.now();
      duel.runtime = runtimeData.runtimeDisplay || null;

      await this.setDocument('duels', duelId, duel);
      await chrome.storage.local.set({ active_duel: duel });

      // Increment winner stats and XP
      const userState = await chrome.storage.local.get(['duel_wins', 'duel_matches', 'user_xp']);
      await chrome.storage.local.set({
        duel_wins: (userState.duel_wins || 0) + 1,
        duel_matches: (userState.duel_matches || 0) + 1,
        user_xp: (userState.user_xp || 0) + 50,
      });

      // Post victory to squad feed
      if (duel.roomCode) {
        let squad = await this.fetchRemoteSquad(duel.roomCode);
        if (squad) {
          if (!Array.isArray(squad.activityFeed)) squad.activityFeed = [];
          squad.activityFeed.unshift({
            id: `act_${Date.now()}`,
            type: 'duel_win',
            text: `🏆 @${username} WON the 1v1 duel against @${loser} on ${duel.problem.title}! (+50 XP)`,
            timestamp: Date.now(),
          });
          await this.saveRemoteSquad(duel.roomCode, squad);
        }
      }
    }

    return duel;
  }

  /**
   * Check for active duels and all incoming invitations for a user.
   */
  static async checkDuelStatus(username, roomCode) {
    const cleanUser = (username || '').toLowerCase().trim();
    const local = await chrome.storage.local.get(['active_duel', 'incoming_duel']);
    let activeDuel = local.active_duel || null;
    const incomingChallenges = [];

    // If there's an active duel in local storage, sync its latest state from Firestore
    if (activeDuel && activeDuel.id) {
      const remote = await this.getDocument('duels', activeDuel.id);
      if (remote) {
        activeDuel = remote;
        await chrome.storage.local.set({ active_duel: remote });
      }
    }

    // Check squad room feed for all incoming invitations targeted at this user
    const code = this.cleanCode(roomCode);
    const squad = await this.fetchRemoteSquad(code);

    if (squad && Array.isArray(squad.activityFeed)) {
      const pendingFeedItems = squad.activityFeed.filter(act => {
        if (act.type !== 'duel_challenge') return false;
        const opp = (act.opponent || '').toLowerCase().trim();
        const txt = (act.text || '').toLowerCase();
        return opp === cleanUser || txt.includes(`@${cleanUser}`);
      });

      for (const act of pendingFeedItems) {
        const dId = act.duelId || act.id;
        let duelDoc = await this.getDocument('duels', dId);
        if (!duelDoc && act.problem) {
          duelDoc = {
            id: dId,
            roomCode: code,
            challenger: act.challenger || 'Challenger',
            opponent: act.opponent || username,
            problem: act.problem,
            format: act.format || 'random_blind75',
            status: 'pending',
            createdAt: act.timestamp || Date.now(),
          };
        }
        if (duelDoc && duelDoc.status === 'pending' && (duelDoc.opponent || '').toLowerCase() === cleanUser) {
          if (!activeDuel || activeDuel.id !== duelDoc.id) {
            incomingChallenges.push(duelDoc);
          }
        }
      }
    }

    return {
      activeDuel,
      incomingChallenge: incomingChallenges[0] || null,
      incomingChallenges,
      squad,
    };
  }
}
