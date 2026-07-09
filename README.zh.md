# OmniMemory OpenClaw Plugin v2

[English](README.md)

## 项目定位

本仓库提供 OmniMemory 的 OpenClaw memory-slot 插件。插件把 OpenClaw 的长期记忆能力接入 OmniMemory v2 后端，当前只保留 `memory` 模式，不再提供 overlay 模式、v1 兼容路径、图谱 detail 读取或 `memory_get`。

安装后，插件会接管 OpenClaw 的 memory slot，注册 `memory_search` 工具，并在构建 prompt 前自动召回 OmniMemory 记忆。会话结束、压缩和重置时，插件会把最近一轮可捕获消息写回 OmniMemory。

## 后端契约

默认 API 根地址：

```text
https://api.omnimemory.cn/api/v2
```

插件使用的接口：

- `POST /memory/retrieval/hybrid`
- `POST /memory/ingest`
- `GET /memory/ingest/jobs/{job_id}`

hybrid 检索必须提供稳定设备号。请配置 `deviceNo`，推荐使用环境变量模板 `${OMNI_MEMORY_DEVICE_NO}`。插件会同时发送 `X-Device-No` 请求头和 `client_meta.device_no`。

所有 v2 响应都按 Envelope 包装：

```json
{ "success": true, "message": "ok", "code": 200, "data": {} }
```

运行时会先解包 `data`，再读取 `evidence_details`、ingest ack 或 job 状态。

## 快速安装

推荐使用安装脚本：

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO
```

本地开发时可以指定插件目录：

```bash
node skills/omnimemory-installer/scripts/install_omnimemory.mjs \
  --mode memory \
  --plugin-root /abs/path/to/oc-plugin \
  --openclaw-root /abs/path/to/openclaw \
  --api-key-env OMNI_MEMORY_API_KEY \
  --device-no-env OMNI_MEMORY_DEVICE_NO \
  --skip-restart
```

不使用安装脚本时，可以直接安装插件目录：

```bash
openclaw plugins install <plugin-root>/plugins/omnimemory-memory
```

然后在 OpenClaw 配置中设置 `apiKey`、`deviceNo`、`baseUrl`，并将 `plugins.slots.memory` 指向 `omnimemory-memory`。

## 默认行为

- `memory_search` 是唯一注册工具；`memory_get` 不注册。
- `sessionScope` 默认是 `global`，表示跨 OpenClaw 会话召回同一设备下的记忆。
- 未配置 `groupId` 时，hybrid 检索不发送 `group_id`，由后端在当前 API key 和设备号对应的记忆空间内检索。
- `baseUrl` 默认必须是 HTTPS；本地 HTTP 只允许 `localhost`、`127.0.0.1` 或 `::1`，且必须显式设置 `allowInsecureBaseUrl=true`。
- 日志默认不输出查询正文、召回正文或捕获消息正文；只有 `debugLogContent=true` 时才会输出截断后的内容。
- `writeWait=false` 时，`agent_end` 和 `before_compaction` 不等待 ingest job 完成；`before_reset` 会等待一次，尽量在重置前刷入最后一轮内容。

## 测试

```bash
npm test
```

`npm test` 会先运行 `packages:sync`，把 `shared/runtime` 同步到可安装插件目录 `plugins/omnimemory-memory/runtime`，再执行 Node 测试。

## 文档

- [产品与技术说明](docs/PRODUCT.zh.md) | [English](docs/PRODUCT.md)
- [测试与验收说明](docs/TESTING.zh.md) | [English](docs/TESTING.md)
- [插件包 README](plugins/omnimemory-memory/README.zh.md) | [English](plugins/omnimemory-memory/README.md)
- [安装 skill](skills/omnimemory-installer/SKILL.zh.md) | [English](skills/omnimemory-installer/SKILL.md)
