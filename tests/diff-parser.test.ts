import { parseDiff } from "../src/diff-parser";

describe("parseDiff", () => {
  it("returns empty array for empty input", () => {
    expect(parseDiff("")).toEqual([]);
  });

  it("parses a single file with additions and removals", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@
 import express from "express";

-const port = 3000;
+const port = process.env.PORT || 3000;
+const host = "0.0.0.0";

`;

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/app.ts");
    expect(files[0].oldPath).toBeNull();
    expect(files[0].isBinary).toBe(false);
    expect(files[0].isRenamed).toBe(false);
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
    expect(files[0].hunks).toHaveLength(1);
  });

  it("parses multiple files", () => {
    const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 line1
-old
+new
 line3
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,3 @@
 line1
+added
 line2
`;

    const files = parseDiff(diff);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("src/a.ts");
    expect(files[1].path).toBe("src/b.ts");
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(1);
    expect(files[1].additions).toBe(1);
    expect(files[1].deletions).toBe(0);
  });

  it("detects binary files", () => {
    const diff = `diff --git a/image.png b/image.png
Binary files /dev/null and b/image.png differ
`;

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("image.png");
    expect(files[0].isBinary).toBe(true);
    expect(files[0].hunks).toHaveLength(0);
    expect(files[0].additions).toBe(0);
    expect(files[0].deletions).toBe(0);
  });

  it("detects file renames", () => {
    const diff = `diff --git a/old-name.ts b/new-name.ts
similarity index 95%
rename from old-name.ts
rename to new-name.ts
--- a/old-name.ts
+++ b/new-name.ts
@@ -1,3 +1,3 @@
 line1
-old
+new
 line3
`;

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("new-name.ts");
    expect(files[0].oldPath).toBe("old-name.ts");
    expect(files[0].isRenamed).toBe(true);
  });

  describe("skip patterns", () => {
    const skipCases = [
      ["package-lock.json", "lockfile"],
      ["yarn.lock", "yarn lock"],
      ["pnpm-lock.yaml", "pnpm lock"],
      ["some.lock", "generic lock"],
      ["bundle.min.js", "minified JS"],
      ["styles.min.css", "minified CSS"],
      ["app.js.map", "source map"],
      ["snapshot.snap", "snapshot"],
      ["dist/index.js", "dist output"],
      ["src/api.generated.ts", ".generated file"],
      ["__generated__/types.ts", "__generated__ dir"],
    ] as const;

    for (const [filename, label] of skipCases) {
      it(`skips ${label} (${filename})`, () => {
        const diff = `diff --git a/${filename} b/${filename}
--- a/${filename}
+++ b/${filename}
@@ -1,1 +1,2 @@
 line1
+line2
`;
        const files = parseDiff(diff);
        expect(files).toHaveLength(0);
      });
    }
  });

  it("parses hunk header with counts", () => {
    const diff = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -10,5 +20,8 @@
 context
+added
`;

    const files = parseDiff(diff);
    const hunk = files[0].hunks[0];
    expect(hunk.oldStart).toBe(10);
    expect(hunk.oldCount).toBe(5);
    expect(hunk.newStart).toBe(20);
    expect(hunk.newCount).toBe(8);
  });

  it("defaults hunk count to 1 when omitted", () => {
    const diff = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -10 +20 @@
+added
`;

    const files = parseDiff(diff);
    const hunk = files[0].hunks[0];
    expect(hunk.oldCount).toBe(1);
    expect(hunk.newCount).toBe(1);
  });

  it("sets correct line numbers for added, removed, and context lines", () => {
    const diff = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -5,4 +5,4 @@
 context line
-removed line
+added line
 another context
`;

    const files = parseDiff(diff);
    const lines = files[0].hunks[0].lines;

    // context line: both old and new line numbers
    expect(lines[0].type).toBe("context");
    expect(lines[0].oldLineNumber).toBe(5);
    expect(lines[0].newLineNumber).toBe(5);

    // removed line: old line number only
    expect(lines[1].type).toBe("removed");
    expect(lines[1].oldLineNumber).toBe(6);
    expect(lines[1].newLineNumber).toBeNull();

    // added line: new line number only
    expect(lines[2].type).toBe("added");
    expect(lines[2].oldLineNumber).toBeNull();
    expect(lines[2].newLineNumber).toBe(6);

    // second context line
    expect(lines[3].type).toBe("context");
    expect(lines[3].oldLineNumber).toBe(7);
    expect(lines[3].newLineNumber).toBe(7);
  });

  it("does not produce hunk lines from metadata lines", () => {
    const diff = `diff --git a/f.ts b/f.ts
index abc..def 100644
new file mode 100644
--- /dev/null
+++ b/f.ts
@@ -0,0 +1,2 @@
+line one
+line two`;

    const files = parseDiff(diff);
    expect(files[0].hunks).toHaveLength(1);
    const lines = files[0].hunks[0].lines;
    // Only the two added lines, no metadata
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.type === "added")).toBe(true);
  });

  it("handles multiple hunks per file with correct line numbering", () => {
    const diff = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -1,3 +1,4 @@
 first
+inserted
 second
 third
@@ -20,3 +21,4 @@
 line20
+another insert
 line21
 line22
`;

    const files = parseDiff(diff);
    expect(files[0].hunks).toHaveLength(2);

    const hunk1 = files[0].hunks[0];
    expect(hunk1.oldStart).toBe(1);
    expect(hunk1.newStart).toBe(1);
    const addedLine1 = hunk1.lines.find((l) => l.type === "added");
    expect(addedLine1!.newLineNumber).toBe(2);

    const hunk2 = files[0].hunks[1];
    expect(hunk2.oldStart).toBe(20);
    expect(hunk2.newStart).toBe(21);
    const addedLine2 = hunk2.lines.find((l) => l.type === "added");
    expect(addedLine2!.newLineNumber).toBe(22);
  });

  it("strips + and - prefixes from line content", () => {
    const diff = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -1,2 +1,2 @@
-const x = 1;
+const x = 2;
`;

    const files = parseDiff(diff);
    const lines = files[0].hunks[0].lines;
    expect(lines[0].content).toBe("const x = 1;");
    expect(lines[1].content).toBe("const x = 2;");
  });

  it("binary files with rename track both paths", () => {
    const diff = `diff --git a/old.png b/new.png
Binary files a/old.png and b/new.png differ
`;

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].isBinary).toBe(true);
    expect(files[0].isRenamed).toBe(true);
    expect(files[0].path).toBe("new.png");
    expect(files[0].oldPath).toBe("old.png");
  });
});
