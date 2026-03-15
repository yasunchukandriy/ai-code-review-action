# AI Code Review Action

[![CI](https://github.com/YOUR_USERNAME/ai-code-review-action/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/ai-code-review-action/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Automated pull request code review powered by **Claude AI**. Get instant, actionable feedback on every PR — catches bugs, security issues, SOLID violations, and performance problems.

## Features

- **Bug Detection** — Identifies logic errors, null pointer risks, race conditions, and off-by-one errors
- **Security Analysis** — Flags injection vulnerabilities, auth issues, sensitive data exposure, and insecure patterns
- **SOLID Principles** — Reviews code against Single Responsibility, Open/Closed, and other SOLID principles
- **Performance** — Spots N+1 queries, unnecessary allocations, missing caching opportunities, and algorithmic issues
- **Inline Comments** — Posts review comments directly on the relevant lines in your PR
- **Summary Report** — Provides an overall score and summary comment with stats breakdown
- **Configurable Scope** — Choose which categories to review and how many files to process

## Quick Start

### 1. Add your Anthropic API key as a repository secret

Go to **Settings > Secrets and variables > Actions** and add `ANTHROPIC_API_KEY`.

### 2. Create the workflow file

Add `.github/workflows/ai-review.yml` to your repository:

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: AI Code Review
        uses: YOUR_USERNAME/ai-code-review-action@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### 3. Open a pull request

The action will automatically review the PR and post inline comments.

## Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `anthropic-api-key` | Anthropic API key for Claude | *required* |
| `github-token` | GitHub token for PR access | *required* |
| `model` | Claude model to use | `claude-sonnet-4-5-20250929` |
| `max-files` | Max files to review per PR | `20` |
| `review-scope` | Categories: `bugs,solid,security,performance,style` | `bugs,solid,security,performance` |
| `language` | Comment language (`en`, `de`, `es`, etc.) | `en` |

### Outputs

| Output | Description |
|--------|-------------|
| `review-score` | Overall quality score (1-10) |
| `total-comments` | Total number of review comments |
| `critical-count` | Number of critical issues found |

## Example Review Comment

> **[WARNING]** (bug)
>
> `userInput` is used directly in the SQL query without sanitization. Use parameterized queries to prevent SQL injection.

## How It Works

```
PR Opened/Updated
       |
       v
  Fetch PR Diff (GitHub API)
       |
       v
  Parse Unified Diff -> Structured File Changes
       |
       v
  Filter: skip binaries, lockfiles, generated files
       |
       v
  For each file: Send diff to Claude API
       |
       v
  Parse Claude's JSON response -> Review Comments
       |
       v
  Post inline comments via GitHub Pull Request Review API
       |
       v
  Post summary comment with score and stats
```

## Skipped Files

The following files are automatically skipped:

- Binary files
- `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- Minified files (`*.min.js`, `*.min.css`)
- Source maps (`*.map`)
- Snapshot files (`*.snap`)
- Generated files (`*.generated.*`, `__generated__/`)
- Files in `dist/`

## Advanced Usage

### Review only security and bugs

```yaml
- uses: YOUR_USERNAME/ai-code-review-action@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    review-scope: "bugs,security"
```

### Use a different model

```yaml
- uses: YOUR_USERNAME/ai-code-review-action@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    model: "claude-opus-4-6"
```

### Limit files and get German reviews

```yaml
- uses: YOUR_USERNAME/ai-code-review-action@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    max-files: "10"
    language: "de"
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Install dependencies: `npm install`
4. Make your changes in `src/`
5. Type check: `npm run typecheck`
6. Build: `npm run build`
7. Commit and push
8. Open a pull request

## License

[MIT](LICENSE)
