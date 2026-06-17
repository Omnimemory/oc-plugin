---
name: omnimemory-installer
description: Install, configure, validate, repair, or uninstall the OmniMemory v2 OpenClaw memory plugin. Use when a user wants Codex to automatically connect OmniMemory to OpenClaw, fetch the plugin from GitHub when no local plugin path is provided, wire qbk API key/baseUrl/device/group config, run package sync, run OpenClaw validation, and optionally restart the gateway.
---

# OmniMemory Installer

Use this skill when the user wants OmniMemory installed into OpenClaw with minimal manual steps.

## Mode

- `memory`: installs `omnimemory-memory`, a memory-slot replacement that registers `memory_search` only.

This plugin package is memory-only.

## Inputs

Collect or infer:

- OpenClaw root path, unless `openclaw` is already on PATH.
- OmniMemory API key source:
  - Prefer `--api-key-env OMNI_MEMORY_API_KEY`.
  - Use `--api-key qbk_...` only if the user explicitly wants plaintext config.
- Plugin source:
  - `--plugin-root <path>` for local development.
  - If omitted, the installer fetches the plugin repo from GitHub.
- Optional `--base-url`, default `https://cvlymnfmxqow.sealoshzh.site/api/v2`.
- Optional `--device-no` and `--group-id`.
- Recall scope defaults to `sessionScope: "global"` for cross-OpenClaw-session recall. Use `--group-id` for a shared named bucket; only manually set `sessionScope: "session"` when sessions must be isolated.
- Whether gateway restart is allowed. Use `--skip-restart` if unclear.

## Preferred Command

Run the bundled script from this skill:

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY
```

For local development of this repo:

```bash
node oc-plugin/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key-env OMNI_MEMORY_API_KEY \
  --skip-restart
```

Use `--dry-run` first when you need to show the exact changes without writing config.

## What The Script Does

1. Resolve plugin repo:
   - Use `--plugin-root` when provided.
   - Otherwise search upward from the skill.
   - Otherwise clone `https://github.com/Omnimemory/oc-plugin`.
2. Run `npm run packages:sync` in the plugin repo so the installable plugin folder contains `runtime/`.
3. Resolve OpenClaw CLI:
   - `node <openclaw-root>/dist/index.js`
   - then global `openclaw`
   - then `pnpm --dir <openclaw-root> --silent openclaw`
4. Run `openclaw plugins install <plugin package dir>` when not already installed.
5. Patch OpenClaw config:
   - `plugins.enabled = true`
   - `plugins.entries.omnimemory-memory.enabled = true`
   - `plugins.entries.omnimemory-memory.config.apiKey = ${ENV}` or plaintext
   - `plugins.entries.omnimemory-memory.config.baseUrl = https://cvlymnfmxqow.sealoshzh.site/api/v2`
   - optional `deviceNo` and `groupId`
   - `sessionScope = global` for cross-session recall
   - `plugins.allow` includes `omnimemory-memory`
   - `plugins.slots.memory = omnimemory-memory`
6. Run `openclaw config validate --json`.
7. Restart gateway unless `--skip-restart`.
8. Run `openclaw plugins doctor`.

## Commands

Install memory-slot mode:

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY
```

Use a local plugin checkout:

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root /abs/path/to/oc-plugin \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY
```

Validate/inspect only:

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
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
- Prefer env var config: `${OMNI_MEMORY_API_KEY}`.
- Do not assume a local plugin directory for ordinary users; default to GitHub.
- Always run `packages:sync` before install.
- Always validate OpenClaw config after writing it.
- Use `--skip-restart` when gateway restart could interrupt the user.
- Report partial failures clearly: install, config validation, restart, and doctor are separate outcomes.
- Never use `~` in Windows commands; use full paths.
