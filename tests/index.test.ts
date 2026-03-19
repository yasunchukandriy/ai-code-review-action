import * as core from "@actions/core";
import * as github from "@actions/github";

jest.mock("@actions/core");
jest.mock("@actions/github");
jest.mock("@anthropic-ai/sdk");
jest.mock("../src/config");
jest.mock("../src/diff-parser");
jest.mock("../src/reviewer");
jest.mock("../src/github");

import { getConfig } from "../src/config";
import { parseDiff } from "../src/diff-parser";
import { reviewFiles, generateSummary } from "../src/reviewer";
import { getPRContext, getPRDiff, postReviewComments, postSummaryComment } from "../src/github";

const mockedCore = jest.mocked(core);
const mockedGithub = jest.mocked(github);
const mockedGetConfig = jest.mocked(getConfig);
const mockedParseDiff = jest.mocked(parseDiff);
const mockedReviewFiles = jest.mocked(reviewFiles);
const mockedGenerateSummary = jest.mocked(generateSummary);
const mockedGetPRContext = jest.mocked(getPRContext);
const mockedGetPRDiff = jest.mocked(getPRDiff);
const mockedPostReviewComments = jest.mocked(postReviewComments);
const mockedPostSummaryComment = jest.mocked(postSummaryComment);

const defaultConfig = {
  anthropicApiKey: "sk-test",
  githubToken: "ghp_test",
  model: "claude-sonnet-4-5-20250514",
  maxFiles: 20,
  concurrency: 5,
  reviewScope: ["bugs", "security"],
  language: "en",
};

const defaultCtx = {
  owner: "owner",
  repo: "repo",
  pullNumber: 1,
  commitSha: "sha123",
};

const mockOctokit = {} as ReturnType<typeof github.getOctokit>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetConfig.mockReturnValue(defaultConfig);
  mockedGithub.getOctokit.mockReturnValue(mockOctokit);
  mockedGetPRContext.mockReturnValue(defaultCtx);
});

// The run() function is called on import via top-level `run()`.
// We need to re-import each time to trigger it.
async function runAction() {
  // Clear the module cache so run() executes again
  jest.resetModules();
  // Re-mock everything after resetModules
  jest.mock("@actions/core");
  jest.mock("@actions/github");
  jest.mock("@anthropic-ai/sdk");
  jest.mock("../src/config");
  jest.mock("../src/diff-parser");
  jest.mock("../src/reviewer");
  jest.mock("../src/github");

  // Get fresh references
  const freshCore = jest.requireMock("@actions/core") as typeof core;
  const freshGithub = jest.requireMock("@actions/github") as typeof github;
  const freshConfig = jest.requireMock("../src/config") as typeof import("../src/config");
  const freshDiffParser = jest.requireMock("../src/diff-parser") as typeof import("../src/diff-parser");
  const freshReviewer = jest.requireMock("../src/reviewer") as typeof import("../src/reviewer");
  const freshGhModule = jest.requireMock("../src/github") as typeof import("../src/github");

  return {
    core: freshCore,
    github: freshGithub,
    config: freshConfig,
    diffParser: freshDiffParser,
    reviewer: freshReviewer,
    ghModule: freshGhModule,
  };
}

describe("index (integration)", () => {
  it("executes full happy path and sets outputs", async () => {
    const mods = await runAction();

    jest.mocked(mods.config.getConfig).mockReturnValue(defaultConfig);
    jest.mocked(mods.github.getOctokit).mockReturnValue(mockOctokit);
    jest.mocked(mods.ghModule.getPRContext).mockReturnValue(defaultCtx);
    jest.mocked(mods.ghModule.getPRDiff).mockResolvedValue("diff --git a/f.ts b/f.ts\n...");

    const fileDiff = {
      path: "src/app.ts",
      oldPath: null,
      isBinary: false,
      isRenamed: false,
      additions: 1,
      deletions: 0,
      hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 2, lines: [] }],
    };
    jest.mocked(mods.diffParser.parseDiff).mockReturnValue([fileDiff]);

    const comments = [{ file: "src/app.ts", line: 2, body: "Issue", severity: "warning" as const, category: "bug" as const }];
    jest.mocked(mods.reviewer.reviewFiles).mockResolvedValue(comments);
    jest.mocked(mods.reviewer.generateSummary).mockResolvedValue({
      summary: "Good.",
      score: 8,
      comments,
    });
    jest.mocked(mods.ghModule.postReviewComments).mockResolvedValue(undefined);
    jest.mocked(mods.ghModule.postSummaryComment).mockResolvedValue(undefined);

    // Import triggers run()
    await jest.isolateModulesAsync(async () => {
      // Setup all mocks before import
      const coreM = jest.requireMock("@actions/core") as typeof core;
      const githubM = jest.requireMock("@actions/github") as typeof github;
      const configM = jest.requireMock("../src/config") as typeof import("../src/config");
      const diffM = jest.requireMock("../src/diff-parser") as typeof import("../src/diff-parser");
      const reviewerM = jest.requireMock("../src/reviewer") as typeof import("../src/reviewer");
      const ghM = jest.requireMock("../src/github") as typeof import("../src/github");

      jest.mocked(configM.getConfig).mockReturnValue(defaultConfig);
      jest.mocked(githubM.getOctokit).mockReturnValue(mockOctokit);
      jest.mocked(ghM.getPRContext).mockReturnValue(defaultCtx);
      jest.mocked(ghM.getPRDiff).mockResolvedValue("diff --git a/f.ts b/f.ts\n...");
      jest.mocked(diffM.parseDiff).mockReturnValue([fileDiff]);
      jest.mocked(reviewerM.reviewFiles).mockResolvedValue(comments);
      jest.mocked(reviewerM.generateSummary).mockResolvedValue({ summary: "Good.", score: 8, comments });
      jest.mocked(ghM.postReviewComments).mockResolvedValue(undefined);
      jest.mocked(ghM.postSummaryComment).mockResolvedValue(undefined);

      await require("../src/index");

      // Allow async run() to complete
      await new Promise((r) => setTimeout(r, 0));

      expect(jest.mocked(coreM.setOutput)).toHaveBeenCalledWith("review-score", 8);
      expect(jest.mocked(coreM.setOutput)).toHaveBeenCalledWith("total-comments", 1);
      expect(jest.mocked(coreM.setOutput)).toHaveBeenCalledWith("critical-count", 0);
    });
  });

  it("returns early when diff is empty", async () => {
    await jest.isolateModulesAsync(async () => {
      const coreM = jest.requireMock("@actions/core") as typeof core;
      const githubM = jest.requireMock("@actions/github") as typeof github;
      const configM = jest.requireMock("../src/config") as typeof import("../src/config");
      const ghM = jest.requireMock("../src/github") as typeof import("../src/github");
      const reviewerM = jest.requireMock("../src/reviewer") as typeof import("../src/reviewer");

      jest.mocked(configM.getConfig).mockReturnValue(defaultConfig);
      jest.mocked(githubM.getOctokit).mockReturnValue(mockOctokit);
      jest.mocked(ghM.getPRContext).mockReturnValue(defaultCtx);
      jest.mocked(ghM.getPRDiff).mockResolvedValue("");

      await require("../src/index");
      await new Promise((r) => setTimeout(r, 0));

      expect(jest.mocked(coreM.info)).toHaveBeenCalledWith("No diff found, nothing to review");
      expect(jest.mocked(reviewerM.reviewFiles)).not.toHaveBeenCalled();
    });
  });

  it("returns early when no reviewable files found", async () => {
    await jest.isolateModulesAsync(async () => {
      const coreM = jest.requireMock("@actions/core") as typeof core;
      const githubM = jest.requireMock("@actions/github") as typeof github;
      const configM = jest.requireMock("../src/config") as typeof import("../src/config");
      const diffM = jest.requireMock("../src/diff-parser") as typeof import("../src/diff-parser");
      const ghM = jest.requireMock("../src/github") as typeof import("../src/github");
      const reviewerM = jest.requireMock("../src/reviewer") as typeof import("../src/reviewer");

      jest.mocked(configM.getConfig).mockReturnValue(defaultConfig);
      jest.mocked(githubM.getOctokit).mockReturnValue(mockOctokit);
      jest.mocked(ghM.getPRContext).mockReturnValue(defaultCtx);
      jest.mocked(ghM.getPRDiff).mockResolvedValue("some diff");
      // All files are binary
      jest.mocked(diffM.parseDiff).mockReturnValue([
        { path: "img.png", oldPath: null, isBinary: true, isRenamed: false, additions: 0, deletions: 0, hunks: [] },
      ]);

      await require("../src/index");
      await new Promise((r) => setTimeout(r, 0));

      expect(jest.mocked(coreM.info)).toHaveBeenCalledWith("No reviewable files found (all binary or filtered out)");
      expect(jest.mocked(reviewerM.reviewFiles)).not.toHaveBeenCalled();
    });
  });

  it("calls core.setFailed on error", async () => {
    await jest.isolateModulesAsync(async () => {
      const coreM = jest.requireMock("@actions/core") as typeof core;
      const configM = jest.requireMock("../src/config") as typeof import("../src/config");

      jest.mocked(configM.getConfig).mockImplementation(() => {
        throw new Error("Config explosion");
      });

      await require("../src/index");
      await new Promise((r) => setTimeout(r, 0));

      expect(jest.mocked(coreM.setFailed)).toHaveBeenCalledWith(expect.stringContaining("Config explosion"));
    });
  });
});
