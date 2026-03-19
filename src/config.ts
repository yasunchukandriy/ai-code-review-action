import * as core from "@actions/core";
import { ReviewConfig } from "./types";

const VALID_SCOPES = ["bugs", "solid", "security", "performance", "style"];

export function getConfig(): ReviewConfig {
  const anthropicApiKey = core.getInput("anthropic-api-key", { required: true });
  const githubToken = core.getInput("github-token", { required: true });
  const model = core.getInput("model") || "claude-sonnet-4-5-20250514";
  const maxFilesRaw = parseInt(core.getInput("max-files") || "20", 10);
  const concurrencyRaw = parseInt(core.getInput("concurrency") || "5", 10);
  const language = core.getInput("language") || "en";

  const scopeRaw = core.getInput("review-scope") || "bugs,solid,security,performance";
  const reviewScope = scopeRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => VALID_SCOPES.includes(s));

  if (reviewScope.length === 0) {
    core.warning(`No valid review scopes found in "${scopeRaw}", using defaults`);
    reviewScope.push("bugs", "solid", "security", "performance");
  }

  core.setSecret(anthropicApiKey);

  if (anthropicApiKey.trim() === "") {
    throw new Error("anthropic-api-key must not be empty or whitespace-only");
  }

  let maxFiles = maxFilesRaw;
  if (isNaN(maxFilesRaw) || maxFilesRaw < 1 || maxFilesRaw > 100) {
    core.warning(`Invalid max-files value, using default of 20`);
    maxFiles = 20;
  }

  let concurrency = concurrencyRaw;
  if (isNaN(concurrencyRaw) || concurrencyRaw < 1 || concurrencyRaw > 20) {
    core.warning(`Invalid concurrency value, using default of 5`);
    concurrency = 5;
  }

  return {
    anthropicApiKey,
    githubToken,
    model,
    maxFiles,
    concurrency,
    reviewScope,
    language,
  };
}
