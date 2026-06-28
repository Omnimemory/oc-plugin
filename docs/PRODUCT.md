# OmniMemory OpenClaw 插件产品文档

## 产品定位

OmniMemory OpenClaw 插件用于把 OpenClaw 的长期记忆能力接到 OmniMemory v2 后端。当前插件只保留 `memory` 模式，不再提供 overlay 模式。

插件安装后会接管 OpenClaw 的 memory slot，并注册一个 `memory_search` 工具。模型可以通过该工具查询 OmniMemory 中的历史记忆；插件也会在 agent 开始前做一次自动召回，把命中的记忆以系统上下文方式注入给模型。

## 当前形态

- 插件 ID：`omnimemory-memory`
- 插件目录：`plugins/omnimemory-memory`
- OpenClaw slot：`plugins.slots.memory = "omnimemory-memory"`
- 注册工具：`memory_search`
- 不注册：`memory_get`
- 不支持：overlay 模式

`memory_get` 没有注册，是因为当前 OmniMemory v2 后端没有提供图谱/detail 读取接口。

## 后端接口

默认后端地址：

```text
https://cvlymnfmxqow.sealoshzh.site/api/v2
```

插件只使用 v2 接口：

- `POST /memory/retrieval`
- `POST /memory/ingest`
- `GET /memory/ingest/jobs/{job_id}`

v2 返回是 Envelope 结构：

```json
{
  "success": true,
  "message": "ok",
  "code": 200,
  "data": {}
}
```

插件会先解包 `data`，再读取 `evidence_details`、写入 ack 或 job 状态。

## 核心能力

### 记忆召回

插件有两条召回路径：

- 自动召回：`before_prompt_build` hook 会拿用户当前 prompt 查询 OmniMemory，并把结果注入系统上下文。
- 工具召回：模型主动调用 `memory_search` 时，OpenClaw UI 会显示工具调用和工具输出。

自动召回不会在 OpenClaw 页面显示 `memory_search` 工具卡片，需要看 gateway 日志确认：

```text
[omnimemory] memory recall hook prompt_chars=...
[omnimemory] recall request -> POST /memory/retrieval ...
[omnimemory] recall response <- status=200 ...
[omnimemory] memory recall injected items=...
```

工具召回会在页面显示：

```text
Memory Search
```

两条路径底层都调用同一个 `searchMemory()`。

### 记忆写入

插件在以下生命周期写入 OmniMemory：

- `agent_end`
- `before_compaction`
- `before_reset`

默认写入策略是 `last_turn`，只写最近一轮用户消息。默认 `captureRoles = ["user"]`，不会写入助手回复。

写入后默认不等待 job 完成，因为 `writeWait = false`，避免阻塞 OpenClaw 的 agent 结束、压缩和重置链路。需要强一致验证时可以显式设置 `writeWait = true`，并用 `writeWaitTimeoutMs` 控制等待上限。开启等待后日志中应能看到：

```text
[omnimemory] ingest request -> POST /memory/ingest ...
[omnimemory] ingest response <- status=202 ...
[omnimemory] ingest job poll -> ... /memory/ingest/jobs/{job_id}
[omnimemory] ingest job status <- ... status=succeeded
```

如果后端返回旧的 `/api/v1/...` status_url，插件会忽略它，仍然轮询 v2：

```text
[omnimemory] ingest response included legacy status_url="..." (ignored; polling v2 /memory/ingest/jobs/{job_id})
```

## 配置项

常用配置：

- `apiKey`：OmniMemory API key，支持明文或 `${OMNI_MEMORY_API_KEY}`。
- `baseUrl`：OmniMemory v2 API 根地址。
- `allowInsecureBaseUrl`：仅本地开发用。默认 `false`，生产默认只允许 HTTPS；只有设置为 `true` 时才允许 `http://localhost`、`http://127.0.0.1`、`http://[::1]`。
- `deviceNo`：可选设备号，会写入 `X-Device-No` 和 `client_meta.device_no`。
- `groupId`：可选共享记忆分组。
- `sessionScope`：默认 `global`，跨 OpenClaw 会话召回。
- `searchLimit`：工具召回默认返回数量。
- `autoRecall`：是否启用自动召回，默认 `true`。
- `autoCapture`：是否自动写入，默认 `true`。
- `recallTopK`：自动召回返回数量，默认 `5`。
- `recallMinScore`：最低后端分数，默认 `0`。
- `captureStrategy`：`last_turn` 或 `full_session`。
- `captureRoles`：默认只写 `user`。
- `writeWait`：写入后是否等待 job 完成，默认 `false`。
- `writeWaitTimeoutMs`：`writeWait = true` 时的等待上限，默认 `15000`。
- `failSilent`：失败时是否静默返回空结果，默认 `true`。
- `timeoutMs`：请求超时时间，默认 `10000`。
- `debugLogContent`：是否在日志中打印查询、召回结果、写入正文片段，默认 `false`。

默认日志只记录数量、长度、分数、事件 ID、状态等元信息，不打印用户消息或召回正文。排查线上问题时才建议短期开启 `debugLogContent`。

## 召回范围

默认 `sessionScope = "global"`。这表示插件不会把 `group_id` 固定为当前 OpenClaw 会话，而是让 OmniMemory 在当前 API key 对应的全局记忆空间中搜索。

如果配置了 `groupId`，插件会把它传给 retrieval 和 ingest，用于共享记忆桶。

如果设置 `sessionScope = "session"`，插件会把当前 session 作为分组边界，适合需要隔离每个 OpenClaw 会话的场景。

## 安装方式

推荐使用安装脚本：

```bash
node oc-plugin/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key-env OMNI_MEMORY_API_KEY
```

本地测试时也可以用明文 key：

```bash
node oc-plugin/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key qbk_xxx
```

安装脚本会：

1. 执行 `npm run packages:sync`。
2. 安装 `plugins/omnimemory-memory`。
3. 写入 OpenClaw 配置。
4. 设置 `plugins.slots.memory = "omnimemory-memory"`。
5. 设置 `plugins.allow = ["omnimemory-memory"]`。
6. 设置 `plugins.entries.omnimemory-memory.hooks.allowConversationAccess = true`，允许可信插件在 `agent_end` 等生命周期读取会话用于自动写入。
7. 清理历史 overlay 配置和目录。
8. 执行配置校验和插件 doctor。

安装后需要重启 gateway：

```bash
openclaw gateway restart
```

## 已知行为

- 自动召回是隐藏注入，不会显示工具卡片。
- 插件会自动写入用户消息到 OmniMemory；默认 `sessionScope = "global"` 会跨 OpenClaw 会话召回。敏感场景应显式关闭 `autoCapture` 或改用 `sessionScope = "session"`。
- 页面出现 `Memory Search` 工具卡片时，说明模型主动调用了 `memory_search`。
- 如果召回结果不相关，通常是后端 retrieval 返回质量问题。默认日志会显示返回数量、分数、来源、角色、事件 ID 和正文长度；只有显式开启 `debugLogContent` 才会打印正文片段。
- 插件会过滤明显的 OpenClaw 控制提示和旧召回包装，避免把系统噪音写入 OmniMemory。
