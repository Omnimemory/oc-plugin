# OmniMemory OpenClaw Plugin Testing and Acceptance Guide

[Chinese version](TESTING.zh.md)

## 1. Test Goals

Verify that the memory-only plugin can:

- Install into OpenClaw and own the memory slot.
- Register `memory_search` and omit `memory_get`.
- Use `POST /memory/retrieval/hybrid` for automatic and tool recall.
- Send `X-Device-No` and `client_meta.device_no` when `deviceNo` is configured.
- Fail clearly without calling hybrid retrieval when `deviceNo` is missing.
- Write memories through `POST /memory/ingest` and poll `GET /memory/ingest/jobs/{job_id}` when waiting.
- Avoid loading the historical overlay plugin.

## 2. Test Environment

Prepare:

- OpenClaw CLI (`openclaw`) or an OpenClaw root directory.
- OpenClaw config: `<openclaw-state-dir>/openclaw.json`.
- OpenClaw extensions: `<openclaw-state-dir>/extensions`.
- Dashboard URL printed by the OpenClaw gateway.
- Plugin checkout: `<plugin-root>`.
- OmniMemory API key, preferably through `OMNI_MEMORY_API_KEY`.
- OmniMemory device number, preferably through `OMNI_MEMORY_DEVICE_NO`.

## 3. Automated Tests

Run from the plugin repository root:

```bash
cd <plugin-root>
npm test
```

Expected:

```text
synced shared runtime -> plugins/omnimemory-memory/runtime
# tests 26
# pass 26
# fail 0
```

The tests cover:

- `memory_search` is the only registered tool.
- Automatic recall uses `before_prompt_build`.
- The manifest uses the production v2 base URL.
- `memory_get` is absent.
- v2 Envelope and ErrorEnvelope handling.
- Hybrid retrieval path, device metadata, group/session propagation.
- Missing `deviceNo` does not call backend retrieval.
- Only `evidence_details` is parsed.
- OpenClaw control prompt, old recall wrapper, and low-value filtering.
- Ingest request body, commit idempotency, job polling, and polling backoff.
- Logs do not leak query text, recalled text, or captured turn text by default.

## 4. Installation Validation

Start with dry-run:

```bash
node <plugin-root>/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO \
  --dry-run
```

After confirming that `config.apiKey` and `config.deviceNo` use environment templates, install:

```bash
node <plugin-root>/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO
```

For one-off local validation, plaintext values are supported:

```bash
node <plugin-root>/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key qbk_xxx \
  --device-no <stable-device-no> \
  --skip-restart
```

Then check:

```bash
openclaw config validate --json
openclaw plugins doctor
openclaw gateway health
```

Expected:

- Config validation passes.
- Doctor has no hard error.
- Doctor no longer reports `legacy before_agent_start`.
- Gateway health is OK.

## 5. Configuration Acceptance

OpenClaw config should contain:

```json
{
  "plugins": {
    "enabled": true,
    "allow": ["omnimemory-memory"],
    "slots": {
      "memory": "omnimemory-memory"
    },
    "entries": {
      "omnimemory-memory": {
        "enabled": true,
        "config": {
          "apiKey": "${OMNI_MEMORY_API_KEY}",
          "baseUrl": "https://api.omnimemory.cn/api/v2",
          "deviceNo": "${OMNI_MEMORY_DEVICE_NO}",
          "sessionScope": "global",
          "autoRecall": true,
          "autoCapture": true,
          "writeWait": false
        }
      }
    }
  }
}
```

These should be absent:

- `plugins.entries.omnimemory-overlay`
- `omnimemory-overlay` in `plugins.allow`
- `plugins.slots.memory = "memory-core"`, unless you intentionally disable OmniMemory
- `omnimemory-overlay` in the extensions directory
- `plugins.entries.omnimemory-memory.hooks`

## 6. Log Acceptance

Watch gateway logs for `[omnimemory]`.

Successful automatic recall:

```text
[omnimemory] memory recall hook prompt_chars=...
[omnimemory] recall request -> POST /memory/retrieval/hybrid query_chars=...
[omnimemory] recall response <- status=200 raw_items=... candidates=... returned=...
[omnimemory] recall item #1 score=... rel=... source=... role=... chars=...
[omnimemory] memory recall injected items=... block_chars=...
```

Successful tool recall:

```text
[omnimemory] recall request -> POST /memory/retrieval/hybrid ...
[omnimemory] recall response <- status=200 ...
```

OpenClaw UI should show:

```text
Memory Search
Tool output memory_search
```

Successful capture:

```text
[omnimemory] capture hook normalized=... selected=... strategy=last_turn
[omnimemory] ingest prepare input_turns=... session_id=... group_id=...
[omnimemory] ingest payload turns=... roles=user commit=...
[omnimemory] ingest request -> POST /memory/ingest ...
[omnimemory] ingest response <- status=202 accepted=true job_id=...
```

When `writeWait=true` or `before_reset` runs, expect:

```text
[omnimemory] ingest job poll -> job_id=... path=/memory/ingest/jobs/...
[omnimemory] ingest job status <- job_id=... status=completed
```

If the backend returns an old `status_url`, this is expected compatibility behavior:

```text
[omnimemory] ingest response included legacy status_url="..." (ignored; polling v2 /memory/ingest/jobs/{job_id})
```

## 7. Manual Test Cases

### Case 1: Automatic Recall

1. Open the OpenClaw dashboard.
2. Confirm the plugin is enabled and `OMNI_MEMORY_API_KEY` / `OMNI_MEMORY_DEVICE_NO` are set.
3. Ask about a fact that already exists in OmniMemory:

```text
Do you remember what my water bottle looks like?
```

Expected:

- The UI may not show a `Memory Search` card.
- Gateway logs show a hybrid recall request.
- If the backend returns a hit, the answer can reference the recalled fact.

### Case 2: Tool Recall

Ask:

```text
Use memory_search to find what I said about my water bottle.
```

Expected:

- The UI shows `Memory Search`.
- Tool output includes `provider: "omnimemory"`.
- Logs show `POST /memory/retrieval/hybrid`.

### Case 3: Capture and Cross-Session Recall

1. Enter a new fact:

```text
My water bottle is transparent and has a blue lid.
```

2. Wait for the answer to finish.
3. Confirm ingest returned `accepted=true` and `job_id`.
4. If `writeWait` is off, wait for the backend async job to finish.
5. Start a new session or reset.
6. Ask:

```text
What does my water bottle look like?
```

Expected:

- Logs show a hybrid recall request.
- The returned result or answer includes "transparent" and "blue lid".

### Case 4: Confirm the Answer Is Not From Local Memory Files

1. Clear or ignore local OpenClaw `memory/*.md`.
2. Ask about a fact that only exists in OmniMemory.
3. Inspect `recall item` in gateway logs.

Only a matching `recall item` counts as an OmniMemory recall hit.

### Case 5: Missing Device Number

1. Temporarily remove `deviceNo` or leave `${OMNI_MEMORY_DEVICE_NO}` empty.
2. Trigger automatic recall or `memory_search`.

Expected:

- Logs include `deviceNo is required for hybrid retrieval`.
- No `POST /memory/retrieval/hybrid` request is sent.
- Restoring the device number restores recall.

## 8. FAQ

### No Memory Search card appeared. Did recall run?

Not necessarily a failure. Automatic recall is hidden injection and does not show a tool card. Check gateway logs for `memory recall injected`.

### The page answered with historical info, but there is no recall item. Is that an OmniMemory hit?

No. The answer may come from current context, local memory files, or residual model context. OmniMemory hits require `recall item #...` in the logs.

### What if recall results are irrelevant?

Inspect `raw_items`, `candidates`, `returned`, and each `recall item`. The plugin applies basic filtering and simple reranking, but quality mostly depends on backend hybrid retrieval.

### Why do logs still mention v1?

The plugin sends only v2 requests. v1 can appear only in a legacy `status_url` returned by the backend; the plugin ignores it and polls the v2 job endpoint.

### Doctor still reports legacy before_agent_start. What should I do?

The OpenClaw runtime is still loading an old plugin. Re-run the installer, make sure only `omnimemory-memory` remains in extensions, and restart the gateway.

## 9. Regression Checklist

- `npm test` passes.
- `packages:sync` only syncs `omnimemory-memory/runtime`.
- OpenClaw config validation passes.
- `plugins.slots.memory = "omnimemory-memory"`.
- `plugins.allow` includes `omnimemory-memory`.
- `omnimemory-overlay` is absent from entries, allow list, and extensions.
- Config contains `apiKey` and `deviceNo`.
- Automatic recall logs `POST /memory/retrieval/hybrid`.
- Tool recall shows `Memory Search`.
- Capture uses `POST /memory/ingest`.
- Waiting for capture polls `GET /memory/ingest/jobs/{job_id}`.
