import Anthropic from "@anthropic-ai/sdk";
import * as core from "@actions/core";
import { reviewFiles, generateSummary } from "../src/reviewer";
import { ReviewConfig, FileDiff, ReviewComment } from "../src/types";

jest.mock("@actions/core");

const mockedCore = jest.mocked(core);

const mockCreate = jest.fn();
const mockClient = { messages: { create: mockCreate } } as unknown as Anthropic;

const baseConfig: ReviewConfig = {
  anthropicApiKey: "sk-ant-test",
  githubToken: "ghp_test",
  model: "claude-sonnet-4-5-20250514",
  maxFiles: 20,
  concurrency: 5,
  reviewScope: ["bugs", "security"],
  language: "en",
};

function makeFileDiff(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    path: "src/app.ts",
    oldPath: null,
    isBinary: false,
    isRenamed: false,
    additions: 1,
    deletions: 0,
    hunks: [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 2,
        lines: [
          { type: "context", content: "line1", oldLineNumber: 1, newLineNumber: 1 },
          { type: "added", content: "line2", oldLineNumber: null, newLineNumber: 2 },
        ],
      },
    ],
    ...overrides,
  };
}

function mockClaudeResponse(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: "text", text }],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("reviewFiles", () => {
  it("calls Claude for each non-binary file and accumulates comments", async () => {
    const file1 = makeFileDiff({ path: "src/a.ts" });
    const file2 = makeFileDiff({ path: "src/b.ts" });

    mockClaudeResponse(JSON.stringify({
      comments: [{ file: "src/a.ts", line: 2, body: "Issue A", severity: "warning", category: "bug" }],
    }));
    mockClaudeResponse(JSON.stringify({
      comments: [{ file: "src/b.ts", line: 2, body: "Issue B", severity: "info", category: "style" }],
    }));

    const comments = await reviewFiles([file1, file2], baseConfig, mockClient);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(comments).toHaveLength(2);
    expect(comments[0].file).toBe("src/a.ts");
    expect(comments[1].file).toBe("src/b.ts");
  });

  it("skips binary files", async () => {
    const binaryFile = makeFileDiff({ isBinary: true, hunks: [] });
    const normalFile = makeFileDiff({ path: "src/b.ts" });

    mockClaudeResponse(JSON.stringify({ comments: [] }));

    await reviewFiles([binaryFile, normalFile], baseConfig, mockClient);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockedCore.info).toHaveBeenCalledWith(expect.stringContaining("Skipping"));
  });

  it("skips files with no hunks", async () => {
    const emptyFile = makeFileDiff({ hunks: [] });

    await reviewFiles([emptyFile], baseConfig, mockClient);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns empty array when Claude returns invalid JSON", async () => {
    const file = makeFileDiff();
    mockClaudeResponse("this is not json at all");

    const comments = await reviewFiles([file], baseConfig, mockClient);

    expect(comments).toHaveLength(0);
    expect(mockedCore.warning).toHaveBeenCalledWith(expect.stringContaining("Failed to parse"));
  });

  it("filters comments with line numbers not in the diff", async () => {
    const file = makeFileDiff();
    mockClaudeResponse(JSON.stringify({
      comments: [
        { file: "src/app.ts", line: 2, body: "Valid", severity: "warning", category: "bug" },
        { file: "src/app.ts", line: 999, body: "Invalid line", severity: "warning", category: "bug" },
      ],
    }));

    const comments = await reviewFiles([file], baseConfig, mockClient);

    expect(comments).toHaveLength(1);
    expect(comments[0].line).toBe(2);
  });

  it("coerces invalid severity to 'info'", async () => {
    const file = makeFileDiff();
    mockClaudeResponse(JSON.stringify({
      comments: [{ file: "src/app.ts", line: 2, body: "Test", severity: "extreme", category: "bug" }],
    }));

    const comments = await reviewFiles([file], baseConfig, mockClient);

    expect(comments).toHaveLength(1);
    expect(comments[0].severity).toBe("info");
  });

  it("coerces invalid category to 'style'", async () => {
    const file = makeFileDiff();
    mockClaudeResponse(JSON.stringify({
      comments: [{ file: "src/app.ts", line: 2, body: "Test", severity: "warning", category: "unknown" }],
    }));

    const comments = await reviewFiles([file], baseConfig, mockClient);

    expect(comments).toHaveLength(1);
    expect(comments[0].category).toBe("style");
  });

  it("retries on rate limit errors", async () => {
    const file = makeFileDiff();

    // First call: rate limit error
    const rateLimitError = new Anthropic.RateLimitError(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "Rate limited" } },
      "Rate limited",
      {},
    );
    mockCreate.mockRejectedValueOnce(rateLimitError);

    // Second call: success
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ comments: [] }) }],
    });

    const comments = await reviewFiles([file], baseConfig, mockClient);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(comments).toHaveLength(0);
    expect(mockedCore.warning).toHaveBeenCalledWith(expect.stringContaining("Retryable error"));
  });

  it("retries on 500 server error", async () => {
    const file = makeFileDiff();

    const serverError = new Anthropic.InternalServerError(
      500,
      { type: "error", error: { type: "server_error", message: "Internal server error" } },
      "Internal server error",
      {},
    );
    mockCreate.mockRejectedValueOnce(serverError);
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ comments: [] }) }],
    });

    const comments = await reviewFiles([file], baseConfig, mockClient);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(comments).toHaveLength(0);
    expect(mockedCore.warning).toHaveBeenCalledWith(expect.stringContaining("Retryable error"));
  });

  it("retries on connection reset", async () => {
    const file = makeFileDiff();

    const connError = new Anthropic.APIConnectionError({ cause: new Error("ECONNRESET") });
    mockCreate.mockRejectedValueOnce(connError);
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ comments: [] }) }],
    });

    const comments = await reviewFiles([file], baseConfig, mockClient);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(comments).toHaveLength(0);
  });

  it("throws immediately on 401", async () => {
    const file = makeFileDiff();

    const authError = new Anthropic.AuthenticationError(
      401,
      { type: "error", error: { type: "authentication_error", message: "Invalid API key" } },
      "Invalid API key",
      {},
    );
    mockCreate.mockRejectedValueOnce(authError);

    await expect(reviewFiles([file], baseConfig, mockClient)).rejects.toThrow();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("handles response wrapped in markdown fences", async () => {
    const file = makeFileDiff();
    mockClaudeResponse('```json\n{"comments": [{"file": "src/app.ts", "line": 2, "body": "Test", "severity": "warning", "category": "bug"}]}\n```');

    const comments = await reviewFiles([file], baseConfig, mockClient);

    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("Test");
  });

  it("drops comments with float line numbers", async () => {
    const file = makeFileDiff();
    mockClaudeResponse(JSON.stringify({
      comments: [{ file: "src/app.ts", line: 2.5, body: "Float line", severity: "warning", category: "bug" }],
    }));

    const comments = await reviewFiles([file], baseConfig, mockClient);
    expect(comments).toHaveLength(0);
  });

  it("drops comments with zero or negative lines", async () => {
    const file = makeFileDiff();
    mockClaudeResponse(JSON.stringify({
      comments: [
        { file: "src/app.ts", line: 0, body: "Zero", severity: "warning", category: "bug" },
        { file: "src/app.ts", line: -1, body: "Negative", severity: "warning", category: "bug" },
      ],
    }));

    const comments = await reviewFiles([file], baseConfig, mockClient);
    expect(comments).toHaveLength(0);
  });

  it("drops comments when file is not a string", async () => {
    const file = makeFileDiff();
    mockClaudeResponse(JSON.stringify({
      comments: [{ file: 123, line: 2, body: "Bad file", severity: "warning", category: "bug" }],
    }));

    const comments = await reviewFiles([file], baseConfig, mockClient);
    expect(comments).toHaveLength(0);
  });

  it("drops comments when body is not a string", async () => {
    const file = makeFileDiff();
    mockClaudeResponse(JSON.stringify({
      comments: [{ file: "src/app.ts", line: 2, body: 42, severity: "warning", category: "bug" }],
    }));

    const comments = await reviewFiles([file], baseConfig, mockClient);
    expect(comments).toHaveLength(0);
  });

  it("processes all files with concurrency=3", async () => {
    const files = Array.from({ length: 6 }, (_, i) => makeFileDiff({ path: `src/file${i}.ts` }));
    const configWithConcurrency3 = { ...baseConfig, concurrency: 3 };

    for (let i = 0; i < 6; i++) {
      mockClaudeResponse(JSON.stringify({
        comments: [{ file: `src/file${i}.ts`, line: 2, body: `Issue ${i}`, severity: "info", category: "style" }],
      }));
    }

    const comments = await reviewFiles(files, configWithConcurrency3, mockClient);

    expect(mockCreate).toHaveBeenCalledTimes(6);
    expect(comments).toHaveLength(6);
  });

  it("collects comments across batches in order", async () => {
    const files = [
      makeFileDiff({ path: "src/a.ts" }),
      makeFileDiff({ path: "src/b.ts" }),
      makeFileDiff({ path: "src/c.ts" }),
    ];
    const configWithConcurrency2 = { ...baseConfig, concurrency: 2 };

    mockClaudeResponse(JSON.stringify({
      comments: [{ file: "src/a.ts", line: 2, body: "A1", severity: "warning", category: "bug" }],
    }));
    mockClaudeResponse(JSON.stringify({
      comments: [{ file: "src/b.ts", line: 2, body: "B1", severity: "info", category: "style" }],
    }));
    mockClaudeResponse(JSON.stringify({
      comments: [{ file: "src/c.ts", line: 2, body: "C1", severity: "critical", category: "security" }],
    }));

    const comments = await reviewFiles(files, configWithConcurrency2, mockClient);

    expect(comments).toHaveLength(3);
    expect(comments[0].file).toBe("src/a.ts");
    expect(comments[1].file).toBe("src/b.ts");
    expect(comments[2].file).toBe("src/c.ts");
  });

  it("logs parse error details to warning and debug", async () => {
    const file = makeFileDiff();
    mockClaudeResponse("this is not json at all { broken");

    await reviewFiles([file], baseConfig, mockClient);

    expect(mockedCore.warning).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to parse Claude response for src\/app\.ts: .*/)
    );
    expect(mockedCore.debug).toHaveBeenCalledWith(
      expect.stringContaining("Raw response preview for src/app.ts:")
    );
  });
});

describe("generateSummary", () => {
  const sampleComments: ReviewComment[] = [
    { file: "a.ts", line: 1, body: "Issue", severity: "critical", category: "bug" },
    { file: "b.ts", line: 2, body: "Minor", severity: "info", category: "style" },
  ];

  it("returns parsed summary on valid response", async () => {
    mockClaudeResponse(JSON.stringify({
      summary: "Good code overall.",
      score: 8,
    }));

    const result = await generateSummary(sampleComments, 3, baseConfig, mockClient);

    expect(result.summary).toBe("Good code overall.");
    expect(result.score).toBe(8);
    expect(result.comments).toBe(sampleComments);
  });

  it("clamps score to 1-10 range", async () => {
    mockClaudeResponse(JSON.stringify({ summary: "Ok", score: 15 }));
    const result = await generateSummary([], 1, baseConfig, mockClient);
    expect(result.score).toBe(10);
  });

  it("uses fallback summary when parsing fails", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API failure"));

    const result = await generateSummary(sampleComments, 3, baseConfig, mockClient);

    expect(result.summary).toContain("2 issues");
    expect(result.summary).toContain("3 files");
    expect(mockedCore.warning).toHaveBeenCalledWith(expect.stringContaining("Failed to generate summary"));
  });

  it("fallback: score 9 when no comments", async () => {
    mockCreate.mockRejectedValueOnce(new Error("fail"));
    const result = await generateSummary([], 2, baseConfig, mockClient);
    expect(result.score).toBe(9);
  });

  it("fallback: score 4 when critical issues exist", async () => {
    mockCreate.mockRejectedValueOnce(new Error("fail"));
    const result = await generateSummary(sampleComments, 2, baseConfig, mockClient);
    expect(result.score).toBe(4);
  });

  it("fallback: score 7 when non-critical comments exist", async () => {
    const nonCritical: ReviewComment[] = [
      { file: "a.ts", line: 1, body: "Warn", severity: "warning", category: "bug" },
    ];
    mockCreate.mockRejectedValueOnce(new Error("fail"));
    const result = await generateSummary(nonCritical, 1, baseConfig, mockClient);
    expect(result.score).toBe(7);
  });
});
