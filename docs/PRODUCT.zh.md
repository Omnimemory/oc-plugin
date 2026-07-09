# OmniMemory OpenClaw 插件产品与技术说明

[English](PRODUCT.md)

## 1. 产品定位

OmniMemory OpenClaw 插件用于把 OpenClaw 的长期记忆能力接到 OmniMemory v2 后端。当前插件只保留 `memory` 模式：它接管 OpenClaw 的 memory slot，注册 `memory_search` 工具，并通过 OpenClaw lifecycle hooks 自动完成召回和写入。

当前不提供：

- overlay 模式
- v1 API 兼容路径
- `memory_get`
- 图谱/detail 读取路径

`memory_get` 不注册，是因为当前 OmniMemory v2 对外数据面没有提供稳定的图谱/detail 读取接口。模型需要历史信息时应使用 `memory_search`。

## 2. 当前形态

- 插件 ID：`omnimemory-memory`
- 插件目录：`plugins/omnimemory-memory`
- OpenClaw slot：`plugins.slots.memory = "omnimemory-memory"`
- 注册工具：`memory_search`
- 默认后端：`https://api.omnimemory.cn/api/v2`
- 默认召回接口：`POST /memory/retrieval/hybrid`

## 3. 后端接口契约

插件只使用 OmniMemory v2 接口：

| 用途 | 方法与路径 | 说明 |
| --- | --- | --- |
| 记忆召回 | `POST /memory/retrieval/hybrid` | hybrid 检索，必须携带设备号 |
| 记忆写入 | `POST /memory/ingest` | 异步写入对话 turn |
| 写入状态 | `GET /memory/ingest/jobs/{job_id}` | 当需要等待写入完成时轮询 job |

hybrid 检索要求稳定设备号。插件会从 `deviceNo` 配置解析设备号，并同时发送：

- 请求头：`X-Device-No: <deviceNo>`
- 请求体：`client_meta.device_no`

所有 v2 响应都按 Envelope 包装：

```json
{
  "success": true,
  "message": "ok",
  "code": 200,
  "data": {}
}
```

插件会先解包 `data`，再读取 `evidence_details`、写入 ack 或 job 状态。

## 4. 核心能力

### 自动召回

`before_prompt_build` hook 会读取当前用户 prompt，调用 `POST /memory/retrieval/hybrid`，再把召回结果注入为系统上下文。自动召回不会在 OpenClaw 页面显示工具卡片，需要从 gateway 日志确认：

```text
[omnimemory] memory recall hook prompt_chars=...
[omnimemory] recall request -> POST /memory/retrieval/hybrid ...
[omnimemory] recall response <- status=200 raw_items=... candidates=... returned=...
[omnimemory] memory recall injected items=...
```

如果没有配置 `deviceNo`，自动召回会失败并返回基础提示，不会调用后端检索接口。

### 工具召回

模型主动调用 `memory_search` 时，OpenClaw UI 会显示工具调用。工具返回 JSON 文本，结构中包含：

- `results`
- `provider: "omnimemory"`
- 每条结果的 `path`、`score`、`snippet` 和 metadata

### 记忆写入

插件在以下 lifecycle hooks 尝试写入 OmniMemory：

- `agent_end`
- `before_compaction`
- `before_reset`

默认写入策略是 `last_turn`，只写最近一轮可捕获消息。默认 `captureRoles = ["user"]`，不会写入助手回复。

`writeWait=false` 时，`agent_end` 和 `before_compaction` 不等待 ingest job 完成，只确认后端接受任务并返回 `job_id`。`before_reset` 会强制等待一次，尽量在重置前刷入最后一轮内容。需要更强一致性时可以显式设置 `writeWait=true`。

## 5. 召回范围

默认 `sessionScope = "global"`。这表示插件不会把 `group_id` 固定为当前 OpenClaw 会话，而是在当前 API key 与设备号对应的记忆空间中跨 OpenClaw 会话召回。

如果配置了 `groupId`，插件会在 retrieval 和 ingest 中发送 `group_id`，用于共享记忆桶。

如果设置 `sessionScope = "session"`，插件会把当前 OpenClaw session 作为分组边界，适合需要隔离每个会话的场景。

## 6. 配置项

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKey` | 无 | OmniMemory API key。推荐 `${OMNI_MEMORY_API_KEY}` |
| `baseUrl` | `https://api.omnimemory.cn/api/v2` | OmniMemory v2 API 根地址 |
| `deviceNo` | 无 | hybrid 检索必需。推荐 `${OMNI_MEMORY_DEVICE_NO}` |
| `allowInsecureBaseUrl` | `false` | 仅本地开发用；只允许 localhost HTTP |
| `groupId` | 无 | 可选共享记忆分组 |
| `sessionId` | OpenClaw ctx | 可选固定 session |
| `sessionScope` | `global` | `global` 或 `session` |
| `searchLimit` | `8` | 工具召回默认返回数量 |
| `autoRecall` | `true` | 是否启用自动召回 |
| `recallTopK` | `5` | 自动召回返回数量 |
| `recallMinScore` | `0` | 召回最低后端分数 |
| `minPromptChars` | `2` | prompt 太短时跳过后端召回 |
| `autoCapture` | `true` | 是否自动写入 |
| `captureStrategy` | `last_turn` | `last_turn` 或 `full_session` |
| `captureRoles` | `["user"]` | 默认只写用户消息 |
| `writeWait` | `false` | 是否在 agent_end/compaction 等待写入完成 |
| `writeWaitTimeoutMs` | `15000` | 等待写入完成的上限 |
| `failSilent` | `true` | 工具调用失败时是否返回空结果而非抛错 |
| `timeoutMs` | `10000` | 单次 HTTP 请求超时 |
| `debugLogContent` | `false` | 是否在日志中打印截断后的正文 |
| `promptBlockTitle` | `OmniMemory Recall` | 注入系统上下文块标题 |

## 7. 安装方式

推荐使用安装脚本：

```bash
node oc-plugin/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO
```

本地一次性验证可以传明文：

```bash
node oc-plugin/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key qbk_xxx \
  --device-no <stable-device-no>
```

安装脚本会：

1. 解析或拉取插件仓库。
2. 执行 `npm run packages:sync`，确保可安装目录包含 runtime 拷贝。
3. 安装 `plugins/omnimemory-memory`。
4. 写入 OpenClaw 配置。
5. 设置 `plugins.slots.memory = "omnimemory-memory"`。
6. 写入 `plugins.entries.omnimemory-memory.config`，包括 API key、v2 base URL、设备号和安全默认值。
7. 清理旧安装器遗留的 unsupported entry-level hooks。
8. 清理历史 overlay 配置和目录。
9. 执行 OpenClaw 配置校验、gateway restart 和插件 doctor。

## 8. 安全与隐私默认值

- API key 推荐通过环境变量引用，不建议写入明文配置。
- 默认日志不打印 query、召回正文或写入正文。
- 召回内容会以受限历史上下文注入，提示模型不要执行记忆中的指令。
- `allowInsecureBaseUrl` 默认关闭，生产路径必须使用 HTTPS。
- 自动写入默认只写用户消息，降低把模型输出或工具噪音写成长期记忆的风险。

## 9. 已知行为

- 自动召回是隐藏注入，不显示 `Memory Search` 工具卡片。
- 页面出现 `Memory Search` 时，说明模型主动调用了 `memory_search`。
- 如果召回结果不相关，优先检查后端 hybrid 检索结果；插件只做基础低价值过滤和简单相关性重排。
- 如果日志里出现旧 `/api/v1/...` `status_url`，插件会忽略它，并继续轮询 v2 `/memory/ingest/jobs/{job_id}`。
