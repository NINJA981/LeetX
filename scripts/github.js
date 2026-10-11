/**
 * LeetX Squads - GitHub REST client.
 * Commits each accepted solution as one atomic commit (Git Data API) with the
 * original submission time, and maintains a README catalog at the repo root.
 */

import { LeetCodeAPI } from './leetcode.js';

const API = 'https://api.github.com';
// v1.x wrote this stub when it could not fetch code; such files are re-synced.
const PLACEHOLDER_PREFIX = '// Solution for ';
const PLACEHOLDER_MAX_BYTES = 200;

const EXTENSIONS = {
  python: 'py', python3: 'py', pythondata: 'py', java: 'java', cpp: 'cpp', c: 'c', csharp: 'cs',
  javascript: 'js', typescript: 'ts', golang: 'go', go: 'go', rust: 'rs', ruby: 'rb', swift: 'swift',
  kotlin: 'kt', scala: 'scala', php: 'php', dart: 'dart', elixir: 'ex', erlang: 'erl', racket: 'rkt',
  mysql: 'sql', mssql: 'sql', oraclesql: 'sql', postgresql: 'sql', bash: 'sh',
};
const LANG_LABELS = {
  py: 'Python', java: 'Java', js: 'JavaScript', cpp: 'C++', c: 'C', ts: 'TypeScript', go: 'Go', rs: 'Rust',
  sql: 'SQL', cs: 'C#', kt: 'Kotlin', swift: 'Swift', rb: 'Ruby', php: 'PHP', scala: 'Scala', dart: 'Dart',
  ex: 'Elixir', erl: 'Erlang', rkt: 'Racket', sh: 'Bash',
};
const SOLUTION_EXT_PATTERN = Object.keys(LANG_LABELS).join('|');

export function getFileExtension(lang) {
  return EXTENSIONS[String(lang || '').toLowerCase()] || 'txt';
}

const encodePath = p => String(p).split('/').map(encodeURIComponent).join('/');
const capitalize = s => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

function decodeBase64Utf8(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export class GitHubAPI {
  constructor(token) {
    this.token = token;
  }

  async request(endpoint, options = {}) {
    const res = await fetch(`${API}${endpoint}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(options.headers || {}),
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      let message = res.statusText;
      try { message = (await res.json()).message || message; } catch { /* non-JSON */ }
      if (res.status === 401) message = 'GitHub token is invalid or expired. Reconnect GitHub in Settings.';
      if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') message = 'GitHub rate limit reached. Try again in a few minutes.';
      throw new GitHubError(res.status, message);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  getUser() {
    return this.request('/user');
  }

  /** Make sure `owner/repoName` exists, creating it (private by default) when missing. */
  async ensureRepository(repoName, { isPrivate = true } = {}) {
    const user = await this.getUser();
    const owner = user.login;
    try {
      const repo = await this.request(`/repos/${encodePath(owner)}/${encodePath(repoName)}`);
      return { owner, repo, created: false };
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    const repo = await this.request('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: repoName,
        description: 'My LeetCode solutions, synced automatically by LeetX Squads.',
        private: isPrivate,
        auto_init: true,
      }),
    });
    return { owner, repo, created: true };
  }

  async getBranchHead(owner, repo, branch) {
    const ref = await this.request(`/repos/${encodePath(owner)}/${encodePath(repo)}/git/ref/heads/${encodePath(branch)}`);
    return ref.object.sha;
  }

  async getTree(owner, repo, branch) {
    const sha = await this.getBranchHead(owner, repo, branch);
    return this.request(`/repos/${encodePath(owner)}/${encodePath(repo)}/git/trees/${sha}?recursive=1`);
  }

  static buildProblemReadme({ title, titleSlug, difficulty, content, frontendId }) {
    const diff = capitalize(difficulty || 'Medium');
    const color = { Easy: 'brightgreen', Medium: 'orange', Hard: 'red' }[diff] || 'lightgrey';
    const heading = frontendId ? `${frontendId}. ${title}` : title;
    return (
      `<h2><a href="https://leetcode.com/problems/${titleSlug}/">${heading}</a></h2>\n` +
      `<img src="https://img.shields.io/badge/Difficulty-${diff}-${color}" alt="Difficulty: ${diff}" />\n<hr>\n\n` +
      `${(content || '').trim()}\n`
    );
  }

  static formatCommitMessage({ title, frontendId, runtimeDisplay, runtimePercentile, memoryDisplay, memoryPercentile }) {
    const pct = v => (v != null && !Number.isNaN(Number(v)) ? ` (beats ${Number(v).toFixed(1)}%)` : '');
    const name = frontendId ? `${frontendId}. ${title}` : title;
    const metrics = [];
    if (runtimeDisplay && runtimeDisplay !== 'N/A') metrics.push(`Time: ${runtimeDisplay}${pct(runtimePercentile)}`);
    if (memoryDisplay && memoryDisplay !== 'N/A') metrics.push(`Memory: ${memoryDisplay}${pct(memoryPercentile)}`);
    return metrics.length ? `${name} - ${metrics.join(', ')}` : name;
  }

  /**
   * Commit README + solution (+ optional notes) for one problem in a single commit.
   * Uses a fast-forward-only ref update and retries when the branch moved meanwhile.
   */
  async commitProblemSolution(owner, repo, problem) {
    const {
      frontendId, title, titleSlug, difficulty, content, code, lang, notes, timestamp, branch = 'main',
    } = problem;
    if (!code || !String(code).trim()) throw new GitHubError(0, `No source code available for ${titleSlug}`);

    const folder = `${capitalize(difficulty || 'Medium')}/${String(frontendId || 0).padStart(4, '0')}-${titleSlug}`;
    const files = [
      { path: `${folder}/README.md`, content: GitHubAPI.buildProblemReadme({ title, titleSlug, difficulty, content, frontendId }) },
      { path: `${folder}/${titleSlug}.${getFileExtension(lang)}`, content: String(code) },
    ];
    if (notes && notes.trim()) files.push({ path: `${folder}/Notes.md`, content: `# Notes: ${title}\n\n${notes.trim()}\n` });

    const base = `/repos/${encodePath(owner)}/${encodePath(repo)}`;
    const message = GitHubAPI.formatCommitMessage(problem);

    for (let attempt = 1; attempt <= 4; attempt++) {
      const headSha = await this.getBranchHead(owner, repo, branch);
      const headCommit = await this.request(`${base}/git/commits/${headSha}`);
      const tree = await this.request(`${base}/git/trees`, {
        method: 'POST',
        body: JSON.stringify({
          base_tree: headCommit.tree.sha,
          tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
        }),
      });

      // Identical content (e.g. re-submitting the same code) - nothing to commit.
      if (tree.sha === headCommit.tree.sha) return { unchanged: true, folder };

      const payload = { message, tree: tree.sha, parents: [headSha] };
      if (timestamp) {
        const date = new Date(Number(timestamp) * 1000).toISOString();
        payload.author = { name: headCommit.author?.name || owner, email: headCommit.author?.email || `${owner}@users.noreply.github.com`, date };
        payload.committer = payload.author;
      }
      const commit = await this.request(`${base}/git/commits`, { method: 'POST', body: JSON.stringify(payload) });

      try {
        await this.request(`${base}/git/refs/heads/${encodePath(branch)}`, {
          method: 'PATCH',
          body: JSON.stringify({ sha: commit.sha, force: false }),
        });
        return { commitSha: commit.sha, folder };
      } catch (err) {
        // 422 = not a fast-forward: someone pushed in between. Rebuild on the new head.
        if (err.status !== 422 || attempt === 4) throw err;
        await new Promise(r => setTimeout(r, 300 * attempt));
      }
    }
    return null;
  }

  /**
   * Slugs that already have a real solution committed. v1.x placeholder stubs
   * are excluded so their real code gets synced.
   */
  async getExistingProblemSlugs(owner, repo, branch = 'main') {
    let tree;
    try {
      tree = await this.getTree(owner, repo, branch);
    } catch (err) {
      if (err.status === 404 || err.status === 409) return new Set(); // empty repo / missing branch
      throw err;
    }

    const solutionFile = new RegExp(`(?:^|/)\\d+-([a-z0-9-]+)/([a-z0-9-]+)\\.(?:${SOLUTION_EXT_PATTERN}|txt)$`, 'i');
    const existing = new Set();
    const suspects = [];

    for (const item of tree.tree || []) {
      if (item.type !== 'blob') continue;
      const m = item.path.match(solutionFile);
      if (!m) continue;
      const slug = m[1].toLowerCase();
      if (item.size <= PLACEHOLDER_MAX_BYTES) suspects.push({ slug, sha: item.sha });
      else existing.add(slug);
    }

    const base = `/repos/${encodePath(owner)}/${encodePath(repo)}`;
    for (const { slug, sha } of suspects) {
      if (existing.has(slug)) continue;
      try {
        const blob = await this.request(`${base}/git/blobs/${sha}`);
        if (!decodeBase64Utf8(blob.content).startsWith(PLACEHOLDER_PREFIX)) existing.add(slug);
      } catch {
        existing.add(slug);
      }
    }
    return existing;
  }

  /** Regenerate the root README problem table from the repository tree. */
  async updateCatalogReadme(owner, repo, branch = 'main') {
    const tree = await this.getTree(owner, repo, branch);
    const pattern = new RegExp(`^(?:(Easy|Medium|Hard)/)?(\\d+)-([a-z0-9-]+)/(README\\.md|Notes\\.md|[a-z0-9-]+\\.(${SOLUTION_EXT_PATTERN}))$`, 'i');
    const problems = new Map();

    for (const item of tree.tree || []) {
      const m = item.path.match(pattern);
      if (!m) continue;
      const [, diffFolder, id, slug, fileName, ext] = m;
      const folder = diffFolder ? `${diffFolder}/${id}-${slug}` : `${id}-${slug}`;
      if (!problems.has(slug)) {
        problems.set(slug, {
          id: Number(id),
          slug,
          folder,
          title: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          difficulty: diffFolder ? capitalize(diffFolder) : null,
          solutions: [],
          hasNotes: false,
        });
      }
      const p = problems.get(slug);
      if (fileName === 'Notes.md') p.hasNotes = true;
      else if (ext) p.solutions.push(`[${LANG_LABELS[ext.toLowerCase()] || ext.toUpperCase()}](${encodeURI(`${folder}/${fileName}`)})`);
    }

    for (const p of problems.values()) {
      if (p.difficulty) continue;
      const q = await LeetCodeAPI.getQuestionDetails(p.slug).catch(() => null);
      p.difficulty = q?.difficulty || 'Medium';
      if (q?.title) p.title = q.title;
    }

    const sorted = [...problems.values()].sort((a, b) => a.id - b.id);
    const counts = { Easy: 0, Medium: 0, Hard: 0 };
    sorted.forEach(p => { counts[p.difficulty] = (counts[p.difficulty] || 0) + 1; });

    let md = '# LeetCode Solutions\n\n';
    md += `**${sorted.length}** problems solved — ${counts.Easy} easy · ${counts.Medium} medium · ${counts.Hard} hard\n\n`;
    md += '| # | Problem | Difficulty | Solution | Notes |\n| ---: | :--- | :--- | :--- | :---: |\n';
    for (const p of sorted) {
      md += `| ${p.id} | [${p.title}](https://leetcode.com/problems/${p.slug}/) | ${p.difficulty} | ${p.solutions.join(' · ') || '—'} | ${p.hasNotes ? `[📝](${encodeURI(`${p.folder}/Notes.md`)})` : ''} |\n`;
    }
    md += '\n<sub>Synced with LeetX Squads.</sub>\n';

    const base = `/repos/${encodePath(owner)}/${encodePath(repo)}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let sha;
      try {
        const current = await this.request(`${base}/contents/README.md?ref=${encodeURIComponent(branch)}`);
        if (current?.content && decodeBase64Utf8(current.content) === md) return sorted.length;
        sha = current?.sha;
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      try {
        await this.request(`${base}/contents/README.md`, {
          method: 'PUT',
          body: JSON.stringify({ message: 'Update solutions catalog', content: encodeBase64Utf8(md), branch, ...(sha ? { sha } : {}) }),
        });
        return sorted.length;
      } catch (err) {
        if (err.status !== 409 || attempt === 3) throw err; // 409: README changed underneath us
      }
    }
    return sorted.length;
  }
}
