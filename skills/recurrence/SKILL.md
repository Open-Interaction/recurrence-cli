---
name: recurrence
description: Use Recurrence MCP or CLI to run typed decisions for classification, routing, binary judgments, and rubric scoring. Use when the user asks for Recurrence inference, model selection, or recovery of an existing Recurrence decision.
---

# Recurrence

Use Recurrence when the task calls for a bounded judgment over supplied state and a defined set of labels, a binary predicate, or an ordered rubric. Keep ordinary coding, prose generation, and fact retrieval in their usual tools. A decision call sends state to the Recurrence service and can consume account credit. Submit only the data and number of requests authorized by the task.

## Choose a model

Call `list_models` or `recurrence models` on the intended Recurrence instance. Use the returned catalog for model identifiers, `configured`, `inputCapabilities`, `questionTypes`, `contextWindowTokens`, and current platform prices. Consider only configured entries that support the required input and all questions. An explicit user model takes precedence. If it cannot handle the task, explain the mismatch before substituting it.

| Candidate | When to select it if available |
| --- | --- |
| `cloudflare/clef-flash` | Short routing, classification, or guardrail inputs when the catalog price fits the budget. Its catalog warns that Workers AI may read only about the first 2K text tokens of long state. Keep all decisive evidence within that range or choose another model. |
| `perplexity/pplx-decider-v1.2` | Images or long state that exceeds Clef Flash's effective text limit, subject to the current catalog and request size. |
| `typesafe/jev-1.14` | Text or JSON when the task calls for Jev or an existing evaluation favors it for this rubric. |
| `typesafe/jev-1.13` | A pinned comparison, an existing evaluation baseline, or a workflow that explicitly requires 1.13. |

Where several models fit, use existing evaluation evidence for the task, then compare live prices. Avoid paid comparison runs unless requested. Catalog prices are nano-USD per token. The reservation uses the model context window multiplied by the sum of its input and output prices, so a small input can still exceed the available balance or key budget.

## Submit and read a decision

Prefer the connected Recurrence MCP tools. Use the `recurrence` CLI when MCP is unavailable. [Request shapes and commands](references/decision-input.md) covers both entry points and the answer fields.

- Use `choice` for one named option, `noul` for the probability that a predicate is true, and `score` for an ordered rubric. Put evidence in `state` and the decision rule in `questions`. Reuse one state across related questions when that fits the task. Apply thresholds or downstream actions only when the task defines them.
- Before the first submission, generate and retain one unique idempotency key, such as a UUID. Save the exact payload, origin, and account context long enough to recover the result. MCP uses `idempotencyKey`. CLI uses `--idempotency-key`. Keep credentials in the configured environment or local CLI login. If authentication is missing, ask the user to configure it there.
- Read `answers` by question name and retain the platform `request_id`. Use `billing.charge_nano_usd` for the account charge. Provider probabilities are model judgments. Report them without turning them into certainty or inventing a cutoff.

## Recover safely

Keep the **same origin, account, model, state, questions, and idempotency key** when recovering an uncertain submission. This applies when switching from MCP to CLI. A different model or edited payload is a new decision. Use a platform decision ID (`dec_…`) with `get_decision` or `recurrence status`. A generic HTTP trace ID is useful for diagnosis. If only that trace ID or no ID is available, recent activity can help identify a matching request. A missing match leaves the outcome uncertain.

| Signal | Action |
| --- | --- |
| Lost response, network error, timeout, or ambiguous gateway error | Check status when a decision ID is available. If the result is still missing and no held-for-review state is known, make at most one delayed replay with the original key and exact payload. A successful replay returns the cached answers. |
| `succeeded` with missing answers | Status and activity only return metadata. Replay the original submission once with the original key to retrieve its answers. |
| `pending` or `DECISION_ALREADY_SUBMITTED` | Use status when available. Space out checks and stop after three checks if the request is still unresolved. |
| `unknown`, `UPSTREAM_OUTCOME_UNKNOWN`, `UPSTREAM_INVALID_RESPONSE`, `USAGE_REQUIRES_REVIEW`, or `DECISION_REQUIRES_REVIEW` | Stop submissions and report the request ID, error, and review status. The reservation may still be held. |
| `DECISION_FAILED`, a `failed` status, `UPSTREAM_REJECTED`, or `UPSTREAM_UNAVAILABLE` | The recorded attempt ended and its reservation was released. A fresh attempt needs a new key and can incur a charge. Fix the cause first and proceed only if that new attempt is within scope. |
| `API_KEY_RATE_LIMIT` | Wait for the rate window and retry once with the same key and payload. For `UPSTREAM_RATE_LIMIT`, the server records a failed attempt and releases its reservation. Back off and apply the fresh-attempt rule above. |
| `IDEMPOTENCY_KEY_REUSED` | Recover the original payload for that key. Stop if it cannot be recovered. Use a new key only for an intentionally different decision. |
| Invalid input, `MODEL_NOT_FOUND`, `MODEL_NOT_CONFIGURED`, missing scope, invalid key, or budget rejection | Surface the error and fix the prerequisite. `CREDIT_EXHAUSTED` concerns account credit, while `API_KEY_CREDIT_LIMIT` concerns the key's spending cap. Keep the user's account and budget constraints. |

Keep recovery bounded to one follow-up submission per logical decision unless the user authorizes more. If the outcome remains unclear, report the last known state and stop. Automatic fallback to another model can create a second paid decision.
