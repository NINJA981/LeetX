# ⚡ LeetX Squads — Comprehensive Technical Architecture

> **Developer & AI Agent Handoff Document** · v1.1.2
> A complete technical deep-dive covering system design, data flow diagrams, API contracts, storage schemas, and developer playbooks for every subsystem in LeetX Squads.

---

## 📐 Table of Contents

1. [High-Level System Architecture](#1-high-level-system-architecture)
2. [Project Directory Structure](#2-project-directory-structure)
3. [Extension Layer Architecture](#3-extension-layer-architecture)
4. [Data Flow Diagrams](#4-data-flow-diagrams)
   - [4.1 GitHub Submission Sync Pipeline](#41-github-submission-sync-pipeline)
   - [4.2 Multiplayer Squad Room Lifecycle](#42-multiplayer-squad-room-lifecycle)
   - [4.3 1v1 Duel State Machine](#43-1v1-duel-state-machine)
   - [4.4 Authentication & Onboarding Flow](#44-authentication--onboarding-flow)
   - [4.5 Message Routing Bus](#45-message-routing-bus)
5. [Subsystem Specifications](#5-subsystem-specifications)
6. [API Reference](#6-api-reference)
7. [State Management Schema](#7-state-management-schema)
8. [Firestore Data Model](#8-firestore-data-model)
9. [Squad Challenge Pool](#9-squad-challenge-pool)
10. [Testing & Validation Playbook](#10-testing--validation-playbook)
11. [Release Engineering](#11-release-engineering)

---

## 1. High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LEETX SQUADS v1.1.2                                │
│                     Manifest V3 Browser Extension                           │
└─────────────────────────────────────────────────────────────────────────────┘

  User Browser Context
  ┌────────────────────────────────────────────────────────────────────────┐
  │                                                                        │
  │   ┌─────────────────┐        ┌──────────────────────────────────────┐  │
  │   │   POPUP LAYER   │        │         CONTENT SCRIPT LAYER         │  │
  │   │  popup/app.js   │        │          scripts/content.js          │  │
  │   │  popup/index    │        │   Injected into leetcode.com tabs    │  │
  │   │  popup/style    │        │                                      │  │
  │   │                 │        │  • DOM mutation observer             │  │
  │   │  5 Tab Views:   │        │  • Submission acceptance detector    │  │
  │   │  ├── Stats      │        │  • In-page toast notifications       │  │
  │   │  ├── Squad      │        │  • Confetti canvas on win            │  │
  │   │  ├── Duels      │        │  • Auth session username scraper     │  │
  │   │  ├── Roadmap    │        │  • LeetCode GraphQL API proxy        │  │
  │   │  └── Settings   │        │                                      │  │
  │   └────────┬────────┘        └──────────────┬───────────────────────┘  │
  │            │  chrome.runtime.sendMessage()   │                          │
  │            │ ◄───────────────────────────────┘                          │
  │            │                                                            │
  │   ┌────────▼────────────────────────────────────────────────────────┐  │
  │   │              BACKGROUND SERVICE WORKER                          │  │
  │   │                  scripts/background.js                          │  │
  │   │                                                                  │  │
  │   │  chrome.alarms.onAlarm   chrome.runtime.onMessage               │  │
  │   │  ├── daily_streak_check  ├── PROBLEM_SOLVED / SYNC_SUBMISSION    │  │
  │   │  └── squad_presence_poll ├── GET_DUEL_HISTORY                   │  │
  │   │                          ├── CHECK_DUEL_STATUS                  │  │
  │   │                          ├── BACKFILL_SOLUTIONS                 │  │
  │   │                          └── SEND_DUEL_CHALLENGE                │  │
  │   │                                                                  │  │
  │   │  Imports: GitHubAPI · LeetCodeAPI · FirebaseSquads               │  │
  │   └───┬─────────────────────┬────────────────────────┬─────────────┘  │
  │       │                     │                        │                  │
  └───────┼─────────────────────┼────────────────────────┼──────────────────┘
          │                     │                        │
          ▼                     ▼                        ▼
  ┌───────────────┐   ┌─────────────────┐   ┌──────────────────────────┐
  │   GITHUB API  │   │  LEETCODE API   │   │  GOOGLE CLOUD FIRESTORE  │
  │ api.github.com│   │ leetcode.com/   │   │  firestore.googleapis.com│
  │               │   │ graphql         │   │                          │
  │ • User auth   │   │                 │   │  Collections:            │
  │ • Repo create │   │ • User stats    │   │  ├── squads/{code}       │
  │ • Git Trees   │   │ • Submissions   │   │  └── duels/{duelId}      │
  │ • README sync │   │ • Daily problem │   │                          │
  │ • File reads  │   │ • Problem meta  │   │  Real-time multiplayer   │
  └───────────────┘   └─────────────────┘   └──────────────────────────┘
```

---

## 2. Project Directory Structure

```
X:\Projects\leetsync-squads/
│
├── manifest.json                   # MV3: permissions, alarms, identity, service worker
├── README.md                       # Public documentation & laptop setup guide
├── PROJECT_ARCHITECTURE.md         # This file — full technical architecture reference
├── firebase.json                   # Firebase Hosting/Firestore rules config
├── firestore.rules                 # Firestore read/write security policy
├── .firebaserc                     # Firebase project ID: leetsync-squads-app
├── .gitignore                      # Excludes node_modules, __pycache__, scratch/, old dist/
│
├── popup/                          # ─── POPUP LAYER (visible to user) ───
│   ├── index.html                  # Complete popup DOM (611 lines)
│   │   ├── #onboarding-container   # First-time GitHub auth gateway
│   │   ├── #app-container          # Main 5-tab companion dashboard
│   │   │   ├── #view-dashboard     # Stats, streak, donut, GitHub sync
│   │   │   ├── #view-squad         # Squad rooms, leaderboard, challenges
│   │   │   ├── #view-duels         # 1v1 matchmaking & live HUD
│   │   │   ├── #view-roadmap       # Blind 75 / NeetCode 150 browser
│   │   │   └── #view-settings      # Token, theme, notifications
│   │   └── #problem-drawer         # Slide-over notes & spaced review
│   ├── style.css                   # 2687-line design system
│   │   ├── :root variables         # Light mode tokens
│   │   ├── [data-theme="dark"]     # Obsidian Slate dark mode tokens
│   │   ├── Onboarding screen       # Brand lockup, instructions, CTA
│   │   ├── Tab nav                 # Nav bar, active indicator
│   │   └── All view components     # Cards, leaderboards, duel HUD, roadmap
│   └── app.js                      # Main controller (1800+ lines)
│
├── scripts/                        # ─── LOGIC LAYER (ES Modules) ───
│   ├── background.js               # MV3 Service Worker (740 lines)
│   │   ├── chrome.alarms           # Streak check (hourly) + squad poll (every 1 min)
│   │   ├── chrome.runtime.onMessage# Central message bus router
│   │   ├── sendDesktopNotification # OS native notification dispatcher
│   │   ├── updateDailyStreakState  # Date-rollover streak reconciliation
│   │   └── startAsyncGitHubSync    # Background backfill coordinator
│   ├── content.js                  # LeetCode DOM observer (676 lines)
│   │   ├── __LEETSYNC_SQUADS_INJECTED__ guard
│   │   ├── MutationObserver        # Watches for submission accepted banner
│   │   ├── showVictoryToast        # In-page ⚡ sync toast notification
│   │   ├── launchConfetti          # Canvas confetti on duel win
│   │   └── showInPageAlert         # Duel challenge banner overlay
│   ├── github.js                   # GitHub REST API client (515 lines)
│   │   ├── class GitHubAPI         # Authenticated instance with Bearer token
│   │   ├── request()               # Base fetch wrapper with error handling
│   │   ├── ensureRepository()      # Auto-creates leetcode-submissions repo
│   │   ├── commitProblemSolution() # Git Trees atomic commit (3-retry loop)
│   │   └── updateCatalogReadme()   # Regenerates problem table README
│   ├── leetcode.js                 # LeetCode GraphQL client (450+ lines)
│   │   ├── class LeetCodeAPI       # Static-only method class
│   │   ├── query()                 # Authenticated GraphQL POST with cookies
│   │   ├── getUserStats()          # Solve counts + streak calendar
│   │   ├── getDailyChallenge()     # Today's daily problem
│   │   └── fetchAllAcceptedSubmissions() # Full submission history paginator
│   ├── firebase.js                 # Firestore real-time relay (921 lines)
│   │   ├── class FirebaseSquads    # Static-only method class
│   │   ├── REST primitives         # getDocument, setDocument, deleteDocument
│   │   ├── Squad lifecycle         # joinOrCreateSquad, leaveSquad, kickMember
│   │   ├── Squad challenges        # 25-challenge pool, isSolveMatchingChallenge
│   │   ├── Activity feed           # broadcastSolve, sendNudge, clearActivityFeed
│   │   └── Duel lifecycle          # createDuel, acceptDuel, submitDuelSolve, forfeit
│   └── package.py                  # Release build script (89 lines)
│       └── package_extension(bump) # Builds Chrome + Firefox zip archives
│
├── styles/
│   └── content.css                 # In-page UI styles (injected into leetcode.com)
│       ├── #leetsync-victory-toast # Solve confirmation toast
│       ├── .leetsync-toast-*       # Toast inner components
│       └── @keyframes animations   # Enter/leave slide transitions
│
├── assets/
│   ├── data/
│   │   ├── blind75.json            # 75 problems: {id, title, slug, difficulty, category}
│   │   └── neetcode150.json        # 150 problems across 18 DSA categories
│   └── icons/
│       ├── icon16.png              # Toolbar icon (16×16)
│       ├── icon48.png              # Extensions manager icon (48×48)
│       └── icon128.png             # High-res store & notification icon (128×128)
│
├── dist/                           # Release packages (auto-generated)
│   ├── leetx-v1.1.2.zip            # Chrome / Edge / Brave / Arc MV3
│   └── leetx-firefox-v1.1.2.zip    # Firefox AMO MV3 with scripts fallback
│
├── scratch/
│   ├── feature_verification.js     # 39-assertion automated subsystem test suite
│   └── clean_firestore.js          # Full Firestore database purge utility
│
└── tests/
    ├── e2e_full_suite.js            # 31-test comprehensive E2E test suite
    └── test_extension.py           # 6 Python unit tests (manifest, datasets, scripts)
```

---

## 3. Extension Layer Architecture

LeetX Squads follows the **Manifest V3** architecture with strict separation of concerns across three extension contexts that communicate exclusively via message passing.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  CONTEXT 1: Popup Page                                                   │
│  ┌─────────────┐   Reads/Writes    ┌──────────────────────────────────┐ │
│  │  popup/     │ ◄──────────────── │    chrome.storage.local          │ │
│  │  app.js     │ ────────────────► │    (single source of UI truth)   │ │
│  │             │                   └──────────────────────────────────┘ │
│  │  Triggers   │                                                         │
│  │  chrome.    │ ────────────────► CONTEXT 2 (background.js)            │
│  │  runtime.   │                   via sendMessage()                     │
│  │  sendMessage│                                                         │
│  └─────────────┘                                                         │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  CONTEXT 2: Background Service Worker                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  background.js                                                       │ │
│  │                                                                      │ │
│  │  Receives from Popup:          Receives from Content Script:         │ │
│  │  ┌─────────────────────┐      ┌──────────────────────────────────┐  │ │
│  │  │ BACKFILL_SOLUTIONS  │      │ PROBLEM_SOLVED / SYNC_SUBMISSION  │  │ │
│  │  │ CHECK_DUEL_STATUS   │      │ GET_USER_SESSION                  │  │ │
│  │  │ SEND_DUEL_CHALLENGE │      │ GET_USER_STATS                    │  │ │
│  │  │ GET_DUEL_HISTORY    │      └──────────────────────────────────┘  │ │
│  │  └─────────────────────┘                                             │ │
│  │                                                                      │ │
│  │  Orchestrates:                                                       │ │
│  │  ├── GitHubAPI.commitProblemSolution()   → api.github.com            │ │
│  │  ├── GitHubAPI.updateCatalogReadme()     → api.github.com            │ │
│  │  ├── LeetCodeAPI.getSubmissionDetails()  → leetcode.com/graphql      │ │
│  │  └── FirebaseSquads.*                    → firestore.googleapis.com  │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  CONTEXT 3: Content Script (leetcode.com tabs only)                      │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  content.js                                                          │ │
│  │                                                                      │ │
│  │  Injected at: document_idle                                          │ │
│  │  Matches: https://leetcode.com/problems/*                            │ │
│  │                                                                      │ │
│  │  MutationObserver ────► "Accepted" banner detected                   │ │
│  │                               │                                      │ │
│  │                    chrome.runtime.sendMessage(SYNC_SUBMISSION)       │ │
│  │                               │                                      │ │
│  │                               ▼                                      │ │
│  │              Background.js processes & syncs to GitHub               │ │
│  │                               │                                      │ │
│  │              Background.js responds with SHOW_INPAGE_NOTIFICATION    │ │
│  │                               │                                      │ │
│  │                    showVictoryToast() ◄───────────────────────────── │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Data Flow Diagrams

### 4.1 GitHub Submission Sync Pipeline

```
User solves a LeetCode problem → "Accepted" result page
         │
         ▼
┌─────────────────────────────────────────────┐
│  content.js (MutationObserver)              │
│  Detects "Accepted" banner in DOM           │
│  Extracts: titleSlug, submissionId          │
└──────────────────────┬──────────────────────┘
                       │ chrome.runtime.sendMessage
                       │ { type: 'SYNC_SUBMISSION', ... }
                       ▼
┌─────────────────────────────────────────────┐
│  background.js (Message Handler)            │
│                                             │
│  1. Gets stored { github_token,             │
│                   github_repo_owner,        │
│                   my_squad_code }           │
│                                             │
│  2. Calls LeetCodeAPI.getSubmissionDetails  │
│     → Fetches: code, runtime, memory,       │
│       percentile rankings from GraphQL      │
│                                             │
│  3. Calls LeetCodeAPI.getQuestionDetails    │
│     → Fetches: difficulty, topic tags,      │
│       problem statement HTML                │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  GitHubAPI.commitProblemSolution()          │
│                                             │
│  Builds directory path:                     │
│  Easy/0001-two-sum/                         │
│  ├── README.md  (problem statement)         │
│  └── solution.py (user's code)              │
│                                             │
│  Git Trees API (atomic multi-file commit):  │
│  1. GET /repos/{owner}/{repo}/git/          │
│     ref/heads/main → latest SHA            │
│  2. POST /git/trees (with blobs)            │
│  3. POST /git/commits (backdated timestamp) │
│  4. PATCH /git/refs/heads/main              │
│                                             │
│  Retry Logic: 3 attempts, 400ms backoff     │
│  Cache-bust: ?_cb=Date.now() on SHA queries │
└──────────────┬──────────────────────────────┘
               │
               ├──────────────────────────────────────────────┐
               ▼                                              ▼
┌──────────────────────────────┐             ┌───────────────────────────────┐
│  GitHubAPI.updateCatalog     │             │  FirebaseSquads.broadcastSolve│
│  Readme()                    │             │                               │
│                              │             │  • Updates member's stats     │
│  Scans repo tree for all     │             │  • Increments challenge count │
│  problems → builds sorted    │             │  • Awards squad XP if goal met│
│  Markdown table → commits to │             │  • Posts to squad activity    │
│  README.md                   │             │    feed (solve event)         │
└──────────────────────────────┘             └───────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  background.js → content.js                 │
│  chrome.tabs.sendMessage(SHOW_INPAGE_NOTIF) │
│                                             │
│  content.js renders:                        │
│  🔥 LeetX Squads                            │
│  ⚡ Synced                                  │
│  ⏱️ 35ms (Beats 98.4%) | 🧠 16.4MB (82.1%) │
└─────────────────────────────────────────────┘
```

---

### 4.2 Multiplayer Squad Room Lifecycle

```
                        SQUAD ROOM LIFECYCLE
                        ─────────────────────

  Player A                 Firestore                Player B
  ─────────                ─────────                ─────────

  Click "+ New"
       │
       ▼
  generateUniqueRoomCode()
  ├── generateRandomCode(6)
  │   charset: [2-9A-HJ-NP-Z]
  │   excludes: 0, O, 1, I
  └── fetchRemoteSquad()
      → 404? → code is free!
       │
       ▼
  joinOrCreateSquad()  ──────────────────►  squads/K9X2P4
       │               creates document     {
       │                                      owner: "AliceGH",
       │                                      members: [{
  User copies #K9X2P4                           username, streak,
  and shares with B                             todaySolved, xp
                                              }],
                                              challenge: {
                                                id, name, category,
                                                target: 5, progress: 0
                                              },
                                              activityFeed: [],
                                              lastActive: timestamp
                                            }
                                                │
                        ◄───────────────────────┘
  Alice's Squad tab           background.js squad_presence_poll
  renders live:               (every 60 seconds)
  ┌────────────────┐
  │ SQUAD ROOM     │          Player B types #K9X2P4
  │ #K9X2P4        │          and clicks Join
  │                │                │
  │ 👑 AliceGH     │                ▼
  │ 🔥 12d ✓ Done  │          joinOrCreateSquad()  ──►  squads/K9X2P4
  │                │          (upsert BobDev)            members: [Alice, Bob]
  │ 🏆 CHALLENGE   │
  │ Solve 5 Trees  │◄─────────────────────────────────  live poll update
  │ ████░░  3/5    │
  └────────────────┘

  ──── SQUAD EVENTS ────────────────────────────────────────────────────────

  Alice solves a Tree problem
       │
       ▼
  background.js → FirebaseSquads.broadcastSolve()
       │
       ├── Updates Alice's member stats (todaySolved, streak, xp)
       ├── isSolveMatchingChallenge(challenge, {category: "Trees"})
       │   ✓ MATCH → challenge.progress = 4 → saved to Firestore
       └── Posts activityFeed: { type: "solve", username: "Alice", ... }

  Alice sends a Nudge to Bob
       │
       └── FirebaseSquads.sendNudge() → activityFeed: { type: "nudge", ... }
           Bob's poll fetches update → desktop notification: "👋 Nudge from Alice!"

  Challenge Progress = 5/5 → AUTO-CYCLE
       │
       ├── Awards all members +100 XP
       ├── activityFeed: { type: "challenge_complete" }
       └── getRandomChallenge(excludeId) → new random challenge (no repeats)
```

---

### 4.3 1v1 Duel State Machine

```
    ┌─────────────────────────────────────────────────────────────┐
    │                   DUEL STATE MACHINE                         │
    └─────────────────────────────────────────────────────────────┘

    ● START
        │
        ▼
    ┌─────────┐
    │ IDLE    │  No active match. Challenger selects opponent + format
    │         │  from squad member dropdown
    └────┬────┘
         │ createDuel()
         │ Writes to duels/{duelId}:
         │ { status: "pending", challenger, opponent,
         │   problem: {...}, revealed: false }
         │ Posts duel_challenge to squad activityFeed
         ▼
    ┌─────────────────────────────────────────────────────────────┐
    │ PENDING                                                      │
    │                                                              │
    │  Challenger View:           Opponent View (poll detects):   │
    │  ┌──────────────────┐       ┌─────────────────────────────┐ │
    │  │ ⚔️ Duel Pending  │       │ 📩 INCOMING CHALLENGE       │ │
    │  │ 🔒 Problem Hidden │       │ from @Alice                │ │
    │  │ Waiting for Bob  │       │ Format: Blind 75 Random     │ │
    │  │ ⏱️ 00:00          │       │ [ Accept ⚔️ ] [ Decline ]   │ │
    │  └──────────────────┘       └─────────────────────────────┘ │
    └───────────┬────────────────────────────┬────────────────────┘
                │ acceptDuel()               │ declineDuel()
                │                            │
                ▼                            ▼
    ┌─────────────────────┐          ┌──────────┐
    │ ACTIVE              │          │ DECLINED │ → duels/{id}.status = "declined"
    │                     │          └──────────┘
    │ Both players see:   │
    │ • Problem revealed  │
    │ • Direct LC link    │
    │ • Timer ticking     │
    │ • startedAt set     │
    └──────────┬──────────┘
               │
         ┌─────┴──────┐
         │            │
         ▼            ▼
    submitDuelSolve() forfeitDuel()
         │                │
         ▼                ▼
    ┌──────────┐    ┌──────────┐
    │COMPLETED │    │FORFEITED │
    │          │    │          │
    │ winner   │    │ winner = │
    │ +50 XP   │    │ opponent │
    │ loser    │    │          │
    │ +15 XP   │    └──────────┘
    │ confetti │
    └──────────┘

    Status transitions (Firestore duels/{id}.status):
    "pending" → "active" → "completed"
                        → "forfeited"
             → "declined"
```

---

### 4.4 Authentication & Onboarding Flow

```
    Extension Icon Clicked
           │
           ▼
    checkAuthAndInitialize()
           │
    chrome.storage.local.get(['github_token'])
           │
    ┌──────┴──────┐
    │             │
    token?       no token
    │             │
    ▼             ▼
  UNLOCK       ONBOARDING GATEWAY
  dashboard    ┌──────────────────────────────────────┐
               │  ⚡ LeetX SQUADS                      │
               │                                      │
               │  Step 1: Click button                │
               │  → Opens github.com/settings/tokens  │
               │    with scopes=repo pre-checked      │
               │                                      │
               │  Step 2: Copy token (ghp_...)         │
               │                                      │
               │  Step 3: Paste & Unlock              │
               └──────────────────────────────────────┘
                              │
                              ▼
                    handleLinkToken(token)
                              │
                    GitHubAPI.getUser()  ──────► api.github.com/user
                    ├── success? → continue
                    └── failure? → show error
                              │
                    GitHubAPI.ensureRepository('leetcode-submissions')
                    ├── 200: repo exists → link it
                    └── 404: create repo with description
                              │
                    chrome.storage.local.set({
                      github_token,
                      github_repo_owner,  ← from /user response
                      github_repo_name,
                      display_name,
                    })
                              │
                    hideOnboarding() → showDashboard()
                    LeetCodeAPI.getUserStats()
                    loadStoredState() → renderAllViews()
```

---

### 4.5 Message Routing Bus

```
    ┌──────────────────────────────────────────────────────────────┐
    │           CHROME RUNTIME MESSAGE ROUTING BUS                 │
    └──────────────────────────────────────────────────────────────┘

    SENDER             MESSAGE TYPE                 HANDLER
    ─────────          ────────────────────────     ──────────────────────────

    content.js    ──►  SYNC_SUBMISSION           ──► background.js
                       PROBLEM_SOLVED                 startAsyncGitHubSync()
                                                      + broadcastSolve()

    content.js    ──►  GET_USER_SESSION          ──► background.js
                                                      getLeetCodeSession()

    content.js    ──►  GET_USER_STATS            ──► background.js
                                                      LeetCodeAPI.getUserStats()

    popup/app.js  ──►  BACKFILL_SOLUTIONS        ──► background.js
                                                      Backfill all submissions

    popup/app.js  ──►  SEND_DUEL_CHALLENGE       ──► background.js
                                                      FirebaseSquads.createDuel()
                                                      + sendDesktopNotification()

    popup/app.js  ──►  CHECK_DUEL_STATUS         ──► background.js
                                                      FirebaseSquads.checkDuelStatus()

    popup/app.js  ──►  GET_DUEL_HISTORY          ──► background.js
                                                      Firestore query

    background.js ──►  SHOW_INPAGE_NOTIFICATION  ──► content.js (active tabs)
                                                      showVictoryToast()
                                                      showInPageAlert()

    background.js ──►  DUEL_STARTED              ──► content.js
                                                      launchConfetti()
                                                      showInPageAlert()
```

---

## 5. Subsystem Specifications

### 5.1 Onboarding Gateway & Auth Gatekeeper

| Property | Detail |
|:---|:---|
| **Source Files** | `popup/index.html` (`#onboarding-container`), `popup/app.js` |
| **Entry Point** | `checkAuthAndInitialize()` on every popup open |
| **Auth Method** | GitHub Personal Access Token (PAT) with `repo` scope |
| **Storage Keys** | `github_token`, `github_repo_owner`, `github_repo_name` |
| **Token URL** | `https://github.com/settings/tokens/new?scopes=repo` |
| **Repo Default** | `leetcode-submissions` (auto-created if missing) |
| **Failure Mode** | Shows inline error badge; clears invalid token |

---

### 5.2 Continuous Stats Dashboard

| Property | Detail |
|:---|:---|
| **Tab ID** | `#view-dashboard` |
| **Daily Momentum** | Consecutive day streak, 7-day visual strip (Mon–Sun), XP counter |
| **Donut Chart** | Pure SVG multi-segment chart: Easy (Emerald #16A34A), Medium (Amber #D97706), Hard (Rose #E11D48) |
| **DSA Focus Coach** | Analyzes `userSolvedSlugs` against roadmap → identifies weakest 2 categories |
| **Daily Problem** | Queries `LeetCodeAPI.getDailyChallenge()` on every popup open |
| **GitHub Sync** | Backfill button with real-time progress bar streamed from `chrome.storage.local.sync_status` |
| **Activity Strip** | 7-day checkbox grid persisted in `chrome.storage.local` |

---

### 5.3 DSA Roadmaps

| Property | Detail |
|:---|:---|
| **Tab ID** | `#view-roadmap` |
| **Datasets** | `blind75.json` (75 probs) + `neetcode150.json` (150 probs) |
| **Schema per Problem** | `{ id, title, slug, difficulty, category }` |
| **Category Filter Pills** | Dynamic `Set` of unique categories from active dataset |
| **Next For You** | `b75Data.find(p => !solvedSet.has(p.slug))` — first unsolved in order |
| **Problem Drawer** | Slide-over sheet with approach notes textarea + spaced review buttons |
| **Review Intervals** | +3d, +7d, +14d, +30d — stored in `chrome.storage.local.review_schedule` |
| **Completion Tracking** | Cross-references `user_solved_slugs` against roadmap slugs |

---

### 5.4 Multiplayer Squad Rooms

| Property | Detail |
|:---|:---|
| **Tab ID** | `#view-squad` |
| **Room Code Format** | 6 uppercase alphanumeric chars; excludes `0`, `O`, `1`, `I` |
| **Firestore Collection** | `squads/{roomCode}` |
| **Poll Interval** | 60 seconds via `chrome.alarms` (`squad_presence_poll`) |
| **Leadership** | `squad.owner` username; displays `👑 Leader` badge |
| **Edit Mode** | Toggle reveals `✕ Remove` kick buttons; only leader sees these |
| **Leave & Transfer** | `leaveSquad()` → transfers ownership to first remaining member if leader |
| **Challenge Pool** | 25 curated challenges; `getRandomChallenge(excludeId)` prevents immediate repeats |
| **Challenge Match** | `isSolveMatchingChallenge()` checks `category`, `difficulty`, and `listType` fields |
| **XP Awards** | Squad challenge complete: +100 XP to all members; Duel win: +50 XP |
| **Activity Feed** | Max 30 items in Firestore; `clearActivityFeed()` resets to `[]` |

---

### 5.5 1v1 Problem Duels

| Property | Detail |
|:---|:---|
| **Tab ID** | `#view-duels` |
| **Firestore Collection** | `duels/{duelId}` where `duelId = duel_${Date.now()}_${randomStr}` |
| **Formats** | Random Blind 75, NeetCode 150, Daily Challenge, Speed Sprint (Easy), Boss Fight (Hard) |
| **Concealment** | Problem hidden until both parties accept (`revealed: false`) |
| **Incoming Queue** | `#incoming-duels-container` renders all pending invites simultaneously |
| **Poll Mechanism** | `checkDuelStatus()` scans squad `activityFeed` for `duel_challenge` type events |
| **Win Resolution** | First to have LeetCode return "Accepted" → `submitDuelSolve()` claims win |
| **State Recovery** | 0ms load from `chrome.storage.local.active_duel` cache on popup open |
| **Cleanup** | Accept removes pending invite card from UI + Firestore feed; decline/complete clears storage |

---

### 5.6 GitHub Sync Engine

| Property | Detail |
|:---|:---|
| **Trigger** | Content script `SYNC_SUBMISSION` message OR manual backfill button |
| **Directory Structure** | `{Difficulty}/{id}-{slug}/README.md` + `solution.{ext}` |
| **ID Format** | 4-digit zero-padded (`0001-two-sum`, `0042-trapping-rain-water`) |
| **Commit API** | Git Trees API (atomic multi-file, avoids sequential PUT race conditions) |
| **Commit Message** | `Time: 35ms (98.4%) | Memory: 16.4MB (82.1%) - LeetX Squads` |
| **Retry Logic** | 3 attempts, 400ms × attempt exponential backoff |
| **SHA Cache-Bust** | `?_cb=${Date.now()}` on all GET ref requests |
| **Backfill** | Runs in background; popup closure safe; progress in `sync_status` key |
| **README Catalog** | Sorted by problem ID table with difficulty badges and solution language links |

---

## 6. API Reference

### `GitHubAPI` (scripts/github.js)

```javascript
class GitHubAPI {
  constructor(token: string)

  // Core HTTP
  async request(endpoint: string, options?: RequestInit): Promise<any>

  // User
  async getUser(): Promise<{ login, id, avatar_url }>

  // Repository
  async ensureRepository(repoName: string): Promise<{ repo, isNew, owner, name }>
  async getFile(owner, repo, path, ref?): Promise<{ sha, content } | null>

  // Git Trees Commit Engine
  async commitProblemSolution(owner, repo, {
    frontendId: number,
    title: string,
    titleSlug: string,
    difficulty: string,
    content: string,         // problem HTML
    code: string,            // user's solution
    language: string,
    runtimeDisplay: string,
    runtimePercentile: number,
    memoryDisplay: string,
    memoryPercentile: number,
    submittedAt: number,     // Unix timestamp for backdating
    branch?: string,
  }): Promise<{ commitSha, folderName, commitMessage }>

  // README Catalog
  async updateCatalogReadme(owner, repo, branch?): Promise<void>
  async getExistingProblemSlugs(owner, repo, branch?): Promise<string[]>

  // Static helpers
  static buildProblemReadme(title, titleSlug, difficulty, content): string
  static formatCommitMessage(runtime, rtPct, memory, memPct): string
}
```

---

### `LeetCodeAPI` (scripts/leetcode.js)

```javascript
class LeetCodeAPI {
  // GraphQL core
  static async query(query: string, variables: object): Promise<any>

  // User data
  static async getCurrentUser(): Promise<string | null>   // username
  static async getUserStats(username: string): Promise<{
    totalSolved, easySolved, mediumSolved, hardSolved,
    submissionCalendar: Record<string, number>
  }>

  // Problem data
  static async getDailyChallenge(): Promise<{
    id, title, titleSlug, difficulty, url, topics
  }>
  static async getQuestionDetails(titleSlug: string): Promise<{
    questionId, title, difficulty, content, topicTags
  }>

  // Submission history
  static async fetchAllAcceptedSubmissions(
    onProgress?: (pct: number) => void,
    username?: string
  ): Promise<Submission[]>
  static async getSubmissionDetails(submissionId: string): Promise<{
    code, runtime, memory, runtimePercentile, memoryPercentile,
    lang, timestamp, questionTitle, titleSlug
  }>
}
```

---

### `FirebaseSquads` (scripts/firebase.js)

```javascript
class FirebaseSquads {
  // Firestore REST primitives
  static async getDocument(collection, docId): Promise<object | null>
  static async setDocument(collection, docId, data): Promise<void>
  static async deleteDocument(collection, docId): Promise<void>

  // Squad room management
  static cleanCode(code: string): string           // '#k9x2p4' → 'K9X2P4'
  static generateRandomCode(length?: number): string
  static async generateUniqueRoomCode(): Promise<string>  // '#K9X2P4'

  static async fetchRemoteSquad(code: string): Promise<SquadDoc | null>
  static async saveRemoteSquad(code: string, data: SquadDoc): Promise<void>

  static async joinOrCreateSquad(roomCode, userProfile): Promise<SquadDoc>
  static async leaveSquad(roomCode, username): Promise<void>
  static async kickMember(roomCode, target, actor): Promise<void>
  static async sendNudge(roomCode, target, from): Promise<boolean>

  // Challenge engine
  static getRandomChallenge(excludeId?: string): Challenge
  static isSolveMatchingChallenge(challenge, problemData): boolean
  static async broadcastSolve(roomCode, username, problemData, streak): Promise<SquadDoc>
  static async rerollSquadChallenge(roomCode, username): Promise<Challenge>
  static async clearActivityFeed(roomCode): Promise<void>

  // Duel lifecycle
  static async createDuel({ roomCode, challenger, opponent, format, problem }): Promise<DuelDoc>
  static async acceptDuel(duelId, username): Promise<DuelDoc>
  static async declineDuel(duelId, username): Promise<void>
  static async forfeitDuel(duelId, username): Promise<void>
  static async submitDuelSolve(duelId, username, runtimeData): Promise<DuelDoc>
  static async checkDuelStatus(username, roomCode): Promise<{
    activeDuel: DuelDoc | null,
    incomingChallenges: DuelDoc[]
  }>
}
```

---

## 7. State Management Schema

All runtime state lives in `chrome.storage.local` — the single source of truth for the popup and background service worker.

| Key | Type | Default | Purpose |
|:---|:---|:---|:---|
| `github_token` | `string` | `null` | GitHub PAT for API authentication |
| `github_repo_owner` | `string` | `null` | GitHub username (also used as multiplayer display name) |
| `github_repo_name` | `string` | `'leetcode-submissions'` | Target backup repository |
| `display_name` | `string` | `null` | Squad profile display name override |
| `leetcode_username` | `string` | `null` | LeetCode handle for live stats |
| `streak_count` | `number` | `0` | Consecutive daily solve streak |
| `user_xp` | `number` | `0` | Total gamification XP points |
| `today_solved` | `number` | `0` | Problems solved today (resets at midnight) |
| `last_solved_date` | `string` | `null` | `YYYY-MM-DD` of last accepted submission |
| `user_solved_slugs` | `string[]` | `[]` | Unique problem slugs solved by user |
| `solved_easy_count` | `number` | `0` | Total Easy submissions accepted |
| `solved_med_count` | `number` | `0` | Total Medium submissions accepted |
| `solved_hard_count` | `number` | `0` | Total Hard submissions accepted |
| `total_solved` | `number` | `0` | Total accepted submissions |
| `my_squad_code` | `string` | `''` | Active squad room code (empty = no squad) |
| `active_duel` | `object` | `null` | Cached active/pending duel for 0ms UI load |
| `incoming_duel` | `object` | `null` | Cached incoming duel invitation |
| `sync_status` | `object` | `{ state: 'idle' }` | Background sync progress state |
| `target_open_tab` | `string` | `null` | Notification click routing target |
| `theme_preference` | `string` | `'light'` | `'light'` or `'dark'` |
| `notifications_enabled` | `boolean` | `true` | Master OS notification toggle |
| `notify_squad_solves_enabled` | `boolean` | `true` | Squad mate solve alerts |
| `share_solves_enabled` | `boolean` | `true` | Broadcast own solves to squad |
| `review_schedule` | `object` | `{}` | `{ slug: { id, title, dueDate } }` |
| `duel_wins` | `number` | `0` | Career duel victories |
| `duel_matches` | `number` | `0` | Total career duel matches played |
| `seven_day_activity` | `object` | `{}` | `{ YYYY-MM-DD: boolean }` for 7-day strip |

---

## 8. Firestore Data Model

### `squads/{roomCode}` Document

```json
{
  "owner": "AliceGH",
  "members": [
    {
      "username": "AliceGH",
      "streak": 12,
      "todaySolved": 2,
      "totalSolved": 183,
      "xp": 1450,
      "lastSeen": 1724430000000
    },
    {
      "username": "BobDev",
      "streak": 3,
      "todaySolved": 0,
      "totalSolved": 67,
      "xp": 300,
      "lastSeen": 1724425000000
    }
  ],
  "challenge": {
    "id": "ch_trees_5",
    "name": "Solve 5 Tree Problems",
    "description": "Complete any 5 tree-based problems from LeetCode",
    "category": "Trees",
    "target": 5,
    "progress": 3,
    "xpReward": 150
  },
  "activityFeed": [
    {
      "id": "act_1724430000000_abc1",
      "type": "solve",
      "username": "AliceGH",
      "text": "@AliceGH solved Binary Tree Level Order Traversal 🎉",
      "timestamp": 1724430000000
    },
    {
      "id": "act_1724428000000_def2",
      "type": "nudge",
      "fromUsername": "AliceGH",
      "targetUsername": "BobDev",
      "text": "@AliceGH sent a nudge to @BobDev! 👋",
      "timestamp": 1724428000000
    },
    {
      "id": "act_1724420000000_ghi3",
      "type": "duel_challenge",
      "challenger": "AliceGH",
      "opponent": "BobDev",
      "duelId": "duel_1724420000000_xyz",
      "problem": { "id": 1, "title": "Two Sum", "slug": "two-sum" },
      "timestamp": 1724420000000
    }
  ],
  "lastActive": 1724430000000
}
```

---

### `duels/{duelId}` Document

```json
{
  "id": "duel_1724420000000_xyz9",
  "roomCode": "K9X2P4",
  "challenger": "AliceGH",
  "opponent": "BobDev",
  "format": "random_blind75",
  "problem": {
    "id": 102,
    "title": "Binary Tree Level Order Traversal",
    "slug": "binary-tree-level-order-traversal",
    "difficulty": "Medium",
    "category": "Trees"
  },
  "status": "active",
  "revealed": true,
  "createdAt": 1724420000000,
  "startedAt": 1724421000000,
  "finishedAt": null,
  "winner": null,
  "loser": null,
  "winnerRuntime": null,
  "winnerMemory": null
}
```

**Possible `status` values**: `"pending"` → `"active"` → `"completed"` | `"forfeited"` | `"declined"`

---

## 9. Squad Challenge Pool

The 25 curated squad challenges cycle automatically on completion. The `isSolveMatchingChallenge()` function strictly validates that a given solve satisfies the challenge's conditions.

| # | Challenge Name | Category | Target | XP |
|:--|:---|:---|:---:|:---:|
| 1 | Solve 3 Easy Problems | Any Easy | 3 | 100 |
| 2 | Solve 5 Easy Problems | Any Easy | 5 | 150 |
| 3 | Solve 3 Medium Problems | Any Medium | 3 | 150 |
| 4 | Solve 5 Medium Problems | Any Medium | 5 | 200 |
| 5 | Solve 2 Hard Problems | Any Hard | 2 | 200 |
| 6 | Solve 3 Hard Problems | Any Hard | 3 | 250 |
| 7 | Array & Hashing Gauntlet | Arrays & Hashing | 5 | 150 |
| 8 | Two Pointer Sprint | Two Pointers | 4 | 150 |
| 9 | Sliding Window Focus | Sliding Window | 4 | 150 |
| 10 | Stack Challenge | Stack | 4 | 150 |
| 11 | Binary Search Drill | Binary Search | 4 | 150 |
| 12 | Tree Traversal Marathon | Trees | 5 | 150 |
| 13 | Graph Exploration | Graphs | 4 | 200 |
| 14 | Backtracking Challenge | Backtracking | 3 | 200 |
| 15 | Heap / Priority Queue | Heap / Priority Queue | 3 | 200 |
| 16 | Dynamic Programming Intro | 1-D Dynamic Programming | 3 | 200 |
| 17 | Advanced DP | 2-D Dynamic Programming | 3 | 250 |
| 18 | Greedy Strategy | Greedy | 4 | 150 |
| 19 | Blind 75 Sprint | Blind 75 | 5 | 200 |
| 20 | NeetCode 150 Push | NeetCode 150 | 5 | 200 |
| 21 | Speed Sprint (Easy Only) | Easy | 5 | 100 |
| 22 | Boss Fight (Hard Only) | Hard | 2 | 250 |
| 23 | Daily Challenge Streak | Daily | 3 | 150 |
| 24 | Linked List Focus | Linked List | 4 | 150 |
| 25 | Tries & Bit Manipulation | Advanced | 3 | 200 |

---

## 10. Testing & Validation Playbook

### End-to-End Automated Test Suite (31 Tests)

```powershell
node tests/e2e_full_suite.js
```

| Suite | Tests | Covers |
|:---|:---:|:---|
| Manifest V3 & Packaging | 4 | MV3 compliance, permissions, host perms, icons |
| DSA Roadmaps | 4 | Blind 75 count, NC150 count, category filter, recommendation |
| GitHub Sync | 2 | Folder naming, README catalog footer |
| Squad Rooms | 8 | Room codes, create, join, nudge, kick, leave, challenge cycle, reroll, clear feed |
| 1v1 Duel Machine | 6 | Create, status check, accept, solve, decline, forfeit |
| UI DOM Integrity | 7 | All 5 views, incoming container, button element, no hardcoded creds, CSS rules |

### Feature Verification Suite (39 Tests)

```powershell
node scratch/feature_verification.js
```

### Python Unit Tests (6 Tests)

```powershell
python -m unittest tests/test_extension.py
```

### JavaScript Syntax Validation

```powershell
node --check popup/app.js
node --check scripts/background.js
node --check scripts/firebase.js
node --check scripts/github.js
node --check scripts/leetcode.js
node --check scripts/content.js
```

### Firestore Database Reset (Development)

```powershell
node scratch/clean_firestore.js
```

---

## 11. Release Engineering

### Semver Versioning

The version string lives exclusively in `manifest.json` and is read by `scripts/package.py`.

```powershell
# Patch release (1.1.2 → 1.1.3)
python scripts/package.py patch

# Minor release (1.1.2 → 1.2.0)
python scripts/package.py minor

# Major release (1.1.2 → 2.0.0)
python scripts/package.py major
```

### Build Artifacts

| File | Target | Notes |
|:---|:---|:---|
| `dist/leetx-v{ver}.zip` | Chrome, Edge, Brave, Arc | Standard MV3 package |
| `dist/leetx-firefox-v{ver}.zip` | Firefox AMO | Includes `background.scripts` fallback field |
| `~/Downloads/leetx-v{ver}.zip` | Direct install | Auto-copied for quick testing |

### Git Workflow

```bash
# Run full test suite before committing
node tests/e2e_full_suite.js

# Stage and commit
git add .
git commit -m "feat: <description>"

# Push to origin
git push origin main
```

### Chrome Extension Testing (Local)
1. Navigate to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select project root (where `manifest.json` lives)
4. Click 🔄 Reload icon after any code change
5. Use **Inspect views → background page** to debug service worker logs

---

<div align="center">
  <sub>⚡ LeetX Squads Architecture Document · Repository: <a href="https://github.com/NINJA981/leetsync-squads">NINJA981/leetsync-squads</a> · v1.1.2</sub>
</div>
