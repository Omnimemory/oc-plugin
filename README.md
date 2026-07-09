# OmniMemory OpenClaw Plugin v2

[Chinese version](README.zh.md)

## Purpose

This repository contains the OmniMemory memory-slot plugin for OpenClaw. It connects OpenClaw long-term memory to the OmniMemory v2 backend. The current package is memory-only: it does not include overlay mode, v1 compatibility, graph/detail reads, or `memory_get`.

After installation, the plugin owns the OpenClaw memory slot, registers the `memory_search` tool, and automatically recalls OmniMemory context before prompt construction. It writes recent capturable conversation turns back to OmniMemory at agent end, compaction, and reset.

## Backend Contract

Default API root:

```text
https://api.omnimemory.cn/api/v2
```

Endpoints used by the plugin:

- `POST /memory/retrieval/hybrid`
- `POST /memory/ingest`
- `GET /memory/ingest/jobs/{job_id}`

Hybrid retrieval requires a stable device number. Configure `deviceNo`, preferably as the environment template `${OMNI_MEMORY_DEVICE_NO}`. The plugin sends both the `X-Device-No` header and `client_meta.device_no`.

All v2 responses are Envelope-wrapped:

```json
{ "success": true, "message": "ok", "code": 200, "data": {} }
```

The runtime unwraps `data` before reading `evidence_details`, ingest acknowledgements, or job status.

## Quick Install

Use the installer script:

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO
```

For local development, provide the plugin checkout:

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root /abs/path/to/oc-plugin \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO \
  --skip-restart
```

If you install manually, install the plugin package directory:

```bash
openclaw plugins install <plugin-root>/plugins/omnimemory-memory
```

Then configure `apiKey`, `deviceNo`, `baseUrl`, and point `plugins.slots.memory` to `omnimemory-memory`.

## Runtime Defaults

- `memory_search` is the only registered tool; `memory_get` is intentionally absent.
- `sessionScope` defaults to `global`, so recall spans OpenClaw sessions for the configured device.
- Without `groupId`, hybrid retrieval omits `group_id` and searches the memory space for the current API key and device number.
- `baseUrl` must use HTTPS by default. Local HTTP is allowed only for `localhost`, `127.0.0.1`, or `::1` when `allowInsecureBaseUrl=true`.
- Logs do not include query text, recalled memory text, or captured turn text unless `debugLogContent=true`.
- With `writeWait=false`, `agent_end` and `before_compaction` do not wait for ingest jobs. `before_reset` still waits once to flush the final turn before reset.

## Test

```bash
npm test
```

`npm test` runs `packages:sync` first, copying `shared/runtime` into the installable plugin directory at `plugins/omnimemory-memory/runtime`, then runs the Node test suite.

## Documentation

- [Product and technical notes](docs/PRODUCT.md) | [Chinese](docs/PRODUCT.zh.md)
- [Testing and acceptance guide](docs/TESTING.md) | [Chinese](docs/TESTING.zh.md)
- [Plugin package README](plugins/omnimemory-memory/README.md) | [Chinese](plugins/omnimemory-memory/README.zh.md)
- [Installer skill](skills/omnimemory-installer/SKILL.md) | [Chinese](skills/omnimemory-installer/SKILL.zh.md)
