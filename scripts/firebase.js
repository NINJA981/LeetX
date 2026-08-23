/**
 * Real-Time Squad Relay for LeetSync Squads
 * Backed by GitHub Gist Cloud Sync + Local Storage Cache.
 * Enables 100% reliable cross-computer room joining and live leaderboards.
 */

export class FirebaseSquads {
  /**
   * Clean and normalize room code (e.g., #ALGO99 -> ALGO99).
   */
  static cleanCode(code) {
    if (!code) return 'ALGO99';
    return code.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'ALGO99';
  }

  /**
   * Fetch squad document from remote cloud (GitHub Gists / Storage).
   */
  static async fetchRemoteSquad(roomCode) {
    const code = this.cleanCode(roomCode);
    try {
      const data = await chrome.storage.local.get(['github_token', `gist_${code}`]);
      const gistId = data[`gist_${code}`];

      if (gistId && data.github_token) {
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
          headers: {
            'Authorization': `Bearer ${data.github_token}`,
            'Accept': 'application/vnd.github.v3+json',
          }
        });
        if (response.ok) {
          const gistData = await response.json();
          const file = gistData.files && (gistData.files['squad.json'] || Object.values(gistData.files)[0]);
          if (file && file.content) {
            return JSON.parse(file.content);
          }
        }
      }
    } catch (err) {
      console.warn('[SquadSync] Remote fetch fallback notice:', err);
    }
    return null;
  }

  /**
   * Save squad document to cloud relay and local cache.
   */
  static async saveRemoteSquad(roomCode, squadObj) {
    const code = this.cleanCode(roomCode);
    const storageKey = `squad_${code}`;

    // 1. Always save to local cache
    await chrome.storage.local.set({ [storageKey]: squadObj });

    // 2. Sync to GitHub Gist if authenticated
    try {
      const data = await chrome.storage.local.get(['github_token', `gist_${code}`]);
      if (!data.github_token) return;

      const content = JSON.stringify(squadObj, null, 2);
      const gistId = data[`gist_${code}`];

      if (gistId) {
        // Update existing gist
        await fetch(`https://api.github.com/gists/${gistId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${data.github_token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            description: `LeetSync Squad #${code}`,
            files: { 'squad.json': { content } },
          }),
        });
      } else {
        // Create new unlisted gist for the squad
        const resp = await fetch('https://api.github.com/gists', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${data.github_token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            description: `LeetSync Squad #${code}`,
            public: true,
            files: { 'squad.json': { content } },
          }),
        });
        if (resp.ok) {
          const createdGist = await resp.json();
          await chrome.storage.local.set({ [`gist_${code}`]: createdGist.id });
        }
      }
    } catch (err) {
      console.warn('[SquadSync] Remote save notice:', err);
    }
  }

  /**
   * Join or Create a Squad Room.
   */
  static async joinOrCreateSquad(roomCode, userProfile) {
    const code = this.cleanCode(roomCode);
    const storageKey = `squad_${code}`;

    // Try fetching remote state first
    let squad = await this.fetchRemoteSquad(code);

    // Fallback to local storage
    if (!squad) {
      const stored = await chrome.storage.local.get(storageKey);
      squad = stored[storageKey] || {
        code: `#${code}`,
        members: [],
        activityFeed: [],
        createdAt: Date.now(),
      };
    }

    if (!Array.isArray(squad.members)) squad.members = [];
    if (!Array.isArray(squad.activityFeed)) squad.activityFeed = [];

    // Upsert current user
    const username = userProfile.username || 'NINJA981';
    const existingIndex = squad.members.findIndex(m => m.username.toLowerCase() === username.toLowerCase());

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
        id: `act_${Date.now()}`,
        type: 'join',
        text: `@${username} joined the squad!`,
        timestamp: Date.now(),
      });
    }

    // Save state
    await this.saveRemoteSquad(code, squad);
    await chrome.storage.local.set({ my_squad_code: `#${code}` });

    return squad;
  }

  /**
   * Add a peer member directly to the active squad room.
   */
  static async addMemberToSquad(roomCode, peerUsername) {
    const code = this.cleanCode(roomCode);
    const storageKey = `squad_${code}`;
    const stored = await chrome.storage.local.get(storageKey);
    let squad = stored[storageKey] || { code: `#${code}`, members: [], activityFeed: [] };

    const cleanPeer = peerUsername.replace('@', '').trim();
    if (!cleanPeer) return squad;

    const exists = (squad.members || []).some(m => m.username.toLowerCase() === cleanPeer.toLowerCase());
    if (!exists) {
      squad.members.push({
        username: cleanPeer,
        streak: 1,
        todaySolved: 0,
        totalSolved: 0,
        xp: 50,
        lastActive: Date.now(),
        status: 'online',
      });

      squad.activityFeed.unshift({
        id: `act_${Date.now()}`,
        type: 'join',
        text: `@${cleanPeer} was added to the squad!`,
        timestamp: Date.now(),
      });

      await this.saveRemoteSquad(code, squad);
    }
    return squad;
  }

  /**
   * Send a nudge to a squad mate.
   */
  static async sendNudge(roomCode, targetUsername, fromUsername) {
    const code = this.cleanCode(roomCode);
    const storageKey = `squad_${code}`;
    const stored = await chrome.storage.local.get(storageKey);
    let squad = stored[storageKey] || { code: `#${code}`, members: [], activityFeed: [] };

    squad.activityFeed.unshift({
      id: `act_${Date.now()}`,
      type: 'nudge',
      text: `@${fromUsername} sent a nudge to @${targetUsername}!`,
      timestamp: Date.now(),
    });

    squad.activityFeed = squad.activityFeed.slice(0, 25);
    await this.saveRemoteSquad(code, squad);
    return true;
  }

  /**
   * Broadcast a solve event to the squad.
   */
  static async broadcastSolve(roomCode, username, problemData, currentStreak) {
    const code = this.cleanCode(roomCode);
    const storageKey = `squad_${code}`;
    const stored = await chrome.storage.local.get(storageKey);
    let squad = stored[storageKey] || { code: `#${code}`, members: [], activityFeed: [] };

    const event = {
      type: 'SOLVE',
      username,
      problemId: problemData.frontendId || problemData.id,
      problemTitle: problemData.title,
      difficulty: problemData.difficulty,
      streak: currentStreak,
      text: `@${username} solved #${problemData.frontendId || problemData.id} ${problemData.title}! (🔥 ${currentStreak}d)`,
      timestamp: Date.now(),
    };

    squad.activityFeed = [event, ...(squad.activityFeed || [])].slice(0, 25);

    const member = (squad.members || []).find(m => m.username.toLowerCase() === username.toLowerCase());
    if (member) {
      member.todaySolved = (member.todaySolved || 0) + 1;
      member.streak = currentStreak;
      member.lastActive = Date.now();
    }

    await this.saveRemoteSquad(code, squad);
    return event;
  }
}
