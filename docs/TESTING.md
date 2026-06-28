# OmniMemory OpenClaw 插件测试文档

## 测试目标

确认 memory-only 插件在 OpenClaw 中可安装、可召回、可写入、可等待 ingest job 完成，并且不会再加载 overlay 插件。

## 测试环境

测试前准备以下路径或命令：

- OpenClaw CLI：`openclaw`，或本机 OpenClaw CLI 的完整路径。
- OpenClaw root：`<openclaw-root>`。
- OpenClaw 配置：`<openclaw-state-dir>/openclaw.json`。
- OpenClaw extensions：`<openclaw-state-dir>/extensions`。
- Dashboard：OpenClaw gateway 输出的本机 dashboard 地址。
- 插件目录：`<plugin-root>`。

## 自动化测试

在插件目录执行：

```bash
cd <plugin-root>
npm.cmd test
```

预期：

```text
synced shared runtime -> plugins/omnimemory-memory/runtime
# pass 16
# fail 0
```

自动化测试覆盖：

- memory 插件只注册 `memory_search`。
- memory 插件会注册自动召回 hook。
- manifest 使用 v2 baseUrl，且不包含 `memory_get`。
- v2 Envelope 解包。
- v2 ErrorEnvelope 抛错。
- retrieval 只读取 `evidence_details`。
- group/session/device 参数透传。
- 控制提示和旧召回包装过滤。
- ingest 使用 v2 `/memory/ingest`。
- ingest job 轮询 v2 `/memory/ingest/jobs/{job_id}`。

## 安装验证

安装 memory 插件：

```bash
node <plugin-root>/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key qbk_xxx \
  --skip-restart
```

重启 gateway：

```bash
openclaw gateway restart
```

校验配置：

```bash
openclaw config validate --json
```

预期：

```json
{"valid":true,"path":"<openclaw-state-dir>/openclaw.json"}
```

检查插件 doctor：

```bash
openclaw plugins doctor
```

不应出现插件 hard error 或 legacy hook warning。当前插件自动召回已迁移到 `before_prompt_build`，所以不应再出现：

```text
omnimemory-memory still uses legacy before_agent_start
```

检查 gateway：

```bash
openclaw gateway health
```

预期：

```text
Gateway Health
OK
```

## 配置验证

查看关键配置：

```powershell
Select-String -Path <openclaw-state-dir>\openclaw.json -Pattern '"memory"|omnimemory-memory|omnimemory-overlay|"allow"|baseUrl|writeWait|autoCapture'
```

预期运行态：

```text
"memory": "omnimemory-memory"
"allow": [
  "omnimemory-memory"
]
"baseUrl": "https://cvlymnfmxqow.sealoshzh.site/api/v2"
"autoCapture": true
"writeWait": true
```

不应存在运行态 overlay：

- `plugins.entries.omnimemory-overlay` 不应存在。
- `plugins.allow` 不应包含 `omnimemory-overlay`。
- `plugins.slots.memory` 不应是 `memory-core`。

检查 extensions 目录：

```powershell
Get-ChildItem -Force <openclaw-state-dir>\extensions
```

预期只看到：

```text
omnimemory-memory
```

## 日志观察

启动或查看 gateway 日志后，关注 `[omnimemory]` 前缀。

自动召回成功日志：

```text
[omnimemory] memory recall hook prompt_chars=...
[omnimemory] recall request -> POST /memory/retrieval query="..." original="..."
[omnimemory] recall response <- status=200 raw_items=... candidates=... returned=...
[omnimemory] recall item #1 score=... rel=... source=... role=... text="..."
[omnimemory] memory recall injected items=... block_chars=...
```

工具召回成功日志：

```text
[omnimemory] recall request -> POST /memory/retrieval ...
[omnimemory] recall response <- status=200 ...
```

同时 OpenClaw UI 会显示：

```text
Memory Search
Tool output memory_search
```

写入成功日志：

```text
[omnimemory] capture hook normalized=... selected=... strategy=last_turn
[omnimemory] ingest prepare input_turns=... session_id=... group_id=...
[omnimemory] ingest payload turns=... roles=user commit=...
[omnimemory] ingest request -> POST /memory/ingest ...
[omnimemory] ingest response <- status=202 accepted=true job_id=...
[omnimemory] ingest job poll -> job_id=... path=/memory/ingest/jobs/...
[omnimemory] ingest job status <- job_id=... status=succeeded
```

如果看到下面日志，属于正常兼容处理：

```text
[omnimemory] ingest response included legacy status_url="..." (ignored; polling v2 /memory/ingest/jobs/{job_id})
```

这表示后端响应里带了旧 v1 status_url，但插件没有使用它。

## 手工测试用例

### 用例 1：确认自动召回

步骤：

1. 打开 OpenClaw gateway 输出的 dashboard 地址。
2. 新建或继续一个会话。
3. 输入一个之前已经写入过的事实问题，例如：

```text
我有几个打火机
```

预期：

- 页面不一定出现 `Memory Search` 工具卡片。
- 终端出现 `memory recall injected items=...`。
- 如果召回命中，回答能包含历史事实。

判断标准：

```text
recall response <- status=200
memory recall injected items=1
```

或 items 大于 1。

### 用例 2：确认工具召回

步骤：

1. 在 OpenClaw 页面明确要求：

```text
调用 memory_search 查一下我有什么关于打火机的记忆
```

预期：

- 页面显示 `Memory Search`。
- Tool output 中包含 `provider: "omnimemory"`。
- 日志出现 retrieval 请求。

### 用例 3：确认写入和跨会话召回

步骤：

1. 输入一条新事实：

```text
我的水杯是透明的
```

2. 等待回答结束。
3. 查看日志，确认 ingest job `succeeded`。
4. 开新会话或 reset。
5. 输入：

```text
我的水杯是什么样的
```

预期：

- 终端出现 recall 请求。
- 返回结果中包含“透明”。
- 页面回答中能说出水杯是透明的。

### 用例 4：确认 OpenClaw 本地记忆不是唯一来源

步骤：

1. 清理或忽略 OpenClaw 本地 `memory/*.md`。
2. 提问一个已写入 OmniMemory 的事实。
3. 看日志里的 `recall item`。

预期：

- 如果日志中 `recall item` 包含该事实，则回答可判定来自 OmniMemory。
- 如果页面回答引用了 `memory/2026-xx-xx.md`，但日志没有命中对应事实，则不是 OmniMemory 召回成功。

### 用例 5：确认 overlay 不再运行

步骤：

1. 查看 extensions 目录。
2. 查看 OpenClaw 配置。
3. 运行插件 doctor。

预期：

- extensions 目录没有 `omnimemory-overlay`。
- `plugins.allow` 没有 `omnimemory-overlay`。
- 日志里没有 `overlay recall`。

## 常见问题判断

### 页面没有 Memory Search，是不是没召回？

不一定。自动召回是隐藏注入，不显示工具卡片。以终端日志为准：

```text
memory recall injected items=...
```

### 页面回答了历史信息，但日志没有 recall item，算不算 OmniMemory 命中？

不算。可能是 OpenClaw 当前上下文、本地 memory 文件或模型上下文残留。判断 OmniMemory 命中要看日志里的：

```text
recall item #...
```

### recall 返回了不相关内容怎么办？

先看日志字段：

```text
source=...
role=...
text="..."
```

如果 `text` 与 query 无关，说明后端 retrieval 返回质量不稳定。插件当前会做基础低价值过滤和简单相关性重排，但不会完全替代后端检索质量。

### 为什么还有 v1 字样？

插件请求只走 v2。日志里的 v1 只可能来自后端返回的 `status_url` 字段：

```text
backend_status_url_ignored=/api/v1/...
```

插件会忽略它，并轮询：

```text
/memory/ingest/jobs/{job_id}
```

### 为什么 doctor 不应再提示 legacy before_agent_start？

插件自动召回已迁移到 `before_prompt_build`。如果 doctor 仍提示 `legacy before_agent_start`，说明安装目录里仍是旧版本插件，需要重新执行安装脚本并重启 gateway。

## 回归检查清单

- `npm.cmd test` 通过。
- `packages:sync` 只同步 `omnimemory-memory/runtime`。
- OpenClaw config valid。
- `plugins.slots.memory = omnimemory-memory`。
- `plugins.allow = ["omnimemory-memory"]`。
- extensions 目录没有 overlay。
- 自动召回日志出现 `memory recall injected`。
- 工具召回能显示 `Memory Search`。
- ingest 使用 `/memory/ingest`。
- job poll 使用 `/memory/ingest/jobs/{job_id}`。
