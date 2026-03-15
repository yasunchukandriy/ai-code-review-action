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
      const isRateLimit =
        error instanceof Anthropic.RateLimitError ||
        (error instanceof Anthropic.APIError && error.status === 529);

      if (isRateLimit && attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        core.warning(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
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
      .filter((c: Record<string, unknown>) => c.file && c.line && c.body)
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
  } catch {
    core.warning(`Failed to parse Claude response for ${file.path}`);
    return [];
  }
}

export async function reviewFiles(files: FileDiff[], config: ReviewConfig): Promise<ReviewComment[]> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const systemPrompt = buildSystemPrompt(config);
  const allComments: ReviewComment[] = [];

  for (const file of files) {
    if (file.isBinary || file.hunks.length === 0) {
      core.info(`Skipping ${file.path} (binary or no hunks)`);
      continue;
    }

    core.info(`Reviewing ${file.path} (${file.additions}+ ${file.deletions}-)`);

    const userPrompt = buildFileReviewPrompt(file);
    const response = await callClaude(client, config.model, systemPrompt, userPrompt);
    const comments = parseComments(response, file);

    core.info(`  Found ${comments.length} comments`);
    allComments.push(...comments);
  }

  return allComments;
}

export async function generateSummary(
  comments: ReviewComment[],
  fileCount: number,
  config: ReviewConfig,
): Promise<ReviewSummary> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
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
