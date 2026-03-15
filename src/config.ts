import * as core from "@actions/core";
import { ReviewConfig } from "./types";

const VALID_SCOPES = ["bugs", "solid", "security", "performance", "style"];

export function getConfig(): ReviewConfig {
  const anthropicApiKey = core.getInput("anthropic-api-key", { required: true });
  const githubToken = core.getInput("github-token", { required: true });
  const model = core.getInput("model") || "claude-sonnet-4-5-20250929";
  const maxFiles = parseInt(core.getInput("max-files") || "20", 10);
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

  if (isNaN(maxFiles) || maxFiles < 1) {
    core.warning(`Invalid max-files value, using default of 20`);
    return {
      anthropicApiKey,
      githubToken,
      model,
      maxFiles: 20,
      reviewScope,
      language,
    };
  }

  core.setSecret(anthropicApiKey);

  return {
    anthropicApiKey,
    githubToken,
    model,
    maxFiles,
    reviewScope,
    language,
  };
}
