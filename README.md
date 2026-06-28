# OmniMemory OpenClaw Plugin v2

Clean OpenClaw plugin implementation for the current OmniMemory router v2 backend.

This project intentionally does not modify `../oc_plugin-1`. It keeps the useful OpenClaw wiring ideas from the old plugin, but removes v1 compatibility, graph calls, synthetic paths, and `memory_get`.

## Backend Contract

Default API base:

```text
https://cvlymnfmxqow.sealoshzh.site/api/v2
```

Used endpoints:

- `POST /memory/retrieval`
- `POST /memory/ingest`
- `GET /memory/ingest/jobs/{job_id}`

All v2 responses are Envelope-wrapped:

```json
{ "success": true, "message": "ok", "code": 200, "data": {} }
```

The runtime unwraps `data` before reading `evidence_details`, ingest acks, or job status.

## Plugin Shape

- `plugins/omnimemory-memory`: memory-slot plugin that registers `memory_search` only.

`memory_get` is not registered because the v2 backend no longer exposes a graph/detail path for it.

## Recall Scope

The default `sessionScope` is `global`, so recall is not limited to the current OpenClaw session. With no `groupId`, retrieval leaves `group_id` empty and lets OmniMemory search the account/device-wide memory space for the configured API key. Configure `groupId` when multiple OpenClaw sessions should share a named bucket. Set `sessionScope: "session"` only when every OpenClaw session must be isolated.

## Launch Safety Defaults

- `baseUrl` must use HTTPS by default. Local HTTP is allowed only for `localhost`/`127.0.0.1`/`::1` when `allowInsecureBaseUrl` is explicitly enabled.
- Logs do not include query text, recalled memory text, or captured turn text unless `debugLogContent` is explicitly enabled.
- `writeWait` defaults to `false`, so ingest jobs do not block OpenClaw lifecycle hooks by default.
- The installer grants `hooks.allowConversationAccess=true` because automatic capture reads conversation messages from lifecycle hooks.

## Test

```bash
npm test
```

`npm test` runs `packages:sync` first, so each installable plugin directory contains its own `runtime/` copy.

## Docs

- [Product document](docs/PRODUCT.md)
- [Testing document](docs/TESTING.md)

## Install In OpenClaw

Install this directory:

```bash
openclaw plugins install <plugin-root>/plugins/omnimemory-memory
```
