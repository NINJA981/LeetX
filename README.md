# ⚡ LeetSync Squads (Chrome & Web Extension)

A 100% free, production-ready Manifest V3 browser extension that brings **1-Click GitHub Live Sync**, **Authentic Submission Timestamps**, **Streak RPG Gamification**, and **Real-Time Multiplayer Squad Rooms with 1v1 Problem Duels** to LeetCode.

---

## 🌟 Highlights & Features

- 🐙 **1-Click GitHub OAuth**: Log in with a single click and pick your repository (`leetcode-submissions`) from an auto-populated dropdown menu. (Manual PAT also supported).
- ⚡ **Instant Live Sync**: The moment you hit **"Submit"** and get an **"Accepted"** verdict on LeetCode, your solution, HTML description, and Shields.io badges are pushed to GitHub in under 2 seconds.
- 🕒 **Authentic Timestamps**: Commits are created with your exact LeetCode submission dates and standard LeetSync metrics (`Time: 17 ms (94%) | Memory: 47.4 MB (76%) - LeetSync`).
- 📑 **Self-Updating Root `README.md` Catalog**: Automatically maintains a sorted problem table with difficulty indicators and solution file links.
- 🚀 **1-Click Retro Backfill Engine**: Retroactively syncs all 100+ past accepted solutions directly from the popup with a live progress bar.
- 🔥 **Streak Gamification & Confetti**: Toolbar flame badge, XP leveling, daily challenge launcher, and high-dopamine in-page confetti celebrations.
- 👥 **Real-Time Squad Rooms (Firebase)**: Join or create rooms via 6-digit codes (`#ALGO99`), track friend streaks on a live leaderboard, view real-time solve feeds, and send friendly nudges (`👋`, `🔥`, `🚨`).
- ⚔️ **1v1 Timed Problem Duels**: Challenge squad mates to live coding sprints with synchronized countdowns and win/loss records.
- 🗺️ **Blind 75 & NeetCode 150 Roadmaps**: Built-in checklists that automatically mark off solved problems as you practice.

---

## 🚀 Installation Guide (Chrome / Brave / Edge)

1. Open your browser and navigate to the extensions management page:
   - **Chrome**: `chrome://extensions`
   - **Brave**: `brave://extensions`
   - **Edge**: `edge://extensions`
2. Enable **"Developer mode"** in the top right corner.
3. Click the **"Load unpacked"** button in the top left.
4. Select the `x:\Projects\leetcode\leetsync-squads` directory.
5. Pin the **LeetSync Squads** extension to your browser toolbar!

---

## 🔑 1-Minute Setup

1. Click the **LeetSync Squads** extension icon in your browser toolbar.
2. Go to the **⚙️ Settings** tab.
3. Click **"1-Click Sign In with GitHub"** (or paste a personal access token).
4. Select your target repository (e.g. `leetcode-submissions`).
5. You're all set! Go to any problem on [leetcode.com](https://leetcode.com) and start solving.

---

## 👥 How to Use Squad Rooms

1. Click on the **👥 Squad** tab in the extension popup.
2. Share your Squad Code (e.g., `#ALGO99`) with your friends.
3. Your friends enter the code and click **"Join"**.
4. The live leaderboard will now track everyone's daily solves, streaks, and XP in real-time!
5. Send friendly nudges (`👋`) to anyone who hasn't finished their daily problem yet.

---

## 💰 100% Free Forever Architecture

- **GitHub API**: Runs on GitHub's free tier (5,000 requests/hour per user).
- **Google Firebase**: Runs on Firebase's free Spark Plan (50,000 reads/day, 20,000 writes/day, zero credit card required).
- **No Telemetry / No Middleman**: All solution data flows directly between LeetCode and your GitHub account.
