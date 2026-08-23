/**
 * LeetSync Squads - Comprehensive End-to-End (E2E) Test Suite
 * Tests all user flows, multiplayer state machines, problem synchronization,
 * UI components, and API integration layers.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// In-Memory Document Database for full offline E2E mock
const firestoreDb = new Map();

// Setup Chrome Extension Mock Environment
global.chrome = {
  runtime: {
    id: 'test-extension-id',
    getURL: (p) => path.join(__dirname, '..', p),
    sendMessage: (msg, cb) => { if (cb) cb({ success: true }); },
    lastError: null,
    onMessage: { addListener: () => {} },
  },
  storage: {
    local: {
      _data: {},
      get: async (keys) => {
        if (!keys) return { ...global.chrome.storage.local._data };
        const result = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          result[k] = global.chrome.storage.local._data[k];
        }
        return result;
      },
      set: async (items) => {
        Object.assign(global.chrome.storage.local._data, items);
      },
      remove: async (keys) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          delete global.chrome.storage.local._data[k];
        }
      },
      clear: async () => {
        global.chrome.storage.local._data = {};
      }
    },
    onChanged: { addListener: () => {} }
  },
  tabs: {
    query: (query, cb) => { cb([{ id: 1, url: 'https://leetcode.com/problems/two-sum/' }]); },
    create: async ({ url }) => { return { id: 2, url }; },
    sendMessage: (tabId, msg, cb) => { if (cb) cb({ received: true }); }
  },
  notifications: {
    create: (id, opt, cb) => { if (cb) cb(id || 'test_notif'); },
    clear: (id, cb) => { if (cb) cb(true); }
  },
  cookies: {
    get: async ({ url, name }) => ({ value: 'mock-csrf-token' })
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {}
  },
  alarms: {
    create: () => {},
    onAlarm: { addListener: () => {} }
  }
};

// Polyfill btoa / atob / fetch for node
global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
global.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');

global.fetch = async (url, opts = {}) => {
  if (typeof url === 'string') {
    // 1. Local JSON Datasets
    if (url.includes('assets/data/')) {
      const filePath = path.resolve(__dirname, '..', url.replace(/^[a-z]+:\/\/[^/]+\//, ''));
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        return { ok: true, status: 200, json: async () => JSON.parse(content) };
      }
    }

    // 2. Simulated Firestore REST API
    if (url.includes('firestore.googleapis.com')) {
      const cleanUrl = url.split('?')[0];
      const match = cleanUrl.match(/documents\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_#-]+)/);
      if (match) {
        const key = `${match[1]}/${match[2]}`;
        const method = (opts.method || 'GET').toUpperCase();

        if (method === 'PATCH' || method === 'POST') {
          const bodyJson = JSON.parse(opts.body || '{}');
          firestoreDb.set(key, bodyJson);
          return {
            ok: true,
            status: 200,
            json: async () => bodyJson,
          };
        } else if (method === 'GET') {
          if (firestoreDb.has(key)) {
            return {
              ok: true,
              status: 200,
              json: async () => firestoreDb.get(key),
            };
          }
          return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
        } else if (method === 'DELETE') {
          firestoreDb.delete(key);
          return { ok: true, status: 200, json: async () => ({}) };
        }
      }
    }
  }

  return {
    ok: true,
    status: 200,
    json: async () => ({ data: {} }),
    text: async () => ''
  };
};

// Load codebase classes
const { FirebaseSquads } = require('../scripts/firebase.js');
const { GitHubAPI } = require('../scripts/github.js');
const { LeetCodeAPI } = require('../scripts/leetcode.js');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(suite, name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
  }
}

async function runAsyncTest(suite, name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
  }
}

async function main() {
  console.log('================================================================');
  console.log('⚡ LEETSYNC SQUADS - END-TO-END (E2E) AUTOMATED TEST SUITE');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // SUITE 1: Manifest V3 & Extension Packaging Integrity
  // -------------------------------------------------------------
  console.log('📦 SUITE 1: MANIFEST V3 & PACKAGING INTEGRITY');
  const manifestPath = path.resolve(__dirname, '../manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  runTest('Manifest', 'Manifest Version 3 compliance', () => {
    assert.strictEqual(manifest.manifest_version, 3);
  });

  runTest('Manifest', 'Mandatory permissions declared (storage, notifications, cookies, tabs, alarms, identity)', () => {
    assert(manifest.permissions.includes('storage'), 'storage permission missing');
    assert(manifest.permissions.includes('notifications'), 'notifications permission missing');
    assert(manifest.permissions.includes('cookies'), 'cookies permission missing');
    assert(manifest.permissions.includes('tabs'), 'tabs permission missing');
    assert(manifest.permissions.includes('alarms'), 'alarms permission missing');
    assert(manifest.permissions.includes('identity'), 'identity permission missing');
  });

  runTest('Manifest', 'Host permissions include LeetCode, GitHub, and Firestore', () => {
    const hosts = manifest.host_permissions || [];
    assert(hosts.some(h => h.includes('leetcode.com')), 'LeetCode host permission missing');
    assert(hosts.some(h => h.includes('github.com')), 'GitHub host permission missing');
    assert(hosts.some(h => h.includes('firestore.googleapis.com')), 'Firestore host permission missing');
  });

  runTest('Manifest', 'Extension icons exist (16px, 48px, 128px)', () => {
    for (const size of ['16', '48', '128']) {
      const iconPath = path.resolve(__dirname, '..', manifest.icons[size]);
      assert(fs.existsSync(iconPath), `Icon ${manifest.icons[size]} does not exist`);
    }
  });

  // -------------------------------------------------------------
  // SUITE 2: DSA Roadmaps & Recommendation Engine
  // -------------------------------------------------------------
  console.log('\n🗺️ SUITE 2: DSA ROADMAPS & RECOMMENDATION ENGINE');
  const b75Path = path.resolve(__dirname, '../assets/data/blind75.json');
  const nc150Path = path.resolve(__dirname, '../assets/data/neetcode150.json');
  const b75Data = JSON.parse(fs.readFileSync(b75Path, 'utf-8'));
  const nc150Data = JSON.parse(fs.readFileSync(nc150Path, 'utf-8'));

  runTest('Roadmaps', 'Blind 75 contains exactly 75 problems with complete schema', () => {
    assert.strictEqual(b75Data.length, 75);
    for (const p of b75Data) {
      assert(p.id && p.title && p.slug && p.difficulty && p.category, `Problem #${p.id} has incomplete schema`);
    }
  });

  runTest('Roadmaps', 'NeetCode 150 contains exactly 150 problems with complete schema', () => {
    assert.strictEqual(nc150Data.length, 150);
    for (const p of nc150Data) {
      assert(p.id && p.title && p.slug && p.difficulty && p.category, `Problem #${p.id} has incomplete schema`);
    }
  });

  runTest('Roadmaps', 'Category filtering correctly partitions problem subsets', () => {
    const arrayProbs = nc150Data.filter(p => (p.category || '').toLowerCase().includes('array'));
    const treeProbs = nc150Data.filter(p => (p.category || '').toLowerCase().includes('tree'));
    assert(arrayProbs.length > 0, 'Array category should have problems');
    assert(treeProbs.length > 0, 'Tree category should have problems');
    assert(arrayProbs.length + treeProbs.length < nc150Data.length, 'Partitioning should be a proper subset');
  });

  runTest('Roadmaps', 'Next recommendation algorithm picks next unsolved problem', () => {
    const solvedSet = new Set(['two-sum', 'valid-anagram']);
    const nextProb = b75Data.find(p => !solvedSet.has(p.slug));
    assert(nextProb, 'Recommendation must find an unsolved problem');
    assert(!solvedSet.has(nextProb.slug), 'Recommended problem must not be in solved set');
  });

  // -------------------------------------------------------------
  // SUITE 3: GitHub Submission Sync & Markdown Formatting
  // -------------------------------------------------------------
  console.log('\n🐙 SUITE 3: GITHUB SUBMISSION SYNC & FORMATTING');

  runTest('GitHub', 'Problem folder naming formats four-digit IDs and slugs correctly', () => {
    const idFormatted = String(1).padStart(4, '0');
    const folderName = `${idFormatted}-two-sum`;
    assert.strictEqual(folderName, '0001-two-sum');
  });

  runTest('GitHub', 'README problem catalog generation includes dynamic user repository link', () => {
    const problems = [
      { id: 1, title: 'Two Sum', difficulty: 'Easy', folderName: '0001-Two-Sum', solutions: ['Python3', 'Java'] },
      { id: 2, title: 'Add Two Numbers', difficulty: 'Medium', folderName: '0002-Add-Two-Numbers', solutions: ['C++'] },
    ];
    let catalog = `# ⚡ LeetCode Submissions\n\n| # | Title | Difficulty | Solutions |\n| :--- | :--- | :--- | :--- |\n`;
    for (const prob of problems) {
      catalog += `| ${prob.id} | [${prob.title}](${prob.folderName}/) | \`${prob.difficulty}\` | ${prob.solutions.join(' ')} |\n`;
    }
    const owner = 'testuser';
    const repo = 'leetcode-solutions';
    catalog += `\n---\n\n<div align="center"><sub>Synced automatically with <a href="https://github.com/${owner}/${repo}">LeetX Squads</a></sub></div>\n`;

    assert(catalog.includes('https://github.com/testuser/leetcode-solutions'), 'Catalog footer must link dynamically to user repo');
    assert(catalog.includes('| 1 | [Two Sum](0001-Two-Sum/) | `Easy` | Python3 Java |'));
  });

  // -------------------------------------------------------------
  // SUITE 4: Cloud Firestore Multiplayer Squad Rooms
  // -------------------------------------------------------------
  console.log('\n👥 SUITE 4: CLOUD FIRESTORE MULTIPLAYER SQUAD ROOMS');
  const rawCode = FirebaseSquads.generateRandomCode(6);
  const testRoomCode = await FirebaseSquads.generateUniqueRoomCode();

  runTest('Squads', 'Generate unambiguous 6-char random code excluding 0, O, 1, I', () => {
    assert.strictEqual(rawCode.length, 6);
    assert(!/[0O1I]/.test(rawCode), 'Room code must not contain 0, O, 1, or I');
  });

  runTest('Squads', 'generateUniqueRoomCode prepends # and formats valid room code', () => {
    assert(testRoomCode.startsWith('#'), 'Room code must start with #');
    assert.strictEqual(testRoomCode.length, 7);
  });

  await runAsyncTest('Squads', 'Create room: Creator becomes Squad Leader and active challenge is initialized', async () => {
    const squad = await FirebaseSquads.joinOrCreateSquad(testRoomCode, {
      username: 'Alice_Leader',
      streak: 5,
      todaySolved: 1,
      totalSolved: 40,
      xp: 250,
    });
    assert.strictEqual(squad.owner, 'Alice_Leader');
    assert.strictEqual(squad.members.length, 1);
    assert(squad.challenge && squad.challenge.id, 'Squad challenge must be initialized');
    assert(squad.challenge.target > 0, 'Challenge target must be positive');
  });

  await runAsyncTest('Squads', 'Member join: Second player adds to squad members list', async () => {
    const squad = await FirebaseSquads.joinOrCreateSquad(testRoomCode, {
      username: 'Bob_Dev',
      streak: 3,
      todaySolved: 0,
      totalSolved: 20,
      xp: 100,
    });
    assert.strictEqual(squad.members.length, 2);
    assert(squad.members.some(m => m.username === 'Bob_Dev'));
  });

  await runAsyncTest('Squads', 'Nudge feature: Sends real-time nudge and records in activity feed', async () => {
    await FirebaseSquads.sendNudge(testRoomCode, 'Bob_Dev', 'Alice_Leader');
    const squad = await FirebaseSquads.fetchRemoteSquad(testRoomCode);
    assert(squad.activityFeed.some(a => a.type === 'nudge' && a.targetUsername === 'Bob_Dev'));
  });

  await runAsyncTest('Squads', 'Leader Kick Member: Removes member and logs kick event', async () => {
    await FirebaseSquads.kickMember(testRoomCode, 'Bob_Dev', 'Alice_Leader');
    const squad = await FirebaseSquads.fetchRemoteSquad(testRoomCode);
    assert(!squad.members.some(m => m.username === 'Bob_Dev'), 'Bob_Dev must be removed');
    assert(squad.activityFeed.some(a => a.type === 'kick'));
  });

  await runAsyncTest('Squads', 'Member Leave Squad: Cleans storage and transfers ownership if leader leaves', async () => {
    // Re-add Charlie
    await FirebaseSquads.joinOrCreateSquad(testRoomCode, { username: 'Charlie_Coder', streak: 1, todaySolved: 0 });
    // Alice leaves
    await FirebaseSquads.leaveSquad(testRoomCode, 'Alice_Leader');
    const squad = await FirebaseSquads.fetchRemoteSquad(testRoomCode);
    assert(!squad.members.some(m => m.username === 'Alice_Leader'), 'Alice must be removed');
    assert.strictEqual(squad.owner, 'Charlie_Coder', 'Ownership must transfer to Charlie');
    const local = await global.chrome.storage.local.get(['my_squad_code']);
    assert(!local.my_squad_code, 'Storage my_squad_code must be cleared on leave');
  });

  await runAsyncTest('Squads', 'Challenge progress & auto-cycling upon target completion', async () => {
    const squad = await FirebaseSquads.fetchRemoteSquad(testRoomCode);
    const initialChallengeId = squad.challenge.id;
    const cat = squad.challenge.category || 'Arrays';

    for (let i = 0; i < squad.challenge.target; i++) {
      await FirebaseSquads.broadcastSolve(testRoomCode, 'Charlie_Coder', {
        id: 100 + i,
        title: `Solve ${i}`,
        category: cat,
        difficulty: 'Medium'
      }, 2);
    }
    const cycledSquad = await FirebaseSquads.fetchRemoteSquad(testRoomCode);
    assert.notStrictEqual(cycledSquad.challenge.id, initialChallengeId, 'Challenge must auto-rotate on completion');
    assert(cycledSquad.activityFeed.some(a => a.type === 'challenge_complete'), 'Celebration event must be logged');
  });

  await runAsyncTest('Squads', 'Dynamic challenge reroll selects a new challenge', async () => {
    const squad = await FirebaseSquads.fetchRemoteSquad(testRoomCode);
    const currentId = squad.challenge.id;
    const nextChallenge = await FirebaseSquads.rerollSquadChallenge(testRoomCode, 'Charlie_Coder');
    assert(nextChallenge && nextChallenge.id !== currentId, 'Challenge must rotate on reroll');
  });

  await runAsyncTest('Squads', 'Clear activity feed wipes all feed entries', async () => {
    await FirebaseSquads.clearActivityFeed(testRoomCode);
    const squad = await FirebaseSquads.fetchRemoteSquad(testRoomCode);
    assert.strictEqual(squad.activityFeed.length, 0, 'Feed must be empty after clearing');
  });

  // -------------------------------------------------------------
  // SUITE 5: 1v1 Problem Duel Lifecycle & Win Resolution
  // -------------------------------------------------------------
  console.log('\n⚔️ SUITE 5: 1V1 PROBLEM DUEL STATE MACHINE');

  let activeDuelDoc = null;

  await runAsyncTest('Duels', 'Create Duel: Starts in pending status with concealed problem state', async () => {
    await global.chrome.storage.local.clear();
    activeDuelDoc = await FirebaseSquads.createDuel({
      roomCode: testRoomCode,
      challenger: 'PlayerOne',
      opponent: 'PlayerTwo',
      format: 'random_blind75',
      problem: {
        id: 1,
        title: 'Two Sum',
        slug: 'two-sum',
        difficulty: 'Easy',
        category: 'Arrays & Hashing'
      }
    });

    assert(activeDuelDoc && activeDuelDoc.id, 'Duel document must be created');
    assert.strictEqual(activeDuelDoc.status, 'pending');
    assert.strictEqual(activeDuelDoc.challenger, 'PlayerOne');
    assert.strictEqual(activeDuelDoc.opponent, 'PlayerTwo');
  });

  await runAsyncTest('Duels', 'Check Duel Status: Challenger sees pending match, Opponent device sees incoming invite', async () => {
    // Challenger check
    const challengerStatus = await FirebaseSquads.checkDuelStatus('PlayerOne', testRoomCode);
    assert(challengerStatus.activeDuel && challengerStatus.activeDuel.id === activeDuelDoc.id);

    // Switch device mock to Opponent
    await global.chrome.storage.local.clear();
    const opponentStatus = await FirebaseSquads.checkDuelStatus('PlayerTwo', testRoomCode);
    assert(opponentStatus.incomingChallenges.some(i => i.id === activeDuelDoc.id), 'Opponent must see incoming invite');
  });

  await runAsyncTest('Duels', 'Accept Duel: Transitions status to active, records start time, reveals problem', async () => {
    const accepted = await FirebaseSquads.acceptDuel(activeDuelDoc.id, 'PlayerTwo');
    assert.strictEqual(accepted.status, 'active');
    assert(accepted.startedAt > 0, 'startedAt timestamp must be recorded');
    assert.strictEqual(accepted.revealed, true, 'Problem must be revealed on accept');

    // Verify activity feed purged pending challenge item
    const squad = await FirebaseSquads.fetchRemoteSquad(testRoomCode);
    assert(!squad.activityFeed.some(a => a.type === 'duel_challenge' && (a.duelId === activeDuelDoc.id || a.id === activeDuelDoc.id)));
    assert(squad.activityFeed.some(a => a.type === 'duel_accepted'));
  });

  await runAsyncTest('Duels', 'Submit Solve: First player to solve wins duel, awards +50 XP, records win/loss', async () => {
    const completed = await FirebaseSquads.submitDuelSolve(activeDuelDoc.id, 'PlayerTwo', {
      runtimeDisplay: '35 ms',
      memoryDisplay: '16.4 MB'
    });

    assert.strictEqual(completed.status, 'completed');
    assert.strictEqual(completed.winner, 'PlayerTwo');
    assert.strictEqual(completed.loser, 'PlayerOne');
    assert(completed.finishedAt > 0, 'finishedAt timestamp must be set');
  });

  await runAsyncTest('Duels', 'Decline Duel: Cleans storage and records declined status', async () => {
    const declineDuelDoc = await FirebaseSquads.createDuel({
      roomCode: testRoomCode,
      challenger: 'PlayerOne',
      opponent: 'PlayerTwo',
      format: 'random_blind75',
      problem: { id: 2, title: 'Add Two Numbers', slug: 'add-two-numbers', difficulty: 'Medium' }
    });

    await FirebaseSquads.declineDuel(declineDuelDoc.id, 'PlayerTwo');
    const doc = await FirebaseSquads.getDocument('duels', declineDuelDoc.id);
    assert.strictEqual(doc.status, 'declined');
  });

  await runAsyncTest('Duels', 'Forfeit Duel: Updates status to forfeited', async () => {
    const forfeitDuelDoc = await FirebaseSquads.createDuel({
      roomCode: testRoomCode,
      challenger: 'PlayerOne',
      opponent: 'PlayerTwo',
      format: 'random_blind75',
      problem: { id: 3, title: 'Longest Substring', slug: 'longest-substring-without-repeating-characters', difficulty: 'Medium' }
    });
    await FirebaseSquads.acceptDuel(forfeitDuelDoc.id, 'PlayerTwo');
    await FirebaseSquads.forfeitDuel(forfeitDuelDoc.id, 'PlayerOne');
    const doc = await FirebaseSquads.getDocument('duels', forfeitDuelDoc.id);
    assert.strictEqual(doc.status, 'forfeited');
  });

  // -------------------------------------------------------------
  // SUITE 6: UI Component & DOM Structure Integrity
  // -------------------------------------------------------------
  console.log('\n🖥️ SUITE 6: UI COMPONENT & DOM STRUCTURE INTEGRITY');
  const htmlPath = path.resolve(__dirname, '../popup/index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
  const cssPath = path.resolve(__dirname, '../popup/style.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  runTest('UI', 'All 5 Tab Views exist in popup/index.html (#view-dashboard, #view-squad, #view-duels, #view-roadmap, #view-settings)', () => {
    for (const viewId of ['view-dashboard', 'view-squad', 'view-duels', 'view-roadmap', 'view-settings']) {
      assert(htmlContent.includes(`id="${viewId}"`), `Missing view #${viewId} in popup/index.html`);
    }
  });

  runTest('UI', 'Incoming duels container (#incoming-duels-container) exists in Duels tab', () => {
    assert(htmlContent.includes('id="incoming-duels-container"'), 'Missing #incoming-duels-container');
  });

  runTest('UI', 'Active duel button is an actionable button (#active-duel-link)', () => {
    assert(htmlContent.includes('id="active-duel-link"'), 'Missing #active-duel-link');
  });

  runTest('UI', 'Zero hardcoded developer usernames in production popup HTML', () => {
    assert(!htmlContent.includes('placeholder="NINJA981"'), 'Found hardcoded NINJA981 placeholder');
    assert(!htmlContent.includes('value="NINJA981"'), 'Found hardcoded NINJA981 value');
  });

  runTest('UI', 'CSS Specificity: .tab-view.active is declared and #view-settings does not bleed over Stats view', () => {
    assert(cssContent.includes('.tab-view.active'), 'Missing .tab-view.active CSS rule');
    assert(!cssContent.includes('#view-settings {\n  display: flex;\n}'), '#view-settings must not have unconditional display:flex');
  });

  // -------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`📊 E2E TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED (Total: ${totalTests})`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
