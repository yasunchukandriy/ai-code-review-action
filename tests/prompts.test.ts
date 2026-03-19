import { buildSystemPrompt, buildFileReviewPrompt, buildSummaryPrompt } from "../src/prompts";
import { ReviewConfig, FileDiff } from "../src/types";

const baseConfig: ReviewConfig = {
  anthropicApiKey: "sk-test",
  githubToken: "ghp_test",
  model: "claude-sonnet-4-5-20250514",
  maxFiles: 20,
  concurrency: 5,
  reviewScope: ["bugs", "security", "performance"],
  language: "en",
};

describe("buildSystemPrompt", () => {
  it("includes all scope keywords", () => {
    const prompt = buildSystemPrompt(baseConfig);
    expect(prompt).toContain("bugs, security, performance");
  });

  it("includes English language when set to en", () => {
    const prompt = buildSystemPrompt(baseConfig);
    expect(prompt).toContain("English");
  });

  it("includes raw language code for non-English", () => {
    const config = { ...baseConfig, language: "de" };
    const prompt = buildSystemPrompt(config);
    expect(prompt).toContain("de");
    expect(prompt).not.toContain("English");
  });

  it("includes JSON response format instructions", () => {
    const prompt = buildSystemPrompt(baseConfig);
    expect(prompt).toContain('"comments"');
    expect(prompt).toContain("valid JSON");
  });
});

describe("buildFileReviewPrompt", () => {
  const fileDiff: FileDiff = {
    path: "src/app.ts",
    oldPath: null,
    isBinary: false,
    isRenamed: false,
    additions: 2,
    deletions: 1,
    hunks: [
      {
        oldStart: 1,
        oldCount: 3,
        newStart: 1,
        newCount: 4,
        lines: [
          { type: "context", content: "import express from 'express';", oldLineNumber: 1, newLineNumber: 1 },
          { type: "removed", content: "const port = 3000;", oldLineNumber: 2, newLineNumber: null },
          { type: "added", content: "const port = process.env.PORT || 3000;", oldLineNumber: null, newLineNumber: 2 },
          { type: "added", content: "const host = '0.0.0.0';", oldLineNumber: null, newLineNumber: 3 },
        ],
      },
    ],
  };

  it("includes the file path", () => {
    const prompt = buildFileReviewPrompt(fileDiff);
    expect(prompt).toContain("src/app.ts");
  });

  it("includes addition and deletion counts", () => {
    const prompt = buildFileReviewPrompt(fileDiff);
    expect(prompt).toContain("Additions: 2");
    expect(prompt).toContain("Deletions: 1");
  });

  it("includes diff content with +/- prefixes", () => {
    const prompt = buildFileReviewPrompt(fileDiff);
    expect(prompt).toContain("+2: const port = process.env.PORT || 3000;");
    expect(prompt).toContain("-2: const port = 3000;");
    expect(prompt).toContain(" 1: import express from 'express';");
  });

  it("includes hunk header", () => {
    const prompt = buildFileReviewPrompt(fileDiff);
    expect(prompt).toContain("@@ -1,3 +1,4 @@");
  });
});

describe("buildSummaryPrompt", () => {
  it("includes file count", () => {
    const prompt = buildSummaryPrompt(5, 10, 2);
    expect(prompt).toContain("5 files");
  });

  it("includes comment count", () => {
    const prompt = buildSummaryPrompt(5, 10, 2);
    expect(prompt).toContain("10 comments");
  });

  it("includes critical count", () => {
    const prompt = buildSummaryPrompt(5, 10, 2);
    expect(prompt).toContain("2 critical");
  });

  it("requests JSON response", () => {
    const prompt = buildSummaryPrompt(1, 0, 0);
    expect(prompt).toContain("valid JSON");
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"score"');
  });
});
