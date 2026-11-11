# Patch-Conflict Classifier (GitHub Action)

When two or more open pull requests claim to fix the same issue, this action comments one table on the issue:
for every pair of PRs, **same-fix**, **CONFLICTING** or **independent**, with the reason.

The comment is created once and updated in place on later runs (marker `<!-- patch-conflict-classifier -->`).

## Use

```yaml
# .github/workflows/patch-conflicts.yml
name: patch-conflicts
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
  workflow_dispatch:
    inputs:
      issue_number: { description: 'Issue number', required: true }
permissions:
  contents: read
  issues: write
  pull-requests: read
jobs:
  classify:
    runs-on: ubuntu-latest
    steps:
      - uses: MegaStretch23/patch-conflict-action@v1
        with:
          issue_number: ${{ inputs.issue_number }}
```

A PR is tied to an issue by a closing keyword in its body (`Fixes #12`, `Closes #12`, `Resolves #12`); the action then
reads the issue timeline for every open (or merged) PR that references it, and does nothing until there are `min_prs` (default 2).

## How it classifies

Per pair, from the unified diffs: no shared file -> independent; shared file but hunks at non-overlapping old-line ranges ->
independent; overlapping hunks with the same added text (whitespace-insensitive) -> same-fix; overlapping hunks with different
added text -> CONFLICTING.

## Limits (read these)

- It is a line-range and text heuristic, not a semantic or compile-time check. Two PRs that edit different lines but break each
  other, or two differently-worded PRs that do the same thing, are not detected.
- PRs from forks run with a read-only token on `pull_request`; use `workflow_dispatch` or `pull_request_target` (review the security
  implications first) if you need comments on fork PRs.
- No dependencies, no network calls other than the GitHub API of the repo it runs in. Nothing is sent anywhere else.

MIT licensed. Tests: `node test/classifier.test.js`.
