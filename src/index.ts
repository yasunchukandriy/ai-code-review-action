import * as core from "@actions/core";
import * as github from "@actions/github";
import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "./config";
import { parseDiff } from "./diff-parser";
import { reviewFiles, generateSummary } from "./reviewer";
import { getPRContext, getPRDiff, postReviewComments, postSummaryComment } from "./github";

async function run(): Promise<void> {
  try {
    // 1. Read configuration
    const config = getConfig();
    core.info(`Model: ${config.model}`);
    core.info(`Review scope: ${config.reviewScope.join(", ")}`);
    core.info(`Max files: ${config.maxFiles}`);

    // 2. Get PR context and diff
    const octokit = github.getOctokit(config.githubToken);
    const ctx = getPRContext();
    core.info(`Reviewing PR #${ctx.pullNumber} in ${ctx.owner}/${ctx.repo}`);

    const diff = await getPRDiff(octokit, ctx);
    if (!diff) {
      core.info("No diff found, nothing to review");
      return;
    }

    // 3. Parse diff into structured file changes
    const files = parseDiff(diff);
    core.info(`Parsed ${files.length} files from diff`);

    // 4. Filter to reviewable files within limit
    const reviewableFiles = files
      .filter((f) => !f.isBinary && f.hunks.length > 0)
      .slice(0, config.maxFiles);

    if (reviewableFiles.length === 0) {
      core.info("No reviewable files found (all binary or filtered out)");
      return;
    }

    core.info(`Reviewing ${reviewableFiles.length} files`);

    // 5. Review files with Claude
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const comments = await reviewFiles(reviewableFiles, config, client);
    core.info(`Total comments: ${comments.length}`);

    // 6. Generate summary
    const summary = await generateSummary(comments, reviewableFiles.length, config, client);
    core.info(`Review score: ${summary.score}/10`);

    // 7. Post results to GitHub
    await postReviewComments(octokit, ctx, comments);
    await postSummaryComment(octokit, ctx, summary);

    // 8. Set outputs
    core.setOutput("review-score", summary.score);
    core.setOutput("total-comments", comments.length);
    core.setOutput("critical-count", comments.filter((c) => c.severity === "critical").length);

    core.info("Review complete!");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`AI Code Review failed: ${message}`);
  }
}

run();
