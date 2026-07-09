# OmniMemory Installer

[English](SKILL.md)

这个 skill 用于把 OmniMemory v2 memory-only 插件安装到 OpenClaw。安装后，OpenClaw 的 memory slot 会指向 `omnimemory-memory`，插件会注册 `memory_search`，自动召回走 `POST /memory/retrieval/hybrid`，自动写入走 `POST /memory/ingest`。

## 需要收集或确认的信息

- OpenClaw root，除非 `openclaw` 已经在 PATH 中。
- OmniMemory API key：
  - 推荐 `--api-key-env OMNI_MEMORY_API_KEY`。
  - 只有用户明确接受明文配置时才使用 `--api-key qbk_...`。
- 设备号：
  - hybrid 检索必需。
  - 推荐 `--device-no-env OMNI_MEMORY_DEVICE_NO`。
  - 只有一次性本地验证或用户明确接受明文配置时才使用 `--device-no <stable-device-no>`。
- 插件来源：
  - 本地开发优先用 `--plugin-root <path>`。
  - 未提供本地路径时，安装脚本会尝试从插件仓库拉取。
- 可选 `--base-url`，默认 `https://api.omnimemory.cn/api/v2`。
- 可选 `--group-id`。
- 默认 `sessionScope = "global"`，跨 OpenClaw 会话召回同一设备下的记忆。
- 是否允许重启 gateway；不确定时使用 `--skip-restart`。

## 推荐命令

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO
```

本地开发：

```bash
node oc-plugin/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO \
  --skip-restart
```

建议先运行 `--dry-run`，确认写入配置后再真正安装。

## 脚本行为

1. 解析插件仓库：
   - 提供 `--plugin-root` 时使用本地路径。
   - 否则从 skill 所在位置向上搜索。
   - 仍未找到时拉取配置的插件仓库，默认 `https://github.com/Omnimemory/oc-plugin`。
2. 在插件仓库执行 `npm run packages:sync`，确保可安装插件目录包含 `runtime/`。
3. 按以下顺序解析 OpenClaw CLI：
   - `node <openclaw-root>/dist/index.js`
   - `pnpm --dir <openclaw-root> --silent openclaw`
   - 全局 `openclaw`
4. 执行 `openclaw plugins install <plugin package dir>`。
5. 如果插件已安装且允许重新安装，会卸载重装，并在必要时清理旧 extension 目录。
6. 写入 OpenClaw 配置：
   - `plugins.enabled = true`
   - `plugins.entries.omnimemory-memory.enabled = true`
   - `plugins.entries.omnimemory-memory.config.apiKey = ${OMNI_MEMORY_API_KEY}` 或明文
   - `plugins.entries.omnimemory-memory.config.baseUrl = https://api.omnimemory.cn/api/v2`
   - `plugins.entries.omnimemory-memory.config.deviceNo = ${OMNI_MEMORY_DEVICE_NO}` 或明文
   - 可选 `groupId`
   - `sessionScope = global`
   - `plugins.allow` 包含 `omnimemory-memory`
   - `plugins.slots.memory = omnimemory-memory`
   - 清理旧安装器遗留的 unsupported `plugins.entries.omnimemory-memory.hooks`
7. 清理历史 overlay 配置和旧 extension 目录。
8. 执行 `openclaw config validate --json`。
9. 除非设置 `--skip-restart`，否则重启 gateway。
10. 执行 `openclaw plugins doctor`。

## 命令

安装 memory-slot 模式：

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO
```

使用本地插件仓库：

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root /abs/path/to/oc-plugin \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO
```

只验证/查看计划：

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO \
  --dry-run
```

卸载：

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
  --uninstall
```

## 注意事项

- 除非用户已经在对话中提供明文 API key，否则不要在最终输出里暴露明文 key。
- 优先使用环境变量配置：`${OMNI_MEMORY_API_KEY}` 和 `${OMNI_MEMORY_DEVICE_NO}`。
- 面向普通用户时，不要假设存在本地插件目录；默认使用配置的插件仓库。
- 安装前总是先执行 `packages:sync`。
- 写入 OpenClaw 配置后必须执行配置校验。
- gateway restart 可能打断用户时使用 `--skip-restart`。
- 分开报告安装、配置校验、重启、doctor 的部分失败。
- Windows 命令中不要使用 `~`，请使用完整路径。
- 如果缺少 `deviceNo`，hybrid 召回会失败关闭；安装或排查时优先确认设备号是否已设置。
