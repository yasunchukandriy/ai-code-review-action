import { FileDiff, DiffHunk, DiffHunkLine } from "./types";

const SKIP_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.lock$/,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.snap$/,
  /dist\//,
  /\.generated\./,
  /__generated__\//,
];

function shouldSkipFile(path: string): boolean {
  return SKIP_PATTERNS.some((pattern) => pattern.test(path));
}

function parseHunkHeader(line: string): { oldStart: number; oldCount: number; newStart: number; newCount: number } | null {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) return null;
  return {
    oldStart: parseInt(match[1], 10),
    oldCount: parseInt(match[2] ?? "1", 10),
    newStart: parseInt(match[3], 10),
    newCount: parseInt(match[4] ?? "1", 10),
  };
}

export function parseDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  const fileSections = diffText.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");
    if (lines.length === 0) continue;

    // Parse file paths from the first line: "a/path b/path"
    const headerMatch = lines[0].match(/^a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const oldPath = headerMatch[1];
    const newPath = headerMatch[2];
    const isRenamed = oldPath !== newPath;

    // Check for binary files
    const isBinary = lines.some((l) => l.startsWith("Binary files") || l.includes("GIT binary patch"));
    if (isBinary) {
      files.push({
        path: newPath,
        oldPath: isRenamed ? oldPath : null,
        hunks: [],
        additions: 0,
        deletions: 0,
        isBinary: true,
        isRenamed,
      });
      continue;
    }

    if (shouldSkipFile(newPath)) continue;

    const hunks: DiffHunk[] = [];
    let additions = 0;
    let deletions = 0;

    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      // Check for hunk header
      const hunkHeader = parseHunkHeader(line);
      if (hunkHeader) {
        currentHunk = {
          ...hunkHeader,
          lines: [],
        };
        hunks.push(currentHunk);
        oldLine = hunkHeader.oldStart;
        newLine = hunkHeader.newStart;
        continue;
      }

      if (!currentHunk) continue;

      // Skip file metadata lines
      if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("old mode") || line.startsWith("new mode") || line.startsWith("similarity index") || line.startsWith("rename from") || line.startsWith("rename to")) {
        continue;
      }

      if (line.startsWith("+")) {
        const hunkLine: DiffHunkLine = {
          type: "added",
          content: line.substring(1),
          oldLineNumber: null,
          newLineNumber: newLine,
        };
        currentHunk.lines.push(hunkLine);
        newLine++;
        additions++;
      } else if (line.startsWith("-")) {
        const hunkLine: DiffHunkLine = {
          type: "removed",
          content: line.substring(1),
          oldLineNumber: oldLine,
          newLineNumber: null,
        };
        currentHunk.lines.push(hunkLine);
        oldLine++;
        deletions++;
      } else if (line.startsWith(" ") || line === "") {
        const hunkLine: DiffHunkLine = {
          type: "context",
          content: line.startsWith(" ") ? line.substring(1) : line,
          oldLineNumber: oldLine,
          newLineNumber: newLine,
        };
        currentHunk.lines.push(hunkLine);
        oldLine++;
        newLine++;
      }
    }

    files.push({
      path: newPath,
      oldPath: isRenamed ? oldPath : null,
      hunks,
      additions,
      deletions,
      isBinary: false,
      isRenamed,
    });
  }

  return files;
}
