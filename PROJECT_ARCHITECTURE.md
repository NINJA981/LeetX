# ⚡ LeetX — Comprehensive Architecture & Codebase Guide

> **Developer & AI Agent Handoff Document**
> This guide details the complete project directory structure, subsystem workflows, function signatures, storage schemas, and developer workflows so any AI agent or developer can seamlessly resume development.

---

## 🗺️ 1. Workspace Layout & Separation

This environment consists of two distinct repositories:

1. **`leetcode-submissions` (`X:\Projects\leetcode`)**:
   - Target backup repository for solutions, problem descriptions, and test CLI scripts.
2. **`leetsync-squads` (`X:\Projects\leetsync-squads`)**:
   - The production Manifest V3 browser extension codebase.
   - Remote Git Repository: [`https://github.com/NINJA981/leetsync-squads`](https://github.com/NINJA981/leetsync-squads)

---

## 📁 2. Complete Project Directory Tree

```
X:\Projects\leetsync-squads/
├── manifest.json                  # Manifest V3 configuration (permissions, service worker, icons, content scripts)
├── README.md                      # Public project documentation & 10-second installation guide
├── PROJECT_ARCHITECTURE.md        # Comprehensive technical architecture & handoff guide (This file)
├── firebase.json                  # Firebase deployment configuration for Firestore rules
├── firestore.rules                # Firestore security rules (read/write access for squad rooms & duels)
├── .firebaserc                    # Firebase project identifier mapping (leetsync-squads-app)
├── popup/
│   ├── index.html                 # Complete popup DOM: Onboarding Gateway, 5-Tab App Container, Drawer, Toasts
│   ├── style.css                  # Design system: Light Mode + Linear/Obsidian Slate Dark Mode ([data-theme="dark"])
│   └── app.js                     # Main popup controller, UI rendering, event listeners, and data binding
├── scripts/
│   ├── background.js              # Manifest V3 service worker (alarms, async GitHub sync engine, notifications, routing)
│   ├── content.js                 # Content script injected into leetcode.com (DOM observer, in-page session syncer, confetti)
│   ├── github.js                  # GitHub API client (ensureRepository, Git Trees commit, difficulty folders, README catalog)
│   ├── leetcode.js                # LeetCode GraphQL API client (getUserStats, getDailyChallenge, submission history)
│   ├── firebase.js                # Real-time Squad Relay (joinOrCreateSquad, leadership, kick/leave, 25 challenge cycler, 1v1 duels)
│   └── package.py                 # Automated build script (reads manifest version, builds dist zip, copies to Downloads)
├── styles/
│   └── content.css                # In-page UI enhancements, confetti canvas, and victory toast banners on leetcode.com
├── assets/
│   ├── data/
│   │   ├── blind75.json           # Canonical Blind 75 dataset (75 problems with id, title, slug, diff, category)
│   │   └── neetcode150.json       # Canonical NeetCode 150 dataset (150 problems across 18 DSA categories)
│   └── icons/
│       ├── icon16.png             # 16x16 toolbar icon
│       ├── icon48.png             # 48x48 extensions management icon
│       └── icon128.png            # 128x128 high-res store icon & desktop notification avatar
├── dist/
│   ├── leetsync-squads-v1.1.2.zip         # Current versioned production Chrome/Edge/Brave package
│   └── leetsync-squads-firefox-v1.1.2.zip # Current versioned production Firefox AMO package
├── scratch/
│   ├── feature_verification.js    # Comprehensive automated 39-assertion test suite
│   └── clean_firestore.js         # Full Firestore database purge utility
└── tests/
    └── test_extension.py          # Python unittest test suite verifying manifest, datasets, and scripts
```

---

## ⚙️ 3. Core Subsystems & How They Work

### 🚪 Subsystem 1: First-Time Onboarding Gateway & Auth Gatekeeper
- **Source Files**: `popup/index.html`, `popup/app.js` (`checkAuthAndInitialize`, `handleLinkToken`).
- **How It Works**:
  1. On popup open, `checkAuthAndInitialize()` queries `chrome.storage.local.get(['github_token'])`.
  2. If `!github_token`, the main dashboard (`#app-container`) is completely hidden, and the `#onboarding-container` is displayed.
  3. The user clicks **"1. Open GitHub & Generate Token ↗"**, opening `https://github.com/settings/tokens/new?description=LeetSync+Squads&scopes=repo` in a new tab with pre-checked scopes.
  4. The user pastes their token into `#input-onboard-token` and clicks **"Unlock ⚡"**.
  5. `handleLinkToken(token)` verifies the token via `GitHubAPI.getUser()`, calls `GitHubAPI.ensureRepository('leetcode-submissions')` (which auto-creates the repo if missing), saves credentials to `chrome.storage.local`, and unlocks the full 5-tab companion dashboard!

---

### 📊 Subsystem 2: Continuous Stats Dashboard & Authentic Metrics
- **Source Files**: `popup/index.html` (`#view-dashboard`), `popup/app.js` (`loadStoredState`, `fetchAndUpdateUserStats`), `scripts/leetcode.js`, `scripts/content.js`.
- **How It Works**:
  1. **Daily Momentum Hero**: Displays dynamic consecutive day streak (`0` on fresh install), active 7-day strip (Mon-Sun), and completion status (`Pending ⏳` or `Completed ✓`).
  2. **In-Page Live Session & Stats Syncer (`content.js`)**:
     - Runs natively inside `leetcode.com` with authenticated session cookies.
     - Scrapes and queries authenticated username handle and solve metrics.
     - Automatically updates `chrome.storage.local` on page load and submission acceptance.
  3. **Progress Donut Chart**: Pure SVG multi-segment donut chart visualizing Easy (Emerald), Medium (Amber), and Hard (Rose) problem breakdown.
  4. **Smart DSA Focus Coaching**: Dynamically analyzes user's solved roadmap categories and highlights least-completed topics (e.g. *Arrays & Trees*, *Dynamic Programming*).
  5. **Next Challenge Launcher**: Queries LeetCode's active daily coding challenge and launches it with 1 click.

---

### 🗺️ Subsystem 3: Curated Roadmaps (Blind 75 vs NeetCode 150)
- **Source Files**: `popup/index.html` (`#view-roadmap`), `popup/app.js` (`loadRoadmap`, `renderRoadmapList`, `updateNextRecommendation`), `assets/data/blind75.json`, `assets/data/neetcode150.json`.
- **How It Works**:
  1. **Segmented Switcher**: High-contrast toggle between **Blind 75 (75 problems)** and **NeetCode 150 (150 problems)**.
  2. **Canonical Datasets**: `blind75.json` contains 75 curated problems; `neetcode150.json` contains 150 problems across 18 DSA categories.
  3. **Horizontal Category Pill Strip**: Filter buttons (`All`, `Arrays`, `Pointers`, `Window`, `Stack`, `Binary`, `Trees`, `DP`...) with smooth overflow scrolling.
  4. **Next For You**: Automatically analyzes `userSolvedSlugs` and points to the next unsolved problem in the active roadmap.
  5. **Notes & Spaced Review Drawer**: Clicking 📝 on any problem opens a slide-over sheet to write personal approach notes and schedule spaced revisit reminders (`+3d`, `+7d`, `+14d`, `+30d`).

---

### 👥 Subsystem 4: Multiplayer Squad Rooms, Leadership & 25-Challenge Cycler
- **Source Files**: `popup/index.html` (`#view-squad`), `popup/app.js` (`renderSquadView`), `scripts/firebase.js`.
- **How It Works**:
  1. **Collision-Free 6-Character Room Codes**: Users click **+ New** to generate a unique, unambiguous 6-character room code (e.g. `#K9X2P4`, excluding confusing characters `0/O/1/I`) verified against Firestore.
  2. **Code-Only Invites**: Joining and inviting is strictly code-based (1-click **Copy Code** button).
  3. **Squad Leadership & Management Mode**:
     - Room creator is recorded as `squad.owner` (Squad Leader with `👑 Leader` tag).
     - The leader has an interactive **`✏️ Edit Squad`** toggle.
     - In normal view, leaderboard rows are clean and uncluttered.
     - In Edit Mode, `✕ Remove` kick buttons appear next to squad members, allowing the leader to remove members via `FirebaseSquads.kickMember()`.
  4. **Leave Squad**: Members can leave a room at any time via `FirebaseSquads.leaveSquad()`. If the leader leaves, leadership automatically transfers to the next senior member.
  5. **Live Leaderboard & Peer Nudges**: Real-time member stats, daily solve badges (`✓ Done` / `⏳ Pending`), active streaks (`🔥 12d`), and interactive `👋 Nudge` actions.
  6. **25 Squad Challenges Engine**:
     - Curated pool of 25 diverse team challenges across DP, Graphs, Trees, Heaps, Stacks, Blind 75, NeetCode 150, and Speed Sprints.
     - Strict condition matching via `FirebaseSquads.isSolveMatchingChallenge()` ensures only problems that genuinely match the active category increment the challenge tracker.
     - When the target is cleared, bonus XP (+100 to +250 XP) is awarded to all squad members, a celebration event is posted to the activity feed, and the room automatically cycles to a new random challenge without immediate repetition.
  7. **Clear Activity Feed Button**: Clicking **`Clear ✕`** in the activity header resets the on-screen feed, clears Firestore feed logs, and resets challenge progress back to `0 / Target`.

---

### ⚔️ Subsystem 5: 1v1 Algorithmic Duels & Matchmaking
- **Source Files**: `popup/index.html` (`#view-duels`), `popup/app.js` (`renderDuelsView`), `scripts/background.js`, `scripts/firebase.js`, `scripts/content.js`.
- **How It Works**:
  1. **Dispatched Challenges**: Challenger selects an opponent and format (Random Blind 75, NeetCode 150, Daily, Easy sprint, Hard boss fight).
  2. **Background Desktop Alerts**: When a challenge is dispatched, the opponent's device receives a native desktop notification (`⚔️ 1v1 Duel Challenge from @challenger`).
  3. **Concealed Problem & Disabled Links (Pending)**: While waiting for acceptance, the problem title shows `🔒 Problem Hidden (Reveals on Accept)`, the LeetCode link is disabled, and the stopwatch is held at `00:00 (Starts on Accept)`.
  4. **Multi-Invite Queue**: On the Duels page, `#incoming-duels-container` dynamically renders cards for **all** pending incoming invitations with individual `[ Accept ⚔️ ]` and `[ Decline ]` buttons.
  5. **Acceptance & Simultaneous Reveal**: When accepted, a desktop alert is dispatched (`⚔️ DUEL MATCH STARTED! Problem revealed: ...`), the timer begins ticking synchronously for both players, and the problem link unlocks.
  6. **Instant 0ms Cache Load**: Reopening the extension immediately renders the active duel HUD from `chrome.storage.local` cache, completely eliminating any loading latency or flash of the setup form.
  7. **Single-Click Match Dismissal**: The "Start New Match" button immediately clears completed match state in a single click without redundant re-renders.
  8. **Atomic First-to-Submit Resolution**:
     - The instant LeetCode returns "Accepted", `content.js` dispatches `SYNC_SUBMISSION` to `background.js`.
     - The first solver to reach Firestore claims `winner = username` and completes the match.
     - Winner receives +50 XP, runner-up receives +15 XP, confetti explodes on the winner's LeetCode tab, and the match results update live.

---

### ⚡ Subsystem 6: GitHub Directory Organization & README Catalog
- **Source Files**: `scripts/background.js` (`startAsyncGitHubSync`), `scripts/github.js`, `popup/app.js` (`performSolutionSync`, `renderSyncStatusUI`).
- **How It Works**:
  1. **Difficulty-Based Zero-Padded Directory Structure**:
     - Solutions are organized into clean difficulty tiers with 4-digit zero-padded problem IDs:
       - `Easy/0001-two-sum/README.md` & `solution.py`
       - `Medium/0049-group-anagrams/README.md` & `solution.py`
       - `Hard/0042-trapping-rain-water/README.md` & `solution.py`
     - The root repository view displays only `Easy/`, `Medium/`, `Hard/`, and `README.md`.
  2. **Multi-Tier README Difficulty Resolver**:
     - `updateCatalogReadme()` dynamically parses problem difficulties using:
       1. Folder prefix tier (`Easy/`, `Medium/`, `Hard/`).
       2. Git blob README badge regex (`Difficulty-Easy`, `Difficulty-Medium`, `Difficulty-Hard`).
       3. LeetCode GraphQL query fallback.
     - Clicking "Sync All Solutions Now" always regenerates the root README catalog even if 0 new problems were committed.
  3. **Detached Background Execution**:
     - The service worker processes the entire backfill asynchronously in the background.
     - **Popup Closure Resilience**: The user can close the extension popup or switch tabs; the sync continues without interruption.
  4. **Live UI Status Streaming**:
     - Progress (`pct`, `current`, `total`, `message`) is persisted in `chrome.storage.local.sync_status`.
     - Open popups reactively stream the real-time progress bar and commit status via `chrome.storage.onChanged`.
  5. **Git Trees Direct Commit Engine**:
     - Commits problem descriptions and solutions atomically with exact runtime (ms), memory (MB), and percentile rankings.
     - Uses `force: true` branch ref updates, a 3-attempt auto-retry loop with cache-busted SHA queries (`?_cb=${Date.now()}`), and 150ms batch commit pacing to prevent GitHub `422: Update is not a fast forward` errors.

---

## 📚 4. Class & Function API Reference

### `scripts/github.js` (`GitHubAPI`)
- `constructor(token)`: Initializes GitHub API instance with Bearer token.
- `async request(endpoint, options)`: Wrapper around `fetch('https://api.github.com' + endpoint)` with JSON handling.
- `async getUser()`: Fetches authenticated user info (`/user`).
- `async getUserRepos()`: Lists authenticated user's repositories (`/user/repos`).
- `async ensureRepository(repoName)` *(instance)*: Verifies repo exists; auto-creates with description if 404.
- `static async ensureRepository(repoName, token)` *(static)*: Static helper wrapper.
- `async commitProblemSolution(owner, repo, payload)`: Commits solution into `Easy/`, `Medium/`, or `Hard/` directory with zero-padded problem IDs.
- `async updateCatalogReadme(owner, repo, branch)`: Regenerates and commits the root `README.md` problem table with multi-tier difficulty resolution.
- `async getExistingProblemSlugs(owner, repo, branch)`: Scans repository tree to find all existing solution folders across all difficulty directories.
- `static async requestDeviceCode()`: Initiates GitHub OAuth Device Code Flow.
- `static async pollForAccessToken(deviceCode)`: Polls for OAuth token during device flow.

### `scripts/leetcode.js` (`LeetCodeAPI`)
- `static async query(query, variables)`: Sends authenticated GraphQL POST to `https://leetcode.com/graphql` with cookies.
- `static async getCurrentUser()`: Queries active browser session on LeetCode (`userStatus.username`).
- `static async getUserStats(username)`: Queries solve counts (`all`, `easy`, `medium`, `hard`) and streak calendar.
- `static async getDailyChallenge()`: Queries active daily coding challenge (`id`, `title`, `slug`, `difficulty`, `url`, `topics`).
- `static async fetchAllAcceptedSubmissions(onProgress, username)`: Paginates through `submissionList` to collect all accepted solutions.
- `static async getSubmissionDetails(submissionId)`: Fetches full solution code, runtime metrics, and problem description.
- `static async getQuestionDetails(titleSlug)`: Fetches complete question metadata and topic tags.

### `scripts/firebase.js` (`FirebaseSquads`)
- `static cleanCode(code)`: Normalizes room code string (e.g. `#algo99` ➔ `ALGO99`).
- `static generateRandomCode(length)`: Generates unambiguous random string (excludes `0/O/1/I`).
- `static async generateUniqueRoomCode()`: Generates and checks Firestore to ensure collision-free 6-char room code.
- `static getRandomChallenge(excludeId)`: Randomly selects a challenge from the 25 pool without immediate repetition.
- `static isSolveMatchingChallenge(challenge, problemData)`: Strictly validates whether a solve satisfies challenge category rules.
- `static async joinOrCreateSquad(roomCode, userProfile)`: Upserts user profile in the squad and records room creator as `squad.owner`.
- `static async leaveSquad(roomCode, username)`: Removes user from squad and reassigns leadership if leader leaves.
- `static async kickMember(roomCode, targetUsername, actorUsername)`: Allows squad leader to remove a member.
- `static async sendNudge(roomCode, targetUsername, fromUsername)`: Records a nudge event in the squad activity feed.
- `static async broadcastSolve(roomCode, username, problemData, currentStreak)`: Records solve, updates member stats, and advances matching challenge.
- `static async clearActivityFeed(roomCode)`: Clears squad activity feed and resets challenge progress back to `0`.
- `static async createDuel({ roomCode, challenger, opponent, format, problem })`: Creates match document in `duels/{duelId}`.
- `static async acceptDuel(duelId, username)`: Activates duel match, sets `startedAt`, reveals problem, and posts `duel_accepted`.
- `static async declineDuel(duelId, username)`: Declines incoming duel invite.
- `static async forfeitDuel(duelId, username)`: Forfeits match and awards win to opponent.
- `static async submitDuelSolve(duelId, username, runtimeData)`: Concludes duel, sets winner, and awards +50 XP.
- `static async checkDuelStatus(username, roomCode)`: Syncs active match and collects all incoming duel challenges.

### `scripts/package.py`
- `package_extension(bump)`: Reads current version from `manifest.json`, optionally bumps semver (`patch`, `minor`, `major`), builds `dist/leetsync-squads-v<version>.zip` and `dist/leetsync-squads-firefox-v<version>.zip`, and copies both to `~/Downloads/`.

---

## 🗄️ 5. State Management Schema (`chrome.storage.local`)

| Storage Key | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `github_token` | `string` | `null` | GitHub Personal Access Token (with `repo` scope). |
| `github_repo_owner` | `string` | `null` | Primary GitHub handle and default multiplayer identity. |
| `github_repo_name` | `string` | `'leetcode-submissions'` | Connected backup repository name. |
| `display_name` | `string` | `null` | Squad profile display name fallback. |
| `leetcode_username` | `string` | `null` | LeetCode handle for live profile metrics. |
| `streak_count` | `number` | `0` | Consecutive active streak days. |
| `user_xp` | `number` | `0` | Total user gamification XP. |
| `today_solved` | `number` | `0` | Number of problems solved today. |
| `last_solved_date` | `string` | `null` | `YYYY-MM-DD` string of last solve. |
| `user_solved_slugs`| `string[]` | `[]` | Set of unique problem slugs solved by user. |
| `solved_easy_count`| `number` | `0` | Total Easy problems solved. |
| `solved_med_count` | `number` | `0` | Total Medium problems solved. |
| `solved_hard_count`| `number` | `0` | Total Hard problems solved. |
| `total_solved` | `number` | `0` | Total problems solved across account. |
| `my_squad_code` | `string` | `'#ALGO99'` | Active Squad Room code. |
| `active_duel` | `object` | `null` | Cached active / pending duel document for 0ms rendering. |
| `incoming_duel` | `object` | `null` | Cached incoming duel invitation document. |
| `sync_status` | `object` | `{ state: 'idle' }` | Background GitHub sync progress object. |
| `target_open_tab` | `string` | `null` | Route target set by notification click (e.g. `'duels'`). |
| `theme_preference` | `string` | `'light'` | `'light'` or `'dark'`. |
| `notifications_enabled` | `boolean` | `true` | Master toggle for desktop notifications. |
| `notify_squad_solves_enabled` | `boolean` | `true` | Receive alerts when squad mates solve problems. |
| `share_solves_enabled` | `boolean` | `true` | Broadcast own accepted solves to squad room. |
| `review_schedule` | `object` | `{}` | Spaced review dictionary `{ slug: { id, title, dueDate } }`. |
| `duel_wins` | `number` | `0` | Total 1v1 duel victories. |
| `duel_matches` | `number` | `0` | Total 1v1 duel matches played. |

---

## 🧪 6. Verification, Testing & Packaging Commands

### Run Automated Feature Verification Suite (39 Subsystem Tests):
```powershell
Set-Location 'X:\Projects\leetsync-squads'
node scratch/feature_verification.js
```

### Run Python Unit Tests:
```powershell
python -m unittest discover tests
```

### Validate JavaScript Syntax:
```powershell
node --check 'X:\Projects\leetsync-squads\popup\app.js'
node --check 'X:\Projects\leetsync-squads\scripts\background.js'
node --check 'X:\Projects\leetsync-squads\scripts\firebase.js'
node --check 'X:\Projects\leetsync-squads\scripts\github.js'
node --check 'X:\Projects\leetsync-squads\scripts\leetcode.js'
node --check 'X:\Projects\leetsync-squads\scripts\content.js'
```

### Purge Firestore Database (Clean Slate Utility):
```powershell
node scratch/clean_firestore.js
```

### Package Production Release ZIP with Semver Bumping:
```powershell
python scripts/package.py patch
```

---

<div align="center">
  <sub>Document maintained for LeetSync Squads • Repository: <a href="https://github.com/NINJA981/leetsync-squads">NINJA981/leetsync-squads</a></sub>
</div>
