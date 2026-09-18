# Miss log schema (`misses.jsonl`)

One JSON object per line. Append-only; never rewrite history — add `status: fixed` follow-ups as new lines if needed.

```json
{
  "id": "miss_2026-09-18_express_001",
  "recordedAt": "2026-09-18T12:00:00.000Z",
  "repoId": "express",
  "repoUrl": "https://github.com/expressjs/express",
  "commitSha": "optional-sha",
  "kind": "missing_call",
  "severity": "high",
  "from": "optional node id or path",
  "to": "optional node id or path",
  "expected": "human description of correct relationship",
  "actual": "what GitImpact showed",
  "note": "why this matters / hypothesis",
  "framework": "optional e.g. express",
  "status": "open"
}
```

## `kind` enum

| kind | Use when |
|------|----------|
| `missing_call` | Expected CALLS edge absent |
| `missing_import` | Expected IMPORTS edge absent |
| `false_call` | Spurious CALLS edge |
| `false_import` | Spurious IMPORTS edge |
| `wrong_route` | API/route detection wrong |
| `wrong_framework` | Framework/stack mis-detected |
| `monorepo_boundary` | Workspace/package boundary wrong |
| `overview_misleading` | High-level architecture story wrong |
| `parse_failure` | File should parse but failed |
| `unsupported` | Important file skipped as unsupported |
| `quota_truncation` | Truncation hid the main story |
| `other` | Anything else |

## `status` enum

`open` | `accepted` (wontfix / out of scope) | `fixed` | `needs_fixture`
