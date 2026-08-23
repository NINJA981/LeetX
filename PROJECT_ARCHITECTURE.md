# ⚡ LeetSync Squads — Comprehensive Architecture & Codebase Guide

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
├── firestore.rules                # Firestore security rules (read/write access for squad rooms)
├── popup/
│   ├── index.html                 # Complete popup DOM: Onboarding Gateway, 5-Tab App Container, Drawer, Toasts
│   ├── style.css                  # Design system: Light Mode + Linear/Obsidian Slate Dark Mode ([data-theme="dark"])
│   └── app.js                     # Main popup controller, UI rendering, event listeners, and data binding
├── scripts/
│   ├── background.js              # Manifest V3 service worker (alarms, badges, message routing, notifications)
│   ├── content.js                 # Content script injected into leetcode.com (DOM observer, submit interceptor)
│   ├── github.js                  # GitHub API client (ensureRepository, createCommit, device flow, user details)
│   ├── leetcode.js                # LeetCode GraphQL API client (getUserStats, getDailyChallenge, submission history)
│   └── firebase.js                # Real-time Squad Relay (joinOrCreateSquad, addMember, broadcastSolve, sendNudge)
├── styles/
│   └── content.css                # In-page UI enhancements and dopamine celebration animations on leetcode.com
├── assets/
│   ├── data/
│   │   ├── blind75.json           # Canonical Blind 75 dataset (75 problems with id, title, slug, diff, category)
│   │   └── neetcode150.json       # Canonical NeetCode 150 dataset (150 problems across 18 DSA categories)
│   └── icons/
│       ├── icon16.png             # 16x16 toolbar icon
│       ├── icon48.png             # 48x48 extensions management icon
│       └── icon128.png            # 128x128 high-res store icon & desktop notification avatar
├── dist/
│   └── leetsync-squads-v1.0.0.zip # Production distribution package for Chrome Web Store & direct sharing
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
  3. The user clicks **"1. Open GitHub & Generate Token ↗"**, which opens `https://github.com/settings/tokens/new?description=LeetSync+Squads&scopes=repo` in a new tab with pre-checked scopes.
  4. The user pastes their token into `#input-onboard-token` and clicks **"Unlock ⚡"**.
  5. `handleLinkToken(token)` verifies the token via `GitHubAPI.getUser()`, calls `GitHubAPI.ensureRepository('leetcode-submissions')` (which auto-creates the repo if missing), saves credentials to `chrome.storage.local`, and unlocks the full 5-tab companion dashboard!

---

### 📊 Subsystem 2: Continuous Stats Dashboard & Authentic Metrics
- **Source Files**: `popup/index.html` (`#view-dashboard`), `popup/app.js` (`loadStoredState`, `performSolutionSync`), `scripts/leetcode.js`.
- **How It Works**:
  1. **Daily Momentum Hero**: Displays dynamic consecutive day streak (`0` on fresh install), active 7-day strip (Mon-Sun), and completion status (`Pending ⏳` or `Completed ✓`).
  2. **Progress Donut Chart**: Pure SVG multi-segment donut chart visualizing Easy (Emerald), Medium (Amber), and Hard (Rose) problem breakdown.
  3. **Deterministic Insights**: Analyzes user progress to suggest optimal focus areas (e.g., *Arrays & Trees*).
  4. **Next Challenge Launcher**: Queries LeetCode's active daily coding challenge and launches it with 1 click.
  5. **1-Click Solution Sync**: Scans all 113+ historical LeetCode submissions via GraphQL and updates local storage and GitHub repository records.

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

### 👥 Subsystem 4: Multiplayer Squad Rooms & 1v1 Duels
- **Source Files**: `popup/index.html` (`#view-squad`, `#view-duels`), `popup/app.js` (`renderSquadView`), `scripts/firebase.js`.
- **How It Works**:
  1. **Room Codes**: 6-character room codes (e.g. `#ALGO99`).
  2. **Cloud Relay + Local Cache**: `FirebaseSquads` syncs squad rooms via GitHub Gist cloud relay when authenticated, falling back to local storage cache.
  3. **Live Leaderboard**: Displays squad mates, daily solve indicators (`✓ Done` / `⏳ Pending`), active flame streaks (`🔥 12d`), and `👋 Nudge` action buttons.
  4. **Adding Members**: Friends can join by entering `#CODE` or by adding their username directly via `+ Add friend @username`.
  5. **1v1 Duels**: Select a squad mate and challenge them to a live problem speed race with live HUD countdown timers.

---

### 🔔 Subsystem 5: Native Desktop & Squad Solve Notifications
- **Source Files**: `manifest.json` (`notifications`), `scripts/background.js` (`sendDesktopNotification`), `popup/app.js`.
- **How It Works**:
  1. **GitHub Solution Sync**: Native desktop notification when an accepted submission is committed to GitHub (`#1927 Sum Game synced to GitHub! +50 XP`).
  2. **Squad Solve Alerts**: When a squad mate solves a problem, peer members receive desktop alerts (`@Alex_Dev solved #347 Top K Frequent Elements! 🔥 12d`).
  3. **Granular Privacy Settings**: Inside **Settings ➔ NOTIFICATIONS & SQUAD PRIVACY**, users have 3 independent toggles:
     - `Desktop Notifications` (Master toggle)
     - `Notify on Squad Solves` (Receive peer solve alerts)
     - `Share My Solves with Squad` (Broadcast own accepted solves)

---

### 🌙 Subsystem 6: Eye-Friendly Theme Engine
- **Source Files**: `popup/style.css`, `popup/app.js` (`applyStoredTheme`).
- **How It Works**:
  - CSS variables on `:root` and `[data-theme="dark"]`.
  - **Light Mode**: Pure white canvas (`#FFFFFF`), subtle slate borders (`#E2E8F0`), high-contrast dark badges (`#0F172A`).
  - **Dark Mode**: Deep Obsidian Slate (`#0F172A`), card surface (`#1E293B`), borders (`#334155`), text (`#F8FAFC`). Zero harsh pure black or jarring neon.
  - Switcher in **Settings ➔ APPEARANCE** persists `theme_preference` in `chrome.storage.local`.

---

## 📚 4. Class & Function API Reference

### `scripts/github.js` (`GitHubAPI`)
- `constructor(token)`: Initializes GitHub API instance with Bearer token.
- `async request(endpoint, options)`: Wrapper around `fetch('https://api.github.com' + endpoint)` with JSON handling.
- `async getUser()`: Fetches authenticated user info (`/user`).
- `async getUserRepos()`: Lists authenticated user's repositories (`/user/repos`).
- `async ensureRepository(repoName)` *(instance)*: Verifies repo exists; auto-creates with description if 404.
- `static async ensureRepository(repoName, token)` *(static)*: Static helper wrapper.
- `async createCommit(repo, path, content, message)`: Pushes a file commit to the specified repository.
- `static async requestDeviceCode()`: Initiates GitHub OAuth Device Code Flow.

### `scripts/leetcode.js` (`LeetCodeAPI`)
- `static async query(query, variables)`: Sends GraphQL POST to `https://leetcode.com/graphql` with `credentials: 'include'`. Returns `data` or `null` without throwing unhandled exceptions.
- `static async getCurrentUser()`: Queries active browser session on LeetCode (`userStatus.username`).
- `static async getUserStats(username)`: Queries public solve counts (`all`, `easy`, `medium`, `hard`) and streak calendar.
- `static async getDailyChallenge()`: Queries active daily coding challenge (`id`, `title`, `slug`, `difficulty`, `url`, `topics`).
- `static async fetchAllAcceptedSubmissions(onProgress)`: Paginates through `submissionList` to collect all unique accepted solutions.

### `scripts/firebase.js` (`FirebaseSquads`)
- `static cleanCode(code)`: Normalizes room code string (e.g. `#algo99` ➔ `ALGO99`).
- `static async fetchRemoteSquad(roomCode)`: Retrieves squad room JSON from remote cloud relay or Gist.
- `static async saveRemoteSquad(roomCode, squadObj)`: Saves squad room JSON to cloud relay and `chrome.storage.local`.
- `static async joinOrCreateSquad(roomCode, userProfile)`: Upserts user profile in the squad and updates activity feed.
- `static async addMemberToSquad(roomCode, peerUsername)`: Adds a friend by handle to the squad.
- `static async sendNudge(roomCode, targetUsername, fromUsername)`: Records a nudge event in the squad activity feed.
- `static async broadcastSolve(roomCode, username, problemData, currentStreak)`: Records a solve event and increments member solve count.

### `popup/app.js`
- `applyStoredTheme()`: Reads `theme_preference` and sets `data-theme` attribute on `body`.
- `checkAuthAndInitialize()`: Gatekeeper between `#onboarding-container` and `#app-container`.
- `handleLinkToken(token)`: Verifies token, provisions repo, and unlocks extension.
- `performSolutionSync(source)`: Global solution backfill & stats synchronization engine.
- `loadStoredState()`: Loads streaks, XP, repo metadata, and schedules from `chrome.storage.local`.
- `renderWeekStrip(streak, todayDone)`: Draws the 7-day Monday–Sunday activity dots.
- `loadDailyChallenge()`: Populates today's challenge card.
- `loadRoadmap(type)`: Switches between `blind75` and `neetcode150`.
- `renderRoadmapList(category)`: Filters and renders roadmap problem rows.
- `updateNextRecommendation()`: Computes and renders the *Next For You* card.
- `openProblemDrawer(problem)`: Opens problem details, approach notes, and spaced review scheduler.
- `renderSquadView()`: Renders room code, leaderboard rows, and activity feed.
- `loadDuelStats()`: Renders win/loss duel record.
- `showToast(text)`: Displays in-app temporary toast notification.
- `setupEventListeners()`: Binds all click, input, change, and toggle listeners.

---

## 🗄️ 5. State Management Schema (`chrome.storage.local`)

| Storage Key | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `github_token` | `string` | `null` | GitHub Personal Access Token (with `repo` scope). |
| `github_repo_owner` | `string` | `null` | GitHub account handle (e.g. `NINJA981`). |
| `github_repo_name` | `string` | `'leetcode-submissions'` | Connected backup repository name. |
| `display_name` | `string` | `'NINJA981'` | Squad profile display name. |
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
| `theme_preference` | `string` | `'light'` | `'light'` or `'dark'`. |
| `notifications_enabled` | `boolean` | `true` | Master toggle for desktop notifications. |
| `notify_squad_solves_enabled` | `boolean` | `true` | Receive alerts when squad mates solve problems. |
| `share_solves_enabled` | `boolean` | `true` | Broadcast own accepted solves to squad room. |
| `review_schedule` | `object` | `{}` | Spaced review dictionary `{ slug: { id, title, dueDate } }`. |
| `duel_wins` | `number` | `0` | Total 1v1 duel victories. |
| `duel_matches` | `number` | `0` | Total 1v1 duel matches played. |

---

## 🧪 6. Verification, Testing & Packaging Commands

### Run Automated Unit Tests:
```powershell
Set-Location 'X:\Projects\leetsync-squads'
python -m unittest discover tests
```

### Validate JavaScript Syntax:
```powershell
node --check 'X:\Projects\leetsync-squads\popup\app.js'
node --check 'X:\Projects\leetsync-squads\scripts\background.js'
node --check 'X:\Projects\leetsync-squads\scripts\firebase.js'
node --check 'X:\Projects\leetsync-squads\scripts\github.js'
node --check 'X:\Projects\leetsync-squads\scripts\leetcode.js'
```

### Package Production ZIP:
```powershell
python -c "
import zipfile, shutil, os
from pathlib import Path
ext_dir = Path('X:/Projects/leetsync-squads')
output_zip = ext_dir / 'dist/leetsync-squads-v1.0.0.zip'
items = ['manifest.json', 'popup', 'scripts', 'styles', 'assets', 'README.md', 'firebase.json', 'firestore.rules']
with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as z:
    for item in items:
        p = ext_dir / item
        if p.is_file(): z.write(p, arcname=item)
        elif p.is_dir():
            for f in p.rglob('*'):
                if f.is_file() and not f.name.startswith('.'):
                    z.write(f, arcname=str(f.relative_to(ext_dir)))
downloads_zip = Path(os.environ.get('USERPROFILE', 'C:/Users/saich')) / 'Downloads/leetsync-squads-v1.0.0.zip'
shutil.copy2(output_zip, downloads_zip)
print('Packaged & copied to Downloads successfully.')
"
```

---

<div align="center">
  <sub>Document generated for LeetSync Squads • Repository: <a href="https://github.com/NINJA981/leetsync-squads">NINJA981/leetsync-squads</a></sub>
</div>
