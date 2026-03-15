import * as github from "@actions/github";
import * as core from "@actions/core";
import { getPRContext, getPRDiff, postReviewComments, postSummaryComment } from "../src/github";
import { ReviewComment, ReviewSummary } from "../src/types";

jest.mock("@actions/github");
jest.mock("@actions/core");

const mockedGithub = jest.mocked(github);
const mockedCore = jest.mocked(core);

const mockPullsGet = jest.fn();
const mockCreateReview = jest.fn();
const mockCreateReviewComment = jest.fn();
const mockCreateComment = jest.fn();

const mockOctokit = {
  rest: {
    pulls: {
      get: mockPullsGet,
      createReview: mockCreateReview,
      createReviewComment: mockCreateReviewComment,
    },
    issues: {
      createComment: mockCreateComment,
    },
  },
} as unknown as ReturnType<typeof github.getOctokit>;

const mockCtx = {
  owner: "test-owner",
  repo: "test-repo",
  pullNumber: 42,
  commitSha: "abc123",
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getPRContext", () => {
  it("extracts PR context from github context", () => {
    Object.defineProperty(mockedGithub, "context", {
      value: {
        repo: { owner: "my-org", repo: "my-repo" },
        payload: {
          pull_request: {
            number: 99,
            head: { sha: "sha123" },
          },
        },
      },
      configurable: true,
    });

    const ctx = getPRContext();

    expect(ctx.owner).toBe("my-org");
    expect(ctx.repo).toBe("my-repo");
    expect(ctx.pullNumber).toBe(99);
    expect(ctx.commitSha).toBe("sha123");
  });

  it("throws when not a pull_request event", () => {
    Object.defineProperty(mockedGithub, "context", {
      value: {
        repo: { owner: "my-org", repo: "my-repo" },
        payload: {},
      },
      configurable: true,
    });

    expect(() => getPRContext()).toThrow("pull_request");
  });
});

describe("getPRDiff", () => {
  it("calls pulls.get with diff media type and returns string", async () => {
    mockPullsGet.mockResolvedValueOnce({
      data: "diff --git a/f.ts b/f.ts\n...",
    });

    const diff = await getPRDiff(mockOctokit, mockCtx);

    expect(mockOctokit.rest.pulls.get).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      pull_number: 42,
      mediaType: { format: "diff" },
    });
    expect(diff).toBe("diff --git a/f.ts b/f.ts\n...");
  });

  it("handles Buffer response data", async () => {
    const bufferLike = Buffer.from("diff --git a/f.ts b/f.ts\nbuffer data");
    mockPullsGet.mockResolvedValueOnce({ data: bufferLike });

    const diff = await getPRDiff(mockOctokit, mockCtx);

    expect(diff).toBe("diff --git a/f.ts b/f.ts\nbuffer data");
  });

  it("throws when response data is null", async () => {
    mockPullsGet.mockResolvedValueOnce({ data: null });

    await expect(getPRDiff(mockOctokit, mockCtx)).rejects.toThrow(
      "Unexpected response format from GitHub diff API"
    );
  });

  it("throws when response data is a parsed object", async () => {
    mockPullsGet.mockResolvedValueOnce({ data: { id: 1, title: "PR" } });

    await expect(getPRDiff(mockOctokit, mockCtx)).rejects.toThrow(
      "Unexpected response format from GitHub diff API"
    );
  });
});

describe("postReviewComments", () => {
  const comments: ReviewComment[] = [
    { file: "src/a.ts", line: 10, body: "Fix this", severity: "critical", category: "bug" },
    { file: "src/b.ts", line: 20, body: "Consider this", severity: "info", category: "style" },
  ];

  it("posts a batch review with formatted comments", async () => {
    mockCreateReview.mockResolvedValueOnce({});

    await postReviewComments(mockOctokit, mockCtx, comments);

    expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "test-owner",
        repo: "test-repo",
        pull_number: 42,
        commit_id: "abc123",
        event: "COMMENT",
        comments: expect.arrayContaining([
          expect.objectContaining({ path: "src/a.ts", line: 10 }),
          expect.objectContaining({ path: "src/b.ts", line: 20 }),
        ]),
      }),
    );
  });

  it("returns early when comments array is empty", async () => {
    await postReviewComments(mockOctokit, mockCtx, []);

    expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled();
    expect(mockedCore.info).toHaveBeenCalledWith("No comments to post");
  });

  it("falls back to individual comments when batch fails", async () => {
    mockCreateReview.mockRejectedValueOnce(new Error("Batch failed"));
    mockCreateReviewComment.mockResolvedValue({});

    await postReviewComments(mockOctokit, mockCtx, comments);

    expect(mockedCore.warning).toHaveBeenCalledWith(expect.stringContaining("Batch review failed"));
    expect(mockOctokit.rest.pulls.createReviewComment).toHaveBeenCalledTimes(2);
  });

  it("continues posting other comments when one individual comment fails", async () => {
    mockCreateReview.mockRejectedValueOnce(new Error("Batch failed"));
    mockCreateReviewComment
      .mockRejectedValueOnce(new Error("Comment 1 failed"))
      .mockResolvedValueOnce({});

    await postReviewComments(mockOctokit, mockCtx, comments);

    expect(mockOctokit.rest.pulls.createReviewComment).toHaveBeenCalledTimes(2);
    expect(mockedCore.info).toHaveBeenCalledWith("Posted 1/2 comments individually");
  });

  it("formats comment body with severity icon and category", async () => {
    mockCreateReview.mockResolvedValueOnce({});

    await postReviewComments(mockOctokit, mockCtx, [comments[0]]);

    const call = mockCreateReview.mock.calls[0][0];
    const postedComment = call.comments[0];
    expect(postedComment.body).toContain("[CRITICAL]");
    expect(postedComment.body).toContain("(bug)");
    expect(postedComment.body).toContain("Fix this");
  });
});

describe("postSummaryComment", () => {
  function makeSummary(score: number, comments: ReviewComment[] = []): ReviewSummary {
    return { summary: "Looks good.", score, comments };
  }

  it("posts a formatted markdown comment", async () => {
    mockCreateComment.mockResolvedValueOnce({});

    await postSummaryComment(mockOctokit, mockCtx, makeSummary(8));

    expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 42,
      }),
    );

    const body = mockCreateComment.mock.calls[0][0].body;
    expect(body).toContain("AI Code Review");
    expect(body).toContain("8/10");
  });

  it("uses green emoji for score >= 8", async () => {
    mockCreateComment.mockResolvedValueOnce({});
    await postSummaryComment(mockOctokit, mockCtx, makeSummary(8));

    const body = mockCreateComment.mock.calls[0][0].body;
    expect(body).toContain("\u2705"); // green check
  });

  it("uses yellow emoji for score >= 5 and < 8", async () => {
    mockCreateComment.mockResolvedValueOnce({});
    await postSummaryComment(mockOctokit, mockCtx, makeSummary(5));

    const body = mockCreateComment.mock.calls[0][0].body;
    expect(body).toContain("\uD83D\uDFE1"); // yellow circle
  });

  it("uses red emoji for score < 5", async () => {
    mockCreateComment.mockResolvedValueOnce({});
    await postSummaryComment(mockOctokit, mockCtx, makeSummary(3));

    const body = mockCreateComment.mock.calls[0][0].body;
    expect(body).toContain("\uD83D\uDD34"); // red circle
  });

  it("includes severity breakdown in the table", async () => {
    mockCreateComment.mockResolvedValueOnce({});

    const comments: ReviewComment[] = [
      { file: "a.ts", line: 1, body: "X", severity: "critical", category: "bug" },
      { file: "a.ts", line: 2, body: "Y", severity: "warning", category: "bug" },
      { file: "a.ts", line: 3, body: "Z", severity: "info", category: "style" },
    ];
    await postSummaryComment(mockOctokit, mockCtx, { summary: "Mixed.", score: 5, comments });

    const body = mockCreateComment.mock.calls[0][0].body;
    expect(body).toContain("| Issues found | 3 |");
  });
});
