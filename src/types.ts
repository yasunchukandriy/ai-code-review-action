export interface ReviewConfig {
  anthropicApiKey: string;
  githubToken: string;
  model: string;
  maxFiles: number;
  concurrency: number;
  reviewScope: string[];
  language: string;
}

export interface DiffHunkLine {
  type: "added" | "removed" | "context";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffHunkLine[];
}

export interface FileDiff {
  path: string;
  oldPath: string | null;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isBinary: boolean;
  isRenamed: boolean;
}

export type Severity = "critical" | "warning" | "info";

export type Category = "bug" | "solid" | "security" | "performance" | "style";

export interface ReviewComment {
  file: string;
  line: number;
  body: string;
  severity: Severity;
  category: Category;
}

export interface ReviewSummary {
  summary: string;
  comments: ReviewComment[];
  score: number;
}
