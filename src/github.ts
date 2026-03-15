import * as github from "@actions/github";
import * as core from "@actions/core";
import { ReviewComment, ReviewSummary } from "./types";

type Octokit = ReturnType<typeof github.getOctokit>;

interface PullRequestContext {
  owner: string;
  repo: string;
  pullNumber: number;
  commitSha: string;
}

export function getPRContext(): PullRequestContext {
  const { context } = github;

  if (!context.payload.pull_request) {
    throw new Error("This action can only run on pull_request events");
  }

  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pullNumber: context.payload.pull_request.number,
    commitSha: context.payload.pull_request.head.sha,
  };
}

export async function getPRDiff(octokit: Octokit, ctx: PullRequestContext): Promise<string> {
  const response = await octokit.rest.pulls.get({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.pullNumber,
    mediaType: { format: "diff" },
  });

  // When requesting diff format, the response data is a string
  return response.data as unknown as string;
}

export async function postReviewComments(
  octokit: Octokit,
  ctx: PullRequestContext,
  comments: ReviewComment[],
): Promise<void> {
  if (comments.length === 0) {
    core.info("No comments to post");
    return;
  }

  const severityIcon: Record<string, string> = {
    critical: "\u{1F6A8}",
    warning: "\u26A0\uFE0F",
    info: "\u{1F4A1}",
  };

  const reviewComments = comments.map((c) => ({
    path: c.file,
    line: c.line,
    body: `${severityIcon[c.severity] || ""} **[${c.severity.toUpperCase()}]** (${c.category})\n\n${c.body}`,
  }));

  try {
    await octokit.rest.pulls.createReview({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.pullNumber,
      commit_id: ctx.commitSha,
      event: "COMMENT",
      comments: reviewComments,
    });
    core.info(`Posted review with ${reviewComments.length} inline comments`);
  } catch (error: unknown) {
    // If batch review fails, fall back to individual comments
    core.warning(`Batch review failed, posting comments individually: ${error}`);
    let posted = 0;
    for (const comment of reviewComments) {
      try {
        await octokit.rest.pulls.createReviewComment({
          owner: ctx.owner,
          repo: ctx.repo,
          pull_number: ctx.pullNumber,
          commit_id: ctx.commitSha,
          ...comment,
        });
        posted++;
      } catch (innerError: unknown) {
        core.warning(`Failed to post comment on ${comment.path}:${comment.line}: ${innerError}`);
      }
    }
    core.info(`Posted ${posted}/${reviewComments.length} comments individually`);
  }
}

export async function postSummaryComment(
  octokit: Octokit,
  ctx: PullRequestContext,
  summary: ReviewSummary,
): Promise<void> {
  const criticalCount = summary.comments.filter((c) => c.severity === "critical").length;
  const warningCount = summary.comments.filter((c) => c.severity === "warning").length;
  const infoCount = summary.comments.filter((c) => c.severity === "info").length;

  const scoreEmoji = summary.score >= 8 ? "\u2705" : summary.score >= 5 ? "\u{1F7E1}" : "\u{1F534}";

  const body = `## \u{1F916} AI Code Review

${summary.summary}

### Stats
| Metric | Value |
|--------|-------|
| Score | ${scoreEmoji} **${summary.score}/10** |
| Files reviewed | ${new Set(summary.comments.map((c) => c.file)).size} |
| Issues found | ${summary.comments.length} |
| \u{1F6A8} Critical | ${criticalCount} |
| \u26A0\uFE0F Warnings | ${warningCount} |
| \u{1F4A1} Info | ${infoCount} |

---
<sub>Powered by Claude \u00B7 <a href="https://github.com/marketplace">AI Code Review Action</a></sub>`;

  await octokit.rest.issues.createComment({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: ctx.pullNumber,
    body,
  });

  core.info("Posted summary comment");
}
