/**
 * LeetCode GraphQL client. Requests run with the user's own leetcode.com
 * session (cookies + CSRF token); nothing here talks to third parties.
 */

const LEETCODE_GRAPHQL_URL = 'https://leetcode.com/graphql';
const LEETCODE_BASE_URL = 'https://leetcode.com';
export const LEETCODE_STATUS_ACCEPTED = 10;

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class LeetCodeAPI {
  static async getCsrfToken() {
    if (typeof chrome !== 'undefined' && chrome.cookies) {
      try {
        const cookie = await chrome.cookies.get({ url: LEETCODE_BASE_URL, name: 'csrftoken' });
        if (cookie?.value) return cookie.value;
      } catch { /* cookies API unavailable in this context */ }
    }
    return '';
  }

  /**
   * Execute a GraphQL query. Returns `data` (possibly partial) or null.
   * Throws only for rate limiting so long-running loops can back off.
   */
  static async query(query, variables = {}) {
    const csrf = await this.getCsrfToken();
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (csrf) headers['x-csrftoken'] = csrf;

    let response;
    try {
      response = await fetch(LEETCODE_GRAPHQL_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        credentials: 'include',
      });
    } catch (err) {
      console.warn('[LeetCodeAPI] network error:', err.message);
      return null;
    }

    if (response.status === 429) {
      const err = new Error('LeetCode rate limit reached');
      err.rateLimited = true;
      throw err;
    }
    if (!response.ok) return null;

    try {
      const body = await response.json();
      return body.data || null;
    } catch {
      return null;
    }
  }

  static async getCurrentUser() {
    const data = await this.query(`
      query globalData {
        userStatus { isSignedIn username realName avatar userSlug }
      }
    `);
    const status = data?.userStatus;
    return status?.isSignedIn ? status : null;
  }

  /** Solved counts plus the activity calendar used for the heatmap. */
  static async getUserStats(username) {
    let handle = username;
    if (!handle) handle = (await this.getCurrentUser())?.username;
    if (!handle) return null;

    const data = await this.query(`
      query userProfileData($username: String!) {
        matchedUser(username: $username) {
          username
          submitStatsGlobal { acSubmissionNum { difficulty count } }
          userCalendar { streak totalActiveDays submissionCalendar }
        }
      }
    `, { username: handle }).catch(() => null);

    const user = data?.matchedUser;
    if (!user) return null;

    const acList = user.submitStatsGlobal?.acSubmissionNum || [];
    const count = diff => Number(acList.find(e => (e.difficulty || '').toLowerCase() === diff)?.count || 0);
    const easy = count('easy');
    const med = count('medium');
    const hard = count('hard');

    return {
      username: user.username,
      total: count('all') || easy + med + hard,
      easy,
      med,
      hard,
      streak: user.userCalendar?.streak || 0,
      totalActiveDays: user.userCalendar?.totalActiveDays || 0,
      submissionCalendar: user.userCalendar?.submissionCalendar || '{}',
    };
  }

  static async getRecentAcSubmissions(username, limit = 20) {
    if (!username) return [];
    const data = await this.query(`
      query recentAcSubmissions($username: String!, $limit: Int!) {
        recentAcSubmissionList(username: $username, limit: $limit) { id title titleSlug timestamp }
      }
    `, { username, limit }).catch(() => null);
    return data?.recentAcSubmissionList || [];
  }

  static async getDailyChallenge() {
    const data = await this.query(`
      query questionOfToday {
        activeDailyCodingChallengeQuestion {
          date
          link
          question { questionFrontendId title titleSlug difficulty topicTags { name slug } }
        }
      }
    `).catch(() => null);
    const challenge = data?.activeDailyCodingChallengeQuestion;
    if (!challenge?.question) return null;
    return {
      date: challenge.date,
      id: challenge.question.questionFrontendId,
      title: challenge.question.title,
      slug: challenge.question.titleSlug,
      difficulty: challenge.question.difficulty,
      url: `${LEETCODE_BASE_URL}${challenge.link}`,
      topics: (challenge.question.topicTags || []).map(t => t.name),
    };
  }

  /** Upcoming weekly/biweekly contests: [{ title, slug, startTime (ms), duration (s) }]. */
  static async getUpcomingContests() {
    const data = await this.query(`
      query upcomingContests {
        upcomingContests { title titleSlug startTime duration }
      }
    `).catch(() => null);
    return (data?.upcomingContests || [])
      .map(c => ({ title: c.title, slug: c.titleSlug, startTime: Number(c.startTime) * 1000, duration: Number(c.duration) || 5400 }))
      .filter(c => c.slug && Number.isFinite(c.startTime))
      .sort((a, b) => a.startTime - b.startTime);
  }

  /**
   * Walk the signed-in user's full submission history (newest first) and keep
   * the latest accepted submission per problem.
   */
  static async fetchAllAcceptedSubmissions(onProgress = null, { maxPages = 250 } = {}) {
    const limit = 20;
    const accepted = [];
    const seen = new Set();
    let offset = 0;
    let lastKey = null;

    for (let page = 0; page < maxPages; page++) {
      let data = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          data = await this.query(`
            query submissionList($offset: Int!, $limit: Int!, $lastKey: String) {
              submissionList(offset: $offset, limit: $limit, lastKey: $lastKey) {
                lastKey
                hasNext
                submissions { id statusDisplay lang runtime timestamp title memory titleSlug }
              }
            }
          `, { offset, limit, lastKey });
          break;
        } catch (err) {
          if (!err.rateLimited) throw err;
          await sleep(2000 * (attempt + 1));
        }
      }

      const list = data?.submissionList;
      const submissions = list?.submissions || [];
      if (submissions.length === 0) break;

      for (const sub of submissions) {
        if (sub.statusDisplay === 'Accepted' && sub.titleSlug && !seen.has(sub.titleSlug)) {
          seen.add(sub.titleSlug);
          accepted.push(sub);
        }
      }
      if (onProgress) onProgress(accepted.length, page + 1);

      if (!list.hasNext) break;
      lastKey = list.lastKey || null;
      offset += limit;
      await sleep(350);
    }

    return accepted;
  }

  static async getSubmissionDetails(submissionId) {
    if (!/^\d+$/.test(String(submissionId || ''))) return null;
    const data = await this.query(`
      query submissionDetails($submissionId: Int!) {
        submissionDetails(submissionId: $submissionId) {
          runtimeDisplay
          runtimePercentile
          memoryDisplay
          memoryPercentile
          code
          timestamp
          statusCode
          lang { name verboseName }
          question { questionId questionFrontendId title titleSlug difficulty content }
        }
      }
    `, { submissionId: Number(submissionId) }).catch(() => null);
    return data?.submissionDetails || null;
  }

  static async getQuestionDetails(titleSlug) {
    if (!titleSlug) return null;
    const data = await this.query(`
      query questionData($titleSlug: String!) {
        question(titleSlug: $titleSlug) {
          questionId questionFrontendId title titleSlug content difficulty
          topicTags { name slug }
        }
      }
    `, { titleSlug }).catch(() => null);
    return data?.question || null;
  }
}
