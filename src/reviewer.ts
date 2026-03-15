import Anthropic from "@anthropic-ai/sdk";
import * as core from "@actions/core";
import { ReviewConfig, FileDiff, ReviewComment, ReviewSummary, Severity, Category } from "./types";
import { buildSystemPrompt, buildFileReviewPrompt, buildSummaryPrompt } from "./prompts";

const VALID_SEVERITIES: Severity[] = ["critical", "warning", "info"];
const VALID_CATEGORIES: Category[] = ["bug", "solid", "security", "performance", "style"];

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callClaude(
  client: Anthropic,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      const block = response.content[0];
      if (block.type === "text") {
        return block.text;
      }
      throw new Error(`Unexpected response block type: ${block.type}`);
    } catch (error: unknown) {
      const isRetryable =
        error instanceof Anthropic.RateLimitError ||
        error instanceof Anthropic.InternalServerError ||
        error instanceof Anthropic.APIConnectionError ||
        (error instanceof Anthropic.APIError && [529, 502, 503, 504].includes(error.status));

      if (isRetryable && attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        core.warning(`Retryable error, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Exhausted all retries");
}

function parseComments(raw: string, file: FileDiff): ReviewComment[] {
  try {
    // Strip markdown fences if present
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.comments || !Array.isArray(parsed.comments)) {
      return [];
    }

    return parsed.comments
      .filter((c: Record<string, unknown>) => {
        if (typeof c.file !== "string") return false;
        if (typeof c.body !== "string") return false;
        const line = Number(c.line);
        if (!Number.isInteger(line) || line < 1) return false;
        return true;
      })
      .map((c: Record<string, unknown>) => ({
        file: String(c.file),
        line: Number(c.line),
        body: String(c.body),
        severity: VALID_SEVERITIES.includes(c.severity as Severity) ? (c.severity as Severity) : "info",
        category: VALID_CATEGORIES.includes(c.category as Category) ? (c.category as Category) : "style",
      }))
      .filter((c: ReviewComment) => {
        // Validate that the line number exists in the diff
        const validLines = file.hunks.flatMap((h) =>
          h.lines.filter((l) => l.type === "added" && l.newLineNumber !== null).map((l) => l.newLineNumber!),
        );
        return validLines.includes(c.line);
      });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to parse Claude response for ${file.path}: ${message}`);
    core.debug(`Raw response preview for ${file.path}: ${raw.slice(0, 200)}`);
    return [];
  }
}

async function reviewFile(
  file: FileDiff,
  config: ReviewConfig,
  client: Anthropic,
  systemPrompt: string,
): Promise<ReviewComment[]> {
  core.info(`Reviewing ${file.path} (${file.additions}+ ${file.deletions}-)`);

  const userPrompt = buildFileReviewPrompt(file);
  const response = await callClaude(client, config.model, systemPrompt, userPrompt);
  const comments = parseComments(response, file);

  core.info(`  Found ${comments.length} comments`);
  return comments;
}

export async function reviewFiles(
  files: FileDiff[],
  config: ReviewConfig,
  client: Anthropic,
): Promise<ReviewComment[]> {
  const systemPrompt = buildSystemPrompt(config);
  const allComments: ReviewComment[] = [];

  const reviewable = files.filter((f) => {
    if (f.isBinary || f.hunks.length === 0) {
      core.info(`Skipping ${f.path} (binary or no hunks)`);
      return false;
    }
    return true;
  });

  for (let i = 0; i < reviewable.length; i += config.concurrency) {
    const batch = reviewable.slice(i, i + config.concurrency);
    const results = await Promise.all(
      batch.map((file) => reviewFile(file, config, client, systemPrompt)),
    );
    allComments.push(...results.flat());
  }

  return allComments;
}

export async function generateSummary(
  comments: ReviewComment[],
  fileCount: number,
  config: ReviewConfig,
  client: Anthropic,
): Promise<ReviewSummary> {
  const criticalCount = comments.filter((c) => c.severity === "critical").length;
  const prompt = buildSummaryPrompt(fileCount, comments.length, criticalCount);

  try {
    const response = await callClaude(
      client,
      config.model,
      "You are a code review summarizer. Respond with valid JSON only.",
      prompt,
    );

    const cleaned = response.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      summary: String(parsed.summary || "Review completed."),
      comments,
      score: Math.min(10, Math.max(1, Number(parsed.score) || 7)),
    };
  } catch {
    core.warning("Failed to generate summary, using fallback");
    return {
      summary: `Review completed. Found ${comments.length} issues across ${fileCount} files.`,
      comments,
      score: comments.length === 0 ? 9 : criticalCount > 0 ? 4 : 7,
    };
  }
}
