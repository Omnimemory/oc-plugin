---
name: omnimemory-installer
description: Install, configure, validate, repair, or uninstall the OmniMemory v2 OpenClaw memory plugin. Use when a user wants Codex to connect OmniMemory to OpenClaw, configure API key/baseUrl/device/group settings, run package sync, validate OpenClaw config, and optionally restart the gateway.
---

# OmniMemory Installer

[Chinese version](SKILL.zh.md)

Use this skill when the user wants OmniMemory installed into OpenClaw with minimal manual steps. The package is memory-only: it installs `omnimemory-memory`, owns the OpenClaw memory slot, registers `memory_search`, uses `POST /memory/retrieval/hybrid` for recall, and uses `POST /memory/ingest` for capture.

## Inputs

Collect or infer:

- OpenClaw root path, unless `openclaw` is already on PATH.
- OmniMemory API key source:
  - Prefer `--api-key-env OMNI_MEMORY_API_KEY`.
  - Use `--api-key qbk_...` only if the user explicitly wants plaintext config.
- Device number:
  - Required for hybrid retrieval.
  - Prefer `--device-no-env OMNI_MEMORY_DEVICE_NO`.
  - Use `--device-no <stable-device-no>` only for local one-off validation or when plaintext device config is acceptable.
- Plugin source:
  - Use `--plugin-root <path>` for local development.
  - If omitted, the installer fetches the plugin repository.
- Optional `--base-url`, default `https://api.omnimemory.cn/api/v2`.
- Optional `--group-id`.
- Recall scope defaults to `sessionScope: "global"` for cross-OpenClaw-session recall within the configured device.
- Whether gateway restart is allowed. Use `--skip-restart` if unclear.

## Preferred Command

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO
```

For local development of this repo:

```bash
node oc-plugin/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO \
  --skip-restart
```

Use `--dry-run` first when you need to show the exact changes without writing config.

## What The Script Does

1. Resolve plugin repo:
   - Use `--plugin-root` when provided.
   - Otherwise search upward from the skill.
   - Otherwise clone the configured plugin repo, defaulting to `https://github.com/Omnimemory/oc-plugin`.
2. Run `npm run packages:sync` in the plugin repo so the installable plugin folder contains `runtime/`.
3. Resolve OpenClaw CLI in this order:
   - `node <openclaw-root>/dist/index.js`
   - `pnpm --dir <openclaw-root> --silent openclaw`
   - global `openclaw`
4. Run `openclaw plugins install <plugin package dir>`.
5. If the plugin already exists and reinstall is allowed, uninstall/reinstall and remove stale extension directories when needed.
6. Patch OpenClaw config:
   - `plugins.enabled = true`
   - `plugins.entries.omnimemory-memory.enabled = true`
   - `plugins.entries.omnimemory-memory.config.apiKey = ${OMNI_MEMORY_API_KEY}` or plaintext
   - `plugins.entries.omnimemory-memory.config.baseUrl = https://api.omnimemory.cn/api/v2`
   - `plugins.entries.omnimemory-memory.config.deviceNo = ${OMNI_MEMORY_DEVICE_NO}` or plaintext
   - optional `groupId`
   - `sessionScope = global`
   - `plugins.allow` includes `omnimemory-memory`
   - `plugins.slots.memory = omnimemory-memory`
   - remove unsupported `plugins.entries.omnimemory-memory.hooks` left by older installer versions
7. Remove historical overlay entries and stale overlay extension directories.
8. Run `openclaw config validate --json`.
9. Restart gateway unless `--skip-restart`.
10. Run `openclaw plugins doctor`.

## Commands

Install memory-slot mode:

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO
```

Use a local plugin checkout:

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root /abs/path/to/oc-plugin \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO
```

Validate/inspect only:

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO \
  --dry-run
```

Uninstall:

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
  --uninstall
```

## Guardrails

- Do not expose plaintext API keys in final output unless the user already provided them in the conversation.
- Prefer env var config: `${OMNI_MEMORY_API_KEY}` and `${OMNI_MEMORY_DEVICE_NO}`.
- Do not assume a local plugin directory for ordinary users; default to the configured plugin repository.
- Always run `packages:sync` before install.
- Always validate OpenClaw config after writing it.
- Use `--skip-restart` when gateway restart could interrupt the user.
- Report partial failures clearly: install, config validation, restart, and doctor are separate outcomes.
- Never use `~` in Windows commands; use full paths.
- If `deviceNo` is missing, hybrid recall fails closed. Check device number configuration first when debugging recall failures.
