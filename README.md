# ⚡ LeetX Squads — Browser Extension

<div align="center">

![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg?style=for-the-badge)
![Browsers](https://img.shields.io/badge/Browsers-Chrome%20%7C%20Brave%20%7C%20Edge%20%7C%20Arc%20%7C%20Firefox-blue.svg?style=for-the-badge)
![Multiplayer](https://img.shields.io/badge/Multiplayer-Firebase%20Firestore-orange.svg?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-purple.svg?style=for-the-badge)

**The ultimate companion extension for LeetCode.**  
Automatic GitHub backup with authentic performance metrics, interactive Blind 75 & NeetCode 150 roadmaps, daily streak gamification, and real-time multiplayer Squad Rooms with live 1v1 speed duels.

</div>

---

## 🌟 Key Features

### 🐙 1. Instant Atomic GitHub Sync
- Automatically commits every accepted LeetCode submission to your GitHub repository in real time.
- Generates clean, difficulty-categorized directories (`0001-Two-Sum/`, `Easy/`, `Medium/`, `Hard/`).
- Includes authentic runtime/memory benchmarks and community percentile rankings (e.g. `Beats 98.4%`).
- Automatically updates a beautiful, Markdown problem catalog table in the repository root `README.md`.

### 🔥 2. Daily Momentum & Streak Gamification
- Tracks consecutive days of problem solving with authentic LeetCode calendar reconciliation.
- Interactive 7-day visual momentum strip with animated checkmarks.
- XP progression system rewarding consistency and challenge completions.

### 🗺️ 3. Curated DSA Roadmaps (Blind 75 & NeetCode 150)
- Practice the canonical **Blind 75** (75 problems) and **NeetCode 150** (150 problems) curricula.
- Category filters: Arrays & Hashing, Two Pointers, Sliding Window, Trees, Graphs, Dynamic Programming, and more.
- Deterministic **"Next For You"** recommendation engine directs you to your next unsolved milestone.
- Personal problem approach notes & spaced repetition review reminders (+3d, +7d, +14d, +30d).

### 👥 4. Real-Time Multiplayer Squad Rooms
- Join or host private squad rooms with collision-free 6-character room codes (e.g. `#K9X2P4`).
- Live squad leaderboard tracking friend streaks, daily solves, and XP.
- **Squad Leader Controls**: The room creator has authority to manage members (`🚫 Kick`).
- **25 Dynamic Squad Challenges**: Team-based goals (e.g., *"Solve 5 Tree problems"*) that auto-cycle upon completion.
- **`👋 Nudge`**: Send real-time wake-up nudges to teammates to preserve squad streaks.

### ⚔️ 5. 1v1 Live Problem Duels
- Challenge squad mates to live coding speed races.
- **Format Selectors**: Random Blind 75, NeetCode 150, Today's Daily Challenge, Speed Sprint (Easy), or Boss Fight (Hard).
- **Concealed Problem Protocol**: The problem title and link remain locked (`🔒 Problem Hidden`) until **both** players accept, ensuring zero head starts.
- **Instant Win Resolution**: The first player whose submission is accepted by LeetCode is declared the winner with +50 XP and recorded match history.

---

## 💻 Step-by-Step Setup Guide on Your Laptop

Follow these simple instructions to install and configure **LeetX Squads** on your laptop in under 2 minutes.

---

### Step 1: Download or Clone the Extension

#### Option A: Clone with Git (Recommended for Developers)
Open your terminal (PowerShell, Command Prompt, or Terminal) and run:
```bash
git clone https://github.com/NINJA981/leetsync-squads.git
cd leetsync-squads
```

#### Option B: Download the ZIP Package
1. Download **`leetx-v1.1.2.zip`** from the [Releases page](https://github.com/NINJA981/leetsync-squads/releases) or the `dist/` folder.
2. Extract the ZIP file into a folder on your computer (e.g. `Documents/leetx-squads`).

---

### Step 2: Load into Your Browser

#### For Chrome, Brave, Microsoft Edge, or Arc:
1. Open your browser and navigate to the extensions page:
   - **Chrome**: `chrome://extensions`
   - **Brave**: `brave://extensions`
   - **Edge**: `edge://extensions`
   - **Arc**: Open Settings → Extensions
2. Enable **Developer mode** using the toggle in the top-right corner.
3. Click the **Load unpacked** button in the top-left corner.
4. Select the project folder containing `manifest.json`.
5. Click the puzzle icon 🧩 in your browser toolbar and **pin 📌 LeetX Squads** to your toolbar.

#### For Mozilla Firefox:
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select the `manifest.json` file inside the project directory.

---

### Step 3: 15-Second GitHub Authentication

1. Click the **LeetX Squads** icon in your browser toolbar.
2. On the welcome screen, click **`1. Open GitHub & Generate Token ↗`**.
   - *This will open GitHub with the exact required scopes (`repo`) pre-selected.*
3. Scroll down to the bottom of the GitHub page and click **Generate token**.
4. Click the copy icon 📋 next to your new Personal Access Token (`ghp_...`).
5. Return to the extension popup, paste your token into the field, and click **Unlock ⚡**.
6. **LeetX Squads** will automatically verify your account, detect your username, and create a `leetcode-submissions` repository in your GitHub account!

---

## 🎮 How to Play Multiplayer Squads & 1v1 Duels

### Creating a Squad Room
1. In the extension popup, switch to the **Squad** tab.
2. Click the **`+ New`** button.
3. A unique 6-character room code will be generated (e.g., `#K9X2P4`), and you will be designated as the **Squad Leader 👑**.
4. Click **`Copy`** to copy the room code and share it with your friends or study group!

### Joining a Squad Room
1. Open the **Squad** tab.
2. Enter your friend's 6-character room code into the join input.
3. Click **`Join`** to instantly connect to the live squad leaderboard and team challenges.

### Starting a 1v1 Problem Race
1. Switch to the **Duels** tab.
2. Select an opponent from your squad members dropdown.
3. Choose your format (e.g., *Blind 75 · Random Problem*).
4. Click **`Start Duel Match`**.
5. Your opponent will receive a desktop notification and challenge card.
6. Once they click **`Accept ⚔️`**, the problem and direct LeetCode link are revealed simultaneously to both players, and the live timer starts ticking!

---

## 🛠️ Local Development & Testing

LeetX Squads comes with a comprehensive automated test suite.

### Running Tests
To run all 31 End-to-End (E2E) automated tests and verify all subsystems:
```bash
# Run comprehensive E2E suite
node tests/e2e_full_suite.js

# Run live feature verification tests
node scratch/feature_verification.js

# Run structural Python unit tests
python -m unittest tests/test_extension.py
```

### Packaging Release ZIPs
To compile and package fresh release builds for Chrome and Firefox AMO:
```bash
python scripts/package.py
```
*Output packages will be saved to `dist/leetx-v1.1.2.zip` and copied directly to your `Downloads` directory.*

---

## ❓ Troubleshooting & FAQ

<details>
<summary><b>1. Why isn't my problem syncing automatically when I solve it?</b></summary>
Make sure you are logged into your LeetCode account in the same browser session. LeetX Squads automatically detects accepted submissions upon the LeetCode "Accepted" result banner. You can also trigger a manual backfill from the Settings tab.
</details>

<details>
<summary><b>2. How do I change my target repository name?</b></summary>
Navigate to the <b>Settings</b> tab in the extension popup. Under the <b>GitHub Config</b> card, you can customize your repository name, default branch, or toggle difficulty subdirectories (e.g., <code>Easy/0001-Two-Sum/</code>).
</details>

<details>
<summary><b>3. Do my squad mates need to be in the same network?</b></summary>
No. Multiplayer Squad Rooms and 1v1 Duels are powered by Google Cloud Firestore, enabling real-time multiplayer synchronization across any location or device globally.
</details>

<details>
<summary><b>4. Is my GitHub token secure?</b></summary>
Yes. Your token is stored exclusively inside your browser's private <code>chrome.storage.local</code> sandbox and is only used to make direct, authenticated HTTPS requests to the official GitHub API (<code>api.github.com</code>). It is never transmitted to any third-party server.
</details>

---

## 📄 License

This project is open-source under the [MIT License](LICENSE).

<div align="center">
  <sub>Built with ❤️ for the competitive programming community • Powered by <b>LeetX Squads</b></sub>
</div>
