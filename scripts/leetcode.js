/**
 * LeetCode GraphQL & REST API Client for LeetSync Squads
 * Real production queries with authenticated session support.
 */

const LEETCODE_GRAPHQL_URL = 'https://leetcode.com/graphql';
const LEETCODE_BASE_URL = 'https://leetcode.com';

export class LeetCodeAPI {
  /**
   * Execute an authenticated GraphQL query against LeetCode.
   */
  static async query(query, variables = {}) {
    try {
      const response = await fetch(LEETCODE_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        credentials: 'include', // Includes active browser session cookies
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (data.errors && data.errors.length > 0) {
        // If matchedUser error, return data if present or null without throwing
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
    if (!username) return null;
    const gql = `
      query userProfileData($username: String!) {
        matchedUser(username: $username) {
          username
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
      const data = await this.query(gql, { username });
      const user = data?.matchedUser;
      if (!user) return null;

      const acList = user.submitStatsGlobal?.acSubmissionNum || [];
      const getCount = (diff) => acList.find(x => x.difficulty.toLowerCase() === diff.toLowerCase())?.count || 0;

      return {
        username: user.username,
        streak: user.userCalendar?.streak || 0,
        total: getCount('all'),
        easy: getCount('easy'),
        med: getCount('medium'),
        hard: getCount('hard'),
      };
    } catch (err) {
      return null;
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
  static async fetchAllAcceptedSubmissions(onProgress = null) {
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

    return allAccepted;
  }
}
