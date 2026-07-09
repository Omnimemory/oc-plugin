# OmniMemory OpenClaw 插件测试与验收

[English](TESTING.md)

## 1. 测试目标

验证 memory-only 插件可以在 OpenClaw 中完成以下行为：

- 安装并接管 memory slot。
- 注册 `memory_search`，不注册 `memory_get`。
- 通过 `POST /memory/retrieval/hybrid` 自动召回和工具召回。
- 在有 `deviceNo` 时发送 `X-Device-No` 和 `client_meta.device_no`。
- 缺少 `deviceNo` 时不调用 hybrid 检索接口，并给出明确错误。
- 通过 `POST /memory/ingest` 写入记忆，并在需要时轮询 `GET /memory/ingest/jobs/{job_id}`。
- 不再加载历史 overlay 插件。

## 2. 测试环境准备

准备以下路径或命令：

- OpenClaw CLI：`openclaw`，或本机 OpenClaw root。
- OpenClaw 配置：`<openclaw-state-dir>/openclaw.json`。
- OpenClaw extensions：`<openclaw-state-dir>/extensions`。
- Dashboard：OpenClaw gateway 输出的本机 dashboard 地址。
- 插件目录：`<plugin-root>`。
- OmniMemory API key：推荐通过 `OMNI_MEMORY_API_KEY`。
- OmniMemory 设备号：推荐通过 `OMNI_MEMORY_DEVICE_NO`。

## 3. 自动化测试

在插件仓库根目录执行：

```bash
cd <plugin-root>
npm test
```

预期结果：

```text
synced shared runtime -> plugins/omnimemory-memory/runtime
# tests 26
# pass 26
# fail 0
```

自动化测试覆盖：

- 插件只注册 `memory_search`。
- 自动召回 hook 使用 `before_prompt_build`。
- manifest 使用正式 v2 base URL。
- 不出现 `memory_get`。
- v2 Envelope 和 ErrorEnvelope 处理。
- hybrid 检索路径、设备号透传、group/session 参数透传。
- 缺少 `deviceNo` 时不发起后端检索。
- 只读取 `evidence_details`。
- OpenClaw 控制提示、旧召回包装和低价值内容过滤。
- ingest 请求体、幂等 commit、job 状态轮询和轮询退避。
- 日志默认不泄露 query、召回正文或写入正文。

## 4. 安装验证

推荐先 dry-run：

```bash
node <plugin-root>/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO \
  --dry-run
```

确认输出中的 `config.apiKey` 和 `config.deviceNo` 是环境变量模板后，再执行安装：

```bash
node <plugin-root>/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO
```

本地一次性验证也可以使用明文：

```bash
node <plugin-root>/skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root <plugin-root> \
  --openclaw-root <openclaw-root> \
  --api-key qbk_xxx \
  --device-no <stable-device-no> \
  --skip-restart
```

安装后检查：

```bash
openclaw config validate --json
openclaw plugins doctor
openclaw gateway health
```

预期：

- config validation 通过。
- doctor 没有 hard error。
- doctor 不再提示 `legacy before_agent_start`。
- gateway health 为 OK。

## 5. 配置验收

检查 OpenClaw 配置中应存在：

```json
{
  "plugins": {
    "enabled": true,
    "allow": ["omnimemory-memory"],
    "slots": {
      "memory": "omnimemory-memory"
    },
    "entries": {
      "omnimemory-memory": {
        "enabled": true,
        "config": {
          "apiKey": "${OMNI_MEMORY_API_KEY}",
          "baseUrl": "https://api.omnimemory.cn/api/v2",
          "deviceNo": "${OMNI_MEMORY_DEVICE_NO}",
          "sessionScope": "global",
          "autoRecall": true,
          "autoCapture": true,
          "writeWait": false
        }
      }
    }
  }
}
```

不应存在：

- `plugins.entries.omnimemory-overlay`
- `plugins.allow` 中的 `omnimemory-overlay`
- `plugins.slots.memory = "memory-core"`，除非你明确要停用 OmniMemory 插件
- extensions 目录中的 `omnimemory-overlay`
- `plugins.entries.omnimemory-memory.hooks`

## 6. 日志验收

启动或查看 gateway 日志，关注 `[omnimemory]` 前缀。

自动召回成功：

```text
[omnimemory] memory recall hook prompt_chars=...
[omnimemory] recall request -> POST /memory/retrieval/hybrid query_chars=...
[omnimemory] recall response <- status=200 raw_items=... candidates=... returned=...
[omnimemory] recall item #1 score=... rel=... source=... role=... chars=...
[omnimemory] memory recall injected items=... block_chars=...
```

工具召回成功：

```text
[omnimemory] recall request -> POST /memory/retrieval/hybrid ...
[omnimemory] recall response <- status=200 ...
```

OpenClaw UI 应显示：

```text
Memory Search
Tool output memory_search
```

写入成功：

```text
[omnimemory] capture hook normalized=... selected=... strategy=last_turn
[omnimemory] ingest prepare input_turns=... session_id=... group_id=...
[omnimemory] ingest payload turns=... roles=user commit=...
[omnimemory] ingest request -> POST /memory/ingest ...
[omnimemory] ingest response <- status=202 accepted=true job_id=...
```

如果 `writeWait=true` 或触发 `before_reset`，还应看到：

```text
[omnimemory] ingest job poll -> job_id=... path=/memory/ingest/jobs/...
[omnimemory] ingest job status <- job_id=... status=completed
```

如果后端返回旧 `status_url`，以下日志是正常兼容行为：

```text
[omnimemory] ingest response included legacy status_url="..." (ignored; polling v2 /memory/ingest/jobs/{job_id})
```

## 7. 手工测试用例

### 用例 1：自动召回

1. 打开 OpenClaw dashboard。
2. 确认插件已启用，且 `OMNI_MEMORY_API_KEY`、`OMNI_MEMORY_DEVICE_NO` 已设置。
3. 输入一个已经写入 OmniMemory 的事实问题，例如：

```text
我之前说过我的水杯是什么样的吗？
```

预期：

- 页面不一定出现 `Memory Search` 工具卡片。
- gateway 日志出现 hybrid recall 请求。
- 如果后端命中，回答能引用召回事实。

### 用例 2：工具召回

输入：

```text
调用 memory_search 查一下我有哪些关于水杯的记忆
```

预期：

- 页面显示 `Memory Search`。
- Tool output 包含 `provider: "omnimemory"`。
- 日志出现 `POST /memory/retrieval/hybrid`。

### 用例 3：写入与跨会话召回

1. 输入一条新事实：

```text
我的水杯是透明的，杯盖是蓝色的。
```

2. 等待回答结束。
3. 查看日志，确认 ingest 返回 `accepted=true` 和 `job_id`。
4. 如果没有开启 `writeWait`，等待后端异步任务完成。
5. 新建会话或 reset。
6. 输入：

```text
我的水杯是什么样的？
```

预期：

- 日志出现 hybrid recall 请求。
- 召回结果或回答中包含“透明”和“蓝色杯盖”。

### 用例 4：确认不是本地 memory 文件命中

1. 清理或忽略 OpenClaw 本地 `memory/*.md`。
2. 提问一个只存在于 OmniMemory 的事实。
3. 查看 gateway 日志中的 `recall item`。

只有日志里的 recall item 命中对应事实，才算 OmniMemory 召回成功。

### 用例 5：缺少设备号

1. 临时移除 `deviceNo` 或让 `${OMNI_MEMORY_DEVICE_NO}` 为空。
2. 触发自动召回或 `memory_search`。

预期：

- 日志出现 `deviceNo is required for hybrid retrieval`。
- 不应向后端发送 `POST /memory/retrieval/hybrid`。
- 配置恢复设备号后，召回恢复正常。

## 8. 常见问题

### 页面没有 Memory Search，是不是没召回？

不一定。自动召回是隐藏注入，不显示工具卡片。判断自动召回要看 gateway 日志里的 `memory recall injected`。

### 页面回答了历史信息，但日志没有 recall item，算不算 OmniMemory 命中？

不算。可能来自当前上下文、本地 memory 文件或模型上下文残留。OmniMemory 命中需要看到 `recall item #...`。

### recall 返回不相关内容怎么办？

先检查日志中的 `raw_items`、`candidates`、`returned` 和 `recall item`。插件会做基础过滤和简单重排，但召回质量主要取决于后端 hybrid 检索。

### 为什么日志里还有 v1 字样？

插件请求只走 v2。v1 字样只可能来自后端返回的 legacy `status_url`，插件会忽略它并轮询 v2 job 路径。

### doctor 仍提示 legacy before_agent_start 怎么办？

说明 OpenClaw 运行目录里还是旧插件。重新执行安装脚本，确保 extensions 中只有 `omnimemory-memory`，然后重启 gateway。

## 9. 回归检查清单

- `npm test` 通过。
- `packages:sync` 只同步 `omnimemory-memory/runtime`。
- OpenClaw config validation 通过。
- `plugins.slots.memory = "omnimemory-memory"`。
- `plugins.allow` 包含 `omnimemory-memory`。
- `omnimemory-overlay` 不在 entries、allow 或 extensions 中。
- 配置中有 `apiKey` 和 `deviceNo`。
- 自动召回日志出现 `POST /memory/retrieval/hybrid`。
- 工具召回能显示 `Memory Search`。
- 写入使用 `POST /memory/ingest`。
- 等待写入时轮询 `GET /memory/ingest/jobs/{job_id}`。
