# Recurrence decision input

Use `list_models({})` or `recurrence models` to discover the current catalog. Read-only model discovery requires no key. Creating a decision requires `decisions:write`. Request status and activity require `decisions:read`. Balance requires `billing:read`.

The decision payload contains `model` (a returned slug or ID), `state` (a string, JSON object, or array), and `questions` (1–32 named questions). The JSON body limit is 128 KiB, including any media representation. The model must support the input modality and question types.

| Type | `criteria` | Returned answer fields |
| --- | --- | --- |
| `choice` | Object with 2–64 named options and a definition per option | `choice`, `probabilities`, `confidence` |
| `noul` | Optional object with both `true` and `false` definitions | `noul` in `[0, 1]`, the probability that the predicate is true |
| `score` | Array of 2–10 ordered rubric anchors, starting at score zero | `score` between zero and the last anchor index, `confidence` |

Each question requires `instructions`. Instructions and criteria descriptions accept a nonempty string, JSON object, or array. Use precise labels, definitions for ambiguous cases, and evidence relevant to the question.

Example `decision.json` for a routing task. Verify the example model against the current catalog before using it.

```json
{
  "model": "cloudflare/clef-flash",
  "state": { "ticket": "I was charged twice for the same invoice." },
  "questions": {
    "queue": {
      "type": "choice",
      "instructions": "Route the ticket to the team that owns the main issue. Use other when the available evidence is insufficient.",
      "criteria": {
        "billing": "Invoices, charges, refunds, or payments",
        "technical": "Product errors or broken functionality",
        "other": "Outside these categories or insufficient evidence"
      }
    }
  }
}
```

For MCP, send these fields to `create_decision` with a top-level `idempotencyKey`. For CLI, keep the JSON as shown and pass the key as a flag. Save the key before submitting.

```sh
decision_key=$(node -p 'require("node:crypto").randomUUID()')
recurrence decide --file decision.json --idempotency-key "$decision_key"
```

For a permitted replay, reuse the saved key and exact input. The key is 8–128 characters without whitespace. For status, pass the returned `request_id` as `get_decision({"requestId":"dec_…"})` or `recurrence status "$request_id"`. Use `list_activity({"limit":5})` or `recurrence activity --limit 5` to inspect recent requests. `get_balance({})` and `recurrence balance` read the account credit summary.
