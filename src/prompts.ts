import { ReviewConfig, FileDiff } from "./types";

export function buildSystemPrompt(config: ReviewConfig): string {
  const scopes = config.reviewScope.join(", ");

  return `You are an expert code reviewer. Your task is to review pull request diffs and provide actionable, specific feedback.

Review scope: ${scopes}

Guidelines:
- Focus only on the changed lines (additions). Do not review removed lines or unchanged context.
- Be specific — reference exact variable names, function calls, or patterns.
- Be concise — one clear sentence per issue, then a brief explanation if needed.
- Be constructive — suggest fixes, not just problems.
- Only flag real issues. Do not nitpick formatting or style unless it causes readability problems.
- Assign a severity to each comment: "critical" (bugs, security holes), "warning" (code smells, potential issues), or "info" (suggestions, minor improvements).
- Assign a category to each comment: "bug", "solid" (SOLID principles), "security", "performance", or "style".

Respond with valid JSON only. No markdown fences, no extra text. Use this exact structure:

{
  "comments": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "severity": "warning",
      "category": "bug",
      "body": "The description of the issue and suggested fix."
    }
  ]
}

If there are no issues, return: { "comments": [] }

The "line" field must be a line number in the new version of the file (from the + side of the diff).
Language for comments: ${config.language === "en" ? "English" : config.language}.`;
}

export function buildFileReviewPrompt(file: FileDiff): string {
  const diffContent = file.hunks
    .map((hunk) => {
      const header = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
      const lines = hunk.lines
        .map((l) => {
          const prefix = l.type === "added" ? "+" : l.type === "removed" ? "-" : " ";
          const lineNum = l.newLineNumber ?? l.oldLineNumber ?? "";
          return `${prefix}${lineNum}: ${l.content}`;
        })
        .join("\n");
      return `${header}\n${lines}`;
    })
    .join("\n\n");

  return `Review the following diff for file: ${file.path}
Additions: ${file.additions}, Deletions: ${file.deletions}

\`\`\`diff
${diffContent}
\`\`\``;
}

export function buildSummaryPrompt(fileCount: number, commentCount: number, criticalCount: number): string {
  return `Based on the code review you just performed across ${fileCount} files, write a brief summary.

Stats: ${commentCount} comments total, ${criticalCount} critical issues found.

Respond with valid JSON only:

{
  "summary": "A 2-3 sentence summary of the overall code quality and key findings.",
  "score": <number from 1-10, where 10 is perfect>
}`;
}
