# ⚡ LeetSync Squads: Architecture & Implementation Plan

> **A 100% Free, Production-Grade Chrome Extension (Manifest V3) with 1-Click GitHub OAuth, Real-Time GitHub Solution Syncing, 1-Click Historical Backfills, RPG Streak Gamification, and Multiplayer Squad Rooms with 1v1 Problem Races.**

---

## 🎯 Executive Summary & Objectives

### The Vision
Build **LeetSync Squads**, a modern Manifest V3 Web Extension designed to make DSA practice addictive, collaborative, and seamless. It eliminates all manual setup friction via **1-Click GitHub OAuth**, automates GitHub repository commits with authentic metrics/dates, keeps daily streaks alive through RPG gamification, and introduces real-time multiplayer **Squad Rooms** for peer accountability.

### 💰 Cost & Free Tier Guarantee
- **100% Free Forever**: Operates strictly within the free tiers of GitHub (5,000 API requests/hour per user) and Firebase Spark Plan (50,000 reads/day, 20,000 writes/day, no credit card required).

---

## 📐 System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      LeetSync Squads Extension (MV3)                        │
├──────────────────────────────────────┬──────────────────────────────────────┤
│           Popup Dashboard            │           In-Page Overlay            │
│  • 1-Click GitHub OAuth Sign-In      │  • Confetti & Performance Toast      │
│  • Auto-Populated Repo Dropdown      │  • Live Room Presence Pill           │
│  • Personal Stats & Streak Fire      │  • 1v1 Race Countdown Modal          │
│  • Squad Live Leaderboard & Feed     │  • Quick Solution Notes Drawer       │
│  • Blind 75 / NeetCode Roadmaps      │  • Daily Challenge Quick Launcher    │
│  • 1-Click Historical Backfill Engine│                                      │
└──────────────────┬───────────────────┴──────────────────┬───────────────────┘
                   │                                      │
           GitHub REST API (OAuth)                Firebase Firestore
                   │                            (Realtime WebSockets)
                   ▼                                      ▼
┌──────────────────────────────────────┐ ┌────────────────────────────────────┐
│         GitHub Repositories          │ │       Firebase Cloud Backend       │
│  • <id>-<slug>/ Solution Files       │ │  • Squad Room State & Presence     │
│  • Difficulty Badges & HTML READMEs  │ │  • Realtime Solve Activity Feeds   │
│  • Auto-Generated Catalog Table      │ │  • Group Streak & Team Shields     │
│  • Authentic Submission Dates        │ │  • 1v1 Race Matchmaking & Results  │
└──────────────────────────────────────┘ └────────────────────────────────────┘
```

---

## 🗂️ File & Directory Layout

```text
leetsync-squads/
├── manifest.json                # Manifest V3 configuration & host permissions
├── popup/
│   ├── index.html               # Main UI container with modern tabs
│   ├── style.css                # Glassmorphism dark theme & micro-animations
│   ├── app.js                   # State manager & tab navigation router
│   ├── views/
│   │   ├── auth.js              # 1-Click GitHub OAuth & repo selector
│   │   ├── dashboard.js         # Streak flame, daily target, 1-click backfill
│   │   ├── squad.js             # Room codes, live leaderboard, nudge trigger
│   │   ├── duels.js             # 1v1 live race lobby & matchmaking
│   │   ├── roadmap.js           # Blind 75 & NeetCode 150 checklists
│   │   └── settings.js          # Commit styles, delays, catalog options
├── scripts/
│   ├── background.js            # Service worker (auth broker, alarms, sync queue)
│   ├── content.js               # LeetCode DOM watcher & in-page celebration toast
│   ├── github.js                # Octokit GitHub client for commits, trees, & READMEs
│   ├── leetcode.js              # LeetCode GraphQL query engine & backfill fetcher
│   └── firebase.js              # Real-time Firestore sync for squads & duels
├── assets/
│   ├── icons/                   # 16x16, 48x48, 128x128 extension icons
│   ├── badges/                  # Difficulty & rank SVGs
│   └── data/
│       ├── blind75.json         # Blind 75 problem dataset
│       └── neetcode150.json     # NeetCode 150 problem dataset
└── README.md                    # Installation & developer setup guide
```

---

## 🧩 Detailed Implementation Phases

### Phase 1: 1-Click GitHub OAuth & Extension Scaffold
* **Goal**: Seamless, zero-copy authentication using Chrome's native auth APIs.
* **Tasks**:
  1. Configure `manifest.json` with permissions (`identity`, `storage`, `alarms`, `https://leetcode.com/*`, `https://api.github.com/*`, `https://firestore.googleapis.com/*`).
  2. Implement `scripts/background.js` using `chrome.identity.launchWebAuthFlow` for 1-Click GitHub OAuth (`repo` scope).
  3. Fetch authenticated user profile (avatar, username) and auto-populate repository dropdown in popup.
  4. Provide fallback manual Personal Access Token (PAT) option in settings.

### Phase 2: Live GitHub Sync & 1-Click Backfill Engine
* **Goal**: Bulletproof, LeetSync-compatible syncing with authentic metrics, timestamps, and catalog auto-updates.
* **Tasks**:
  1. Build `scripts/leetcode.js` to query LeetCode GraphQL APIs (`submissionDetails`, `questionData`, `submissionList`).
  2. Build `scripts/github.js` using GitHub REST API:
     - Direct file generation (`<id>-<slug>/` with `README.md` and `<slug>.<ext>`).
     - Authentic commit message: `Time: X ms (Y%) | Memory: Z MB (W%) - LeetSync`.
     - Authentic commit backdating (`author.date` and `committer.date`).
  3. Auto-generate/update repository root `README.md` problem catalog table on every solve.
  4. 1-Click Backfill Engine inside popup with live progress bar (`[45/119] Syncing 3Sum...`).

### Phase 3: Streak Gamification, In-Page Celebrations & Roadmaps
* **Goal**: Maximize daily motivation and visual satisfaction.
* **Tasks**:
  1. Toolbar Icon Badge: Live flame counter (`🔥 15`).
  2. Daily Challenge Widget: Shows today's official LeetCode problem with 1-click launch.
  3. XP & Leveling Engine: Compute user rank, level progress bar, and topic mastery.
  4. In-Page Victory Toast (`scripts/content.js`): High-dopamine slide-in toast with confetti and percentile speed titles (*"🚀 Speed Demon"*).
  5. Built-in Blind 75 / NeetCode 150 checklists that automatically check off solved problems.

### Phase 4: Production Squad Rooms & Live Leaderboards (Firebase)
* **Goal**: Real-time social accountability and group streak mechanics.
* **Tasks**:
  1. Configure real-time Firestore client in `scripts/firebase.js`.
  2. 6-Character Room Code Generator (`#ALGO99`) with join/leave functionality.
  3. Real-Time Squad Leaderboard: Ranks members by daily solve status, streak, and XP.
  4. Real-Time Activity Feed: Broadcast solve events across all squad members within 500ms.
  5. 1-Click Emoji Nudges (`👋`, `🔥`, `🚨`) sent to friends who haven't completed their daily solve.
  6. Group Streak & Team Shield: Calculate collective group streak and unlock streak freeze shields.

### Phase 5: 1v1 Live Problem Duels
* **Goal**: Real-time peer competitions and timed problem sprints.
* **Tasks**:
  1. Duel lobby in `popup/views/duels.js` to pick a problem and send challenges to squad mates.
  2. Real-time match synchronization in Firestore (`pending` → `countdown` → `active` → `finished`).
  3. In-page race HUD on LeetCode: Live opponent status and match timer.
  4. Instant victory detection upon first "Accepted" verdict with win/loss record tracking.

### Phase 6: Verification, Testing & Packaging
* **Goal**: Ensure rock-solid stability and easy installation.
* **Tasks**:
  1. Verify zero token leakage (OAuth tokens stored securely in `chrome.storage.local`).
  2. Offline sync queue (automatically commits pending solutions when connectivity is restored).
  3. Full unit tests for GraphQL parsers, GitHub tree generators, and streak algorithms.
  4. Comprehensive developer documentation for loading unpacked in Chrome/Edge/Brave.

---

## 📋 Verification & Acceptance Criteria

- [ ] 1-Click **"Sign in with GitHub"** authorizes seamlessly without manual token creation.
- [ ] User's GitHub repositories auto-populate in a dropdown selector.
- [ ] Submitting an accepted solution on LeetCode triggers live sync to GitHub within 2 seconds.
- [ ] Problem folder `<id>-<slug>/` created with `README.md` (badges + description) and solution file.
- [ ] Commit message matches `Time: X ms (Y%) | Memory: Z MB (W%) - LeetSync`.
- [ ] 1-Click Backfill retro-syncs 100+ historical problems with authentic timestamps and skips existing.
- [ ] Root `README.md` catalog table updates automatically.
- [ ] Creating/joining a Squad Room syncs member leaderboards in real time.
- [ ] Solving a problem broadcasts to the Squad Activity Feed instantly.
- [ ] 1v1 problem race triggers in-page timer and correctly crowns the winner.
