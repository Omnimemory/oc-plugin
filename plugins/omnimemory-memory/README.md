# OmniMemory Memory Slot

[Chinese version](README.zh.md)

This is the OmniMemory memory-slot plugin package for OpenClaw. After installation, it registers `memory_search` and uses OmniMemory v2 hybrid retrieval to provide long-term memory recall for OpenClaw.

## Capabilities

- Automatic recall: `before_prompt_build` calls `POST /memory/retrieval/hybrid`.
- Tool recall: the model can call `memory_search`.
- Automatic capture: `agent_end`, `before_compaction`, and `before_reset` write capturable messages through `POST /memory/ingest`.
- `memory_get` is not registered because the current v2 backend does not expose a stable graph/detail read endpoint.
- Overlay mode is not included.

## Required Configuration

```json
{
  "apiKey": "${OMNI_MEMORY_API_KEY}",
  "baseUrl": "https://api.omnimemory.cn/api/v2",
  "deviceNo": "${OMNI_MEMORY_DEVICE_NO}",
  "sessionScope": "global"
}
```

`deviceNo` is required for hybrid retrieval. Without it, the plugin does not call the backend retrieval endpoint.

## Install

Prefer the repository-level installer:

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO
```

You can also install this package directory directly:

```bash
openclaw plugins install <plugin-root>/plugins/omnimemory-memory
```

After manual installation, make sure `plugins.slots.memory` points to `omnimemory-memory` in OpenClaw config.
