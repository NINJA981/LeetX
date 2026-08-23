/**
 * LeetCode GraphQL & REST API Client for LeetSync Squads
 * Real production queries with authenticated session support.
 */

const LEETCODE_GRAPHQL_URL = 'https://leetcode.com/graphql';
const LEETCODE_BASE_URL = 'https://leetcode.com';

export class LeetCodeAPI {
  /**
   * Helper to retrieve active CSRF token from browser cookies.
   */
  static async getCsrfToken() {
    if (typeof chrome !== 'undefined' && chrome.cookies) {
      try {
        const cookie = await chrome.cookies.get({ url: 'https://leetcode.com', name: 'csrftoken' });
        if (cookie?.value) return cookie.value;
      } catch (e) {}
    }
    return '';
  }

  /**
   * Execute an authenticated GraphQL query against LeetCode.
   */
  static async query(query, variables = {}) {
    try {
      const csrf = await this.getCsrfToken();
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
      if (csrf) {
        headers['x-csrftoken'] = csrf;
      }

      const response = await fetch(LEETCODE_GRAPHQL_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        credentials: 'include', // Includes active browser session cookies
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (data.errors && data.errors.length > 0) {
        if (data.data) return data.data;
        return null;
      }

      return data.data || null;
    } catch (err) {
      console.warn('[LeetCodeAPI] Query notice:', err.message);
      return null;
    }
  }

  /**
   * Fetch authenticated user's current status and username.
   */
  static async getCurrentUser() {
    const gql = `
      query globalData {
        userStatus {
          isSignedIn
          username
          realName
          avatar
          userSlug
        }
      }
    `;
    const data = await this.query(gql);
    return data?.userStatus || null;
  }

  /**
   * Fetch real user profile stats, streak, and solved count.
   */
  static async getUserStats(username) {
    let userHandle = username;
    if (!userHandle) {
      const activeUser = await this.getCurrentUser();
      userHandle = activeUser?.username;
    }
    if (!userHandle) return null;

    const gql = `
      query userProfileData($username: String!) {
        matchedUser(username: $username) {
          username
          submitStats {
            acSubmissionNum {
              difficulty
              count
              submissions
            }
          }
          submitStatsGlobal {
            acSubmissionNum {
              difficulty
              count
              submissions
            }
          }
          userCalendar {
            streak
            totalActiveDays
          }
        }
      }
    `;

    try {
      const data = await this.query(gql, { username: userHandle });
      const user = data?.matchedUser;
      if (!user) return null;

      const acList = user.submitStatsGlobal?.acSubmissionNum || user.submitStats?.acSubmissionNum || [];
      const getCount = (diff) => {
        const entry = acList.find(e => (e.difficulty || '').toLowerCase() === diff.toLowerCase());
        return entry ? (parseInt(entry.count, 10) || 0) : 0;
      };
      const easy = getCount('Easy');
      const med = getCount('Medium');
      const hard = getCount('Hard');
      const total = getCount('All') || (easy + med + hard);

      return {
        username: user.username,
        streak: user.userCalendar?.streak || 0,
        total,
        easy,
        med,
        hard,
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Fetch public recent accepted submissions for any username.
   */
  static async getRecentAcSubmissions(username, limit = 50) {
    if (!username) return [];
    const gql = `
      query recentAcSubmissions($username: String!, $limit: Int!) {
        recentAcSubmissionList(username: $username, limit: $limit) {
          id
          title
          titleSlug
          timestamp
        }
      }
    `;
    try {
      const data = await this.query(gql, { username, limit });
      return data?.recentAcSubmissionList || [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Fetch today's official Daily Coding Challenge.
   */
  static async getDailyChallenge() {
    const gql = `
      query questionOfToday {
        activeDailyCodingChallengeQuestion {
          date
          link
          question {
            questionFrontendId
            title
            titleSlug
            difficulty
            topicTags {
              name
              slug
            }
          }
        }
      }
    `;

    const data = await this.query(gql);
    const challenge = data?.activeDailyCodingChallengeQuestion;
    if (!challenge) return null;

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

  /**
   * Fetch all paginated submissions for historical backfills.
   */
  static async fetchAllAcceptedSubmissions(onProgress = null, username = '') {
    let offset = 0;
    const limit = 20;
    let hasNext = true;
    const allAccepted = [];
    const seenProblems = new Set();

    const gql = `
      query submissionList($offset: Int!, $limit: Int!, $lastKey: String, $questionSlug: String) {
        submissionList(offset: $offset, limit: $limit, lastKey: $lastKey, questionSlug: $questionSlug) {
          lastKey
          hasNext
          submissions {
            id
            statusDisplay
            lang
            runtime
            timestamp
            url
            title
            memory
            titleSlug
          }
        }
      }
    `;

    try {
      while (hasNext) {
        const data = await this.query(gql, { offset, limit, lastKey: null, questionSlug: null });
        const listObj = data?.submissionList;
        const submissions = listObj?.submissions || [];

        if (!submissions || submissions.length === 0) break;

        for (const sub of submissions) {
          if (sub.statusDisplay === 'Accepted' && !seenProblems.has(sub.titleSlug)) {
            seenProblems.add(sub.titleSlug);
            allAccepted.push(sub);
            if (onProgress) onProgress(allAccepted.length, sub);
          }
        }

        hasNext = Boolean(listObj?.hasNext) && offset < 500;
        offset += limit;
      }
    } catch (e) {
      console.warn('[LeetCodeAPI] submissionList notice:', e);
    }

    // Fallback: If submissionList was empty or forbidden, query recentAcSubmissionList
    if (allAccepted.length === 0 && username) {
      try {
        const recent = await this.getRecentAcSubmissions(username, 50);
        for (const sub of recent) {
          if (!seenProblems.has(sub.titleSlug)) {
            seenProblems.add(sub.titleSlug);
            allAccepted.push({
              id: sub.id,
              title: sub.title,
              titleSlug: sub.titleSlug,
              statusDisplay: 'Accepted',
              timestamp: sub.timestamp,
              lang: 'python3',
              runtime: 'N/A',
              memory: 'N/A',
            });
            if (onProgress) onProgress(allAccepted.length, sub);
          }
        }
      } catch (recentErr) {
        console.warn('[LeetCodeAPI] recentAcSubmissions notice:', recentErr);
      }
    }

    return allAccepted;
  }

  /**
   * Fetch detailed submission metadata including full code and performance metrics.
   */
  static async getSubmissionDetails(submissionId) {
    if (!submissionId) return null;
    const gql = `
      query submissionDetails($submissionId: Int!) {
        submissionDetails(submissionId: $submissionId) {
          runtime
          runtimeDisplay
          runtimePercentile
          memory
          memoryDisplay
          memoryPercentile
          code
          timestamp
          statusCode
          lang {
            name
            verboseName
          }
          question {
            questionId
            questionFrontendId
            title
            titleSlug
            difficulty
            content
          }
        }
      }
    `;

    try {
      const data = await this.query(gql, { submissionId: parseInt(submissionId, 10) });
      return data?.submissionDetails || null;
    } catch (err) {
      console.warn('[LeetCodeAPI] getSubmissionDetails notice:', err.message);
      return null;
    }
  }

  /**
   * Fetch complete question details and HTML description.
   */
  static async getQuestionDetails(titleSlug) {
    if (!titleSlug) return null;
    const gql = `
      query questionData($titleSlug: String!) {
        question(titleSlug: $titleSlug) {
          questionId
          questionFrontendId
          title
          titleSlug
          content
          difficulty
          topicTags {
            name
            slug
          }
        }
      }
    `;

    try {
      const data = await this.query(gql, { titleSlug });
      return data?.question || null;
    } catch (err) {
      console.warn('[LeetCodeAPI] getQuestionDetails notice:', err.message);
      return null;
    }
  }
}

