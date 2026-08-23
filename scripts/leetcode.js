/**
 * LeetCode GraphQL & REST API Client for LeetSync Squads
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
        throw new Error(`LeetCode GraphQL error: HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.errors && data.errors.length > 0) {
        throw new Error(data.errors.map(e => e.message).join(', '));
      }

      return data.data;
    } catch (err) {
      console.error('[LeetCodeAPI] Query failed:', err);
      throw err;
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
   * Fetch today's official LeetCode Daily Challenge problem.
   */
  static async getDailyChallenge() {
    const gql = `
      query questionOfToday {
        activeDailyCodingChallengeQuestion {
          date
          link
          question {
            questionId
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
    const item = data?.activeDailyCodingChallengeQuestion;
    if (!item) return null;

    return {
      date: item.date,
      link: `${LEETCODE_BASE_URL}${item.link}`,
      question: item.question,
    };
  }

  /**
   * Fetch full submission details (code, runtime, memory, percentiles, notes) by submission ID.
   */
  static async getSubmissionDetails(submissionId) {
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
          notes
          lang {
            name
            verboseName
          }
          question {
            questionId
            questionFrontendId
            title
            titleSlug
          }
        }
      }
    `;
    const data = await this.query(gql, { submissionId: parseInt(submissionId, 10) });
    return data?.submissionDetails || null;
  }

  /**
   * Fetch full question HTML content and difficulty for a problem slug.
   */
  static async getQuestionData(titleSlug) {
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
    const data = await this.query(gql, { titleSlug });
    return data?.question || null;
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
      hasNext = listObj?.hasNext || false;

      for (const sub of submissions) {
        if (sub.statusDisplay === 'Accepted' && !seenProblems.has(sub.titleSlug)) {
          seenProblems.add(sub.titleSlug);
          allAccepted.push(sub);
          if (onProgress) {
            onProgress(allAccepted.length, sub);
          }
        }
      }

      if (submissions.length === 0) break;
      offset += limit;

      // Polite delay between batches
      await new Promise(r => setTimeout(r, 400));
    }

    return allAccepted;
  }
}

/**
 * Mapping from LeetCode language names to file extensions matching LeetSync.
 */
export const LANGUAGE_EXTENSIONS = {
  python: '.py',
  python3: '.py',
  pythondata: '.py',
  pandas: '.py',
  pyspark: '.py',
  java: '.java',
  cpp: '.cpp',
  'c++': '.cpp',
  c: '.c',
  csharp: '.cs',
  'c#': '.cs',
  javascript: '.js',
  js: '.js',
  typescript: '.ts',
  ts: '.ts',
  golang: '.go',
  go: '.go',
  rust: '.rs',
  rs: '.rs',
  kotlin: '.kt',
  swift: '.swift',
  ruby: '.rb',
  php: '.php',
  scala: '.scala',
  dart: '.dart',
  mysql: '.sql',
  mssql: '.sql',
  postgresql: '.sql',
  oraclesql: '.sql',
  sql: '.sql',
  bash: '.sh',
  r: '.r',
  elixir: '.ex',
  erlang: '.erl',
  racket: '.rkt',
};

export function getFileExtension(lang) {
  if (!lang) return '.txt';
  const normalized = lang.trim().toLowerCase();
  return LANGUAGE_EXTENSIONS[normalized] || '.txt';
}

export function getBadgeColor(difficulty) {
  const map = {
    Easy: 'brightgreen',
    Medium: 'orange',
    Hard: 'red',
  };
  return map[difficulty] || 'lightgrey';
}
