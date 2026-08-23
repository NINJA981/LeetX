/**
 * LeetSync Squads - GitHub API & Device Flow Engine
 * Enables 1-Click browser authentication, automatic repo creation, and atomic Git Tree commits.
 */

// GitHub CLI / VSCode Public OAuth App Client ID (supports standard device flow with repo scope)
const GITHUB_PUBLIC_CLIENT_ID = '178c6fc778ccc68e1d6a'; 

function getBadgeColor(difficulty) {
  switch ((difficulty || '').toLowerCase()) {
    case 'easy': return 'brightgreen';
    case 'medium': return 'orange';
    case 'hard': return 'red';
    default: return 'lightgrey';
  }
}

function getFileExtension(lang) {
  const map = {
    python: '.py',
    python3: '.py',
    java: '.java',
    cpp: '.cpp',
    c: '.c',
    csharp: '.cs',
    javascript: '.js',
    typescript: '.ts',
    golang: '.go',
    go: '.go',
    rust: '.rs',
    ruby: '.rb',
    swift: '.swift',
    kotlin: '.kt',
    scala: '.scala',
    mysql: '.sql',
    mssql: '.sql',
    oraclesql: '.sql',
    postgresql: '.sql',
    pythondata: '.py',
  };
  return map[(lang || '').toLowerCase()] || '.txt';
}

export class GitHubAPI {
  constructor(token) {
    this.token = token;
    this.baseUrl = 'https://api.github.com';
  }

  async request(endpoint, options = {}) {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      ...(options.headers || {}),
    };

    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      let errorBody = {};
      try {
        errorBody = await res.json();
      } catch (e) {
        errorBody = { message: res.statusText };
      }
      throw new Error(`GitHub API Error (${res.status}): ${errorBody.message || res.statusText}`);
    }

    if (res.status === 204) return null;
    return await res.json();
  }

  /**
   * Start GitHub Device Code Flow (No Server / Client Secret required).
   */
  static async requestDeviceCode() {
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_PUBLIC_CLIENT_ID,
        scope: 'repo,user',
      }),
    });

    if (!res.ok) {
      throw new Error('Failed to request device authorization code.');
    }

    return await res.json();
  }

  /**
   * Poll for access token after user authorizes in browser tab.
   */
  static async pollForAccessToken(deviceCode, intervalSeconds = 5, expiresInSeconds = 900) {
    const startTime = Date.now();
    const expiresAt = startTime + (expiresInSeconds * 1000);

    while (Date.now() < expiresAt) {
      await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));

      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: GITHUB_PUBLIC_CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });

      const data = await res.json();

      if (data.access_token) {
        return data.access_token;
      }

      if (data.error === 'authorization_pending') {
        continue;
      }

      if (data.error === 'slow_down') {
        intervalSeconds += 5;
        continue;
      }

      if (data.error === 'expired_token' || data.error === 'access_denied') {
        throw new Error(data.error_description || 'Authorization was cancelled or expired.');
      }
    }

    throw new Error('Device authentication timed out.');
  }

  /**
   * Get authenticated user profile.
   */
  async getUser() {
    return await this.request('/user');
  }

  /**
   * Get user repositories list.
   */
  async getUserRepos() {
    return await this.request('/user/repos?sort=updated&per_page=100&type=all');
  }

  /**
   * Automatically ensure the target repository exists. If not, auto-create it via API.
   */
  async ensureRepository(repoName = 'leetcode-submissions') {
    const user = await this.getUser();
    const owner = user.login;

    try {
      const existing = await this.request(`/repos/${owner}/${repoName}`);
      return { repo: existing, isNew: false, owner, name: repoName };
    } catch (err) {
      if (err.message.includes('404')) {
        const created = await this.request('/user/repos', {
          method: 'POST',
          body: JSON.stringify({
            name: repoName,
            description: 'LeetCode Data Structures and Algorithms solutions automatically synced with LeetSync Squads ⚡',
            private: false,
            auto_init: true,
          }),
        });
        return { repo: created, isNew: true, owner, name: repoName };
      }
      throw err;
    }
  }

  /**
   * Get file contents from repository.
   */
  async getFile(owner, repo, path, ref = 'main') {
    try {
      return await this.request(`/repos/${owner}/${repo}/contents/${path}?ref=${ref}`);
    } catch (err) {
      if (err.message.includes('404')) return null;
      throw err;
    }
  }

  /**
   * Build LeetSync-formatted README HTML content.
   */
  static buildProblemReadme(title, titleSlug, difficulty, content) {
    const color = getBadgeColor(difficulty);
    const diffCapitalized = difficulty ? difficulty.charAt(0).toUpperCase() + difficulty.slice(1).toLowerCase() : 'Medium';

    return (
      `<h2><a href="https://leetcode.com/problems/${titleSlug}">${title}</a></h2> ` +
      `<img src='https://img.shields.io/badge/Difficulty-${diffCapitalized}-${color}' alt='Difficulty: ${diffCapitalized}' /><hr>\n\n` +
      `${(content || '').trim()}\n`
    );
  }

  /**
   * Format standard LeetSync commit message.
   */
  static formatCommitMessage(runtimeDisplay, runtimePercentile, memoryDisplay, memoryPercentile) {
    const runtimePart = runtimeDisplay || '0 ms';
    const memoryPart = memoryDisplay || '0 MB';
    const runtimePctStr = runtimePercentile != null ? ` (${parseFloat(runtimePercentile).toFixed(2)}%)` : '';
    const memoryPctStr = memoryPercentile != null ? ` (${parseFloat(memoryPercentile).toFixed(2)}%)` : '';

    return `Time: ${runtimePart}${runtimePctStr} | Memory: ${memoryPart}${memoryPctStr} - LeetSync`;
  }

  /**
   * Direct Commit using Git Trees API to create/update multiple files in 1 atomic commit with backdating.
   */
  async commitProblemSolution(owner, repo, {
    frontendId,
    title,
    titleSlug,
    difficulty,
    content,
    code,
    lang,
    runtimeDisplay,
    runtimePercentile,
    memoryDisplay,
    memoryPercentile,
    timestamp,
    notes,
    branch = 'main',
  }) {
    const folderName = `${frontendId}-${titleSlug}`;
    const ext = getFileExtension(lang);
    const solutionFileName = `${titleSlug}${ext}`;

    const readmeContent = GitHubAPI.buildProblemReadme(title, titleSlug, difficulty, content);
    const commitMessage = GitHubAPI.formatCommitMessage(runtimeDisplay, runtimePercentile, memoryDisplay, memoryPercentile);

    // 1. Get latest commit SHA on branch
    const refData = await this.request(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    const latestCommitSha = refData.object.sha;

    // 2. Get base tree SHA
    const commitData = await this.request(`/repos/${owner}/${repo}/git/commits/${latestCommitSha}`);
    const baseTreeSha = commitData.tree.sha;

    // 3. Prepare tree items
    const treeItems = [
      {
        path: `${folderName}/README.md`,
        mode: '100644',
        type: 'blob',
        content: readmeContent,
      },
      {
        path: `${folderName}/${solutionFileName}`,
        mode: '100644',
        type: 'blob',
        content: code,
      },
    ];

    if (notes && notes.trim()) {
      treeItems.push({
        path: `${folderName}/Notes.md`,
        mode: '100644',
        type: 'blob',
        content: notes.trim() + '\n',
      });
    }

    // 4. Create new Tree
    const newTree = await this.request(`/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeItems,
      }),
    });

    // 5. Create Commit with authentic author & committer date
    const commitPayload = {
      message: commitMessage,
      tree: newTree.sha,
      parents: [latestCommitSha],
    };

    if (timestamp) {
      const dateIso = new Date(timestamp * 1000).toISOString();
      commitPayload.author = {
        name: commitData.author?.name || owner,
        email: commitData.author?.email || `${owner}@users.noreply.github.com`,
        date: dateIso,
      };
      commitPayload.committer = commitPayload.author;
    }

    const createdCommit = await this.request(`/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify(commitPayload),
    });

    // 6. Update Branch Reference
    await this.request(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({
        sha: createdCommit.sha,
        force: false,
      }),
    });

    return {
      commitSha: createdCommit.sha,
      folderName,
      commitMessage,
    };
  }

  /**
   * Regenerate and update the repository root README catalog table.
   */
  async updateCatalogReadme(owner, repo, branch = 'main') {
    const refData = await this.request(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    const latestCommitSha = refData.object.sha;
    const treeData = await this.request(`/repos/${owner}/${repo}/git/trees/${latestCommitSha}?recursive=1`);

    const problemMap = new Map();
    const folderPattern = /^(\d+)-([a-z0-9-]+)\/(README\.md|([a-z0-9-]+)\.(py|java|js|cpp|ts|go|rs|sql|cs|kt|swift|rb|php|scala))$/i;

    for (const item of (treeData.tree || [])) {
      const match = item.path.match(folderPattern);
      if (match) {
        const frontendId = parseInt(match[1], 10);
        const titleSlug = match[2];
        const fileName = match[3];

        if (!problemMap.has(titleSlug)) {
          problemMap.set(titleSlug, {
            id: frontendId,
            titleSlug,
            folderName: `${frontendId}-${titleSlug}`,
            title: titleSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            difficulty: 'Medium',
            solutions: [],
          });
        }

        const prob = problemMap.get(titleSlug);
        if (fileName !== 'README.md' && fileName !== 'Notes.md') {
          const ext = fileName.split('.').pop().toLowerCase();
          const langLabel = {
            py: 'Python',
            java: 'Java',
            js: 'JavaScript',
            cpp: 'C++',
            ts: 'TypeScript',
            go: 'Go',
            rs: 'Rust',
            sql: 'SQL',
            cs: 'C#',
            kt: 'Kotlin',
            swift: 'Swift',
            rb: 'Ruby',
            php: 'PHP',
          }[ext] || ext.toUpperCase();

          prob.solutions.push(`[\`${langLabel}\`](${prob.folderName}/${fileName})`);
        }
      }
    }

    const sortedProblems = Array.from(problemMap.values()).sort((a, b) => a.id - b.id);
    const totalCount = sortedProblems.length;

    let catalogContent = (
      `# ⚡ LeetCode Submissions — Data Structures & Algorithms\n\n` +
      `**Curated Data Structures and Algorithms Solutions** organized by problem ID and difficulty.\n\n` +
      `[![LeetCode](https://img.shields.io/badge/LeetCode-DSA_Solutions-FFA116?logo=leetcode&logoColor=black)](https://leetcode.com/${owner}/)\n` +
      `[![Problems Solved](https://img.shields.io/badge/Problems_Solved-${totalCount}-brightgreen)](#-problem-catalog)\n\n` +
      `---\n\n` +
      `## 📚 Problem Catalog\n\n` +
      `| # | Problem Name | Difficulty | Solutions |\n` +
      `| :--- | :--- | :--- | :--- |\n`
    );

    for (const prob of sortedProblems) {
      const solsStr = prob.solutions.length > 0 ? prob.solutions.join(' ') : '—';
      catalogContent += `| ${prob.id} | [${prob.title}](${prob.folderName}/) | \`${prob.difficulty}\` | ${solsStr} |\n`;
    }

    catalogContent += `\n---\n\n<div align="center"><sub>Synced automatically with <a href="https://github.com/NINJA981/leetcode-submissions">LeetSync Squads</a></sub></div>\n`;

    const currentReadme = await this.getFile(owner, repo, 'README.md', branch);
    const putPayload = {
      message: 'Update problem catalog in README.md - LeetSync Squads',
      content: btoa(unescape(encodeURIComponent(catalogContent))),
      branch,
    };
    if (currentReadme?.sha) {
      putPayload.sha = currentReadme.sha;
    }

    await this.request(`/repos/${owner}/${repo}/contents/README.md`, {
      method: 'PUT',
      body: JSON.stringify(putPayload),
    });

    return totalCount;
  }
}
