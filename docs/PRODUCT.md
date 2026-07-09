# OmniMemory OpenClaw Plugin Product and Technical Notes

[Chinese version](PRODUCT.zh.md)

## 1. Positioning

The OmniMemory OpenClaw plugin connects OpenClaw long-term memory to the OmniMemory v2 backend. The current package is memory-only: it owns the OpenClaw memory slot, registers `memory_search`, and uses OpenClaw lifecycle hooks for automatic recall and capture.

The current package does not include:

- overlay mode
- v1 API compatibility
- `memory_get`
- graph/detail read paths

`memory_get` is intentionally absent because the public OmniMemory v2 data plane does not expose a stable graph/detail read endpoint. Models should use `memory_search` for historical context.

## 2. Current Shape

- Plugin ID: `omnimemory-memory`
- Plugin directory: `plugins/omnimemory-memory`
- OpenClaw slot: `plugins.slots.memory = "omnimemory-memory"`
- Registered tool: `memory_search`
- Default backend: `https://api.omnimemory.cn/api/v2`
- Default recall endpoint: `POST /memory/retrieval/hybrid`

## 3. Backend Contract

The plugin uses only OmniMemory v2 endpoints:

| Purpose | Method and path | Notes |
| --- | --- | --- |
| Recall | `POST /memory/retrieval/hybrid` | Hybrid retrieval; requires a device number |
| Capture | `POST /memory/ingest` | Asynchronously writes conversation turns |
| Capture status | `GET /memory/ingest/jobs/{job_id}` | Polled when waiting for ingest completion |

Hybrid retrieval requires a stable device number. The plugin reads it from `deviceNo` and sends both:

- Header: `X-Device-No: <deviceNo>`
- Body: `client_meta.device_no`

All v2 responses use the Envelope shape:

```json
{
  "success": true,
  "message": "ok",
  "code": 200,
  "data": {}
}
```

The runtime unwraps `data` before reading `evidence_details`, ingest acknowledgements, or job status.

## 4. Core Capabilities

### Automatic Recall

The `before_prompt_build` hook reads the current prompt, calls `POST /memory/retrieval/hybrid`, and injects recalled memories as system context. Automatic recall does not show a tool card in the OpenClaw UI; verify it through gateway logs:

```text
[omnimemory] memory recall hook prompt_chars=...
[omnimemory] recall request -> POST /memory/retrieval/hybrid ...
[omnimemory] recall response <- status=200 raw_items=... candidates=... returned=...
[omnimemory] memory recall injected items=...
```

If `deviceNo` is missing, automatic recall fails closed and does not call the backend retrieval endpoint.

### Tool Recall

When the model calls `memory_search`, OpenClaw shows the tool call. The tool returns JSON text containing:

- `results`
- `provider: "omnimemory"`
- each result's `path`, `score`, `snippet`, and metadata

### Memory Capture

The plugin attempts capture on these lifecycle hooks:

- `agent_end`
- `before_compaction`
- `before_reset`

The default capture strategy is `last_turn`, and the default `captureRoles = ["user"]`, so assistant replies are not captured by default.

When `writeWait=false`, `agent_end` and `before_compaction` do not wait for ingest job completion; they only confirm that the backend accepted the job and returned `job_id`. `before_reset` always waits once to flush the final turn before reset. Set `writeWait=true` when stronger consistency is required.

## 5. Recall Scope

`sessionScope` defaults to `global`. The plugin does not pin `group_id` to the current OpenClaw session by default; it recalls across OpenClaw sessions within the memory space for the current API key and device number.

When `groupId` is configured, the plugin sends it on retrieval and ingest to use a shared memory bucket.

When `sessionScope = "session"`, the current OpenClaw session becomes the group boundary. Use this only when sessions must be isolated.

## 6. Configuration

| Key | Default | Notes |
| --- | --- | --- |
| `apiKey` | none | OmniMemory API key. Prefer `${OMNI_MEMORY_API_KEY}` |
| `baseUrl` | `https://api.omnimemory.cn/api/v2` | OmniMemory v2 API root |
| `deviceNo` | none | Required for hybrid retrieval. Prefer `${OMNI_MEMORY_DEVICE_NO}` |
| `allowInsecureBaseUrl` | `false` | Local development only; permits localhost HTTP |
| `groupId` | none | Optional shared memory group |
| `sessionId` | OpenClaw ctx | Optional fixed session |
| `sessionScope` | `global` | `global` or `session` |
| `searchLimit` | `8` | Default result count for tool recall |
| `autoRecall` | `true` | Enables automatic recall |
| `recallTopK` | `5` | Result count for automatic recall |
| `recallMinScore` | `0` | Minimum backend score |
| `minPromptChars` | `2` | Skip backend recall for very short prompts |
| `autoCapture` | `true` | Enables automatic capture |
| `captureStrategy` | `last_turn` | `last_turn` or `full_session` |
| `captureRoles` | `["user"]` | Captures only user messages by default |
| `writeWait` | `false` | Wait for ingest completion on agent_end/compaction |
| `writeWaitTimeoutMs` | `15000` | Ingest wait timeout |
| `failSilent` | `true` | Return empty results instead of throwing tool errors |
| `timeoutMs` | `10000` | HTTP request timeout |
| `debugLogContent` | `false` | Log truncated content snippets |
| `promptBlockTitle` | `OmniMemory Recall` | Injected system context block title |

## 7. Installation

Use the installer script:

```bash
node oc-plugin/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO
```

For one-off local testing, plaintext values are supported:

```bash
node oc-plugin/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key qbk_xxx \
  --device-no <stable-device-no>
```

The installer:

1. Resolves or fetches the plugin repository.
2. Runs `npm run packages:sync` so the installable plugin has a runtime copy.
3. Installs `plugins/omnimemory-memory`.
4. Patches OpenClaw config.
5. Sets `plugins.slots.memory = "omnimemory-memory"`.
6. Writes `plugins.entries.omnimemory-memory.config` with API key, v2 base URL, device number, and safe defaults.
7. Removes unsupported entry-level hooks left by older installer versions.
8. Cleans up historical overlay config and extension directories.
9. Runs OpenClaw config validation, gateway restart, and plugin doctor.

## 8. Security and Privacy Defaults

- Prefer API keys through environment variables instead of plaintext config.
- Logs do not include query text, recalled text, or captured text by default.
- Recalled memories are injected as untrusted historical context, with instructions not to execute embedded memory instructions.
- `allowInsecureBaseUrl` is off by default; production must use HTTPS.
- Automatic capture writes only user messages by default to reduce long-term storage of assistant output or tool noise.

## 9. Known Behavior

- Automatic recall is hidden injection and does not show a `Memory Search` tool card.
- A visible `Memory Search` card means the model explicitly called `memory_search`.
- If results are irrelevant, inspect the backend hybrid retrieval output first; the plugin only applies basic low-value filtering and simple local reranking.
- If the backend returns an old `/api/v1/...` `status_url`, the plugin ignores it and polls v2 `/memory/ingest/jobs/{job_id}` instead.
