# OmniMemory Memory Slot

[English](README.md)

这是 OmniMemory 的 OpenClaw memory-slot 插件包。安装后，它会注册 `memory_search` 工具，并通过 OmniMemory v2 hybrid 检索为 OpenClaw 提供长期记忆召回。

## 能力

- 自动召回：`before_prompt_build` 调用 `POST /memory/retrieval/hybrid`。
- 工具召回：模型可以主动调用 `memory_search`。
- 自动写入：`agent_end`、`before_compaction`、`before_reset` 会把可捕获消息写入 `POST /memory/ingest`。
- 不注册 `memory_get`，因为当前 v2 后端没有稳定 graph/detail 读取接口。
- 不包含 overlay 模式。

## 必要配置

```json
{
  "apiKey": "${OMNI_MEMORY_API_KEY}",
  "baseUrl": "https://api.omnimemory.cn/api/v2",
  "deviceNo": "${OMNI_MEMORY_DEVICE_NO}",
  "sessionScope": "global"
}
```

`deviceNo` 是 hybrid 检索必需项。缺少设备号时，插件不会调用后端检索接口。

## 安装

推荐从仓库根目录使用安装脚本：

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO
```

也可以直接安装本目录：

```bash
openclaw plugins install <plugin-root>/plugins/omnimemory-memory
```

手动安装后，请确认 OpenClaw 配置里 `plugins.slots.memory` 指向 `omnimemory-memory`。
