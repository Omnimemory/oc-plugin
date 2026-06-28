import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import memoryPlugin from "../plugins/omnimemory-memory/index.js";

const originalFetch = globalThis.fetch;

function createMockApi(pluginConfig = {}) {
  const state = {
    hooks: [],
    tools: [],
    services: [],
  };
  return {
    state,
    pluginConfig,
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    on(name, handler) {
      state.hooks.push({ name, handler });
    },
    registerTool(tool, opts) {
      state.tools.push({ tool, opts });
    },
    registerService(service) {
      state.services.push(service);
    },
  };
}

function mockJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("memory plugin registers memory_search only", () => {
  const api = createMockApi({ apiKey: "qbk_test" });
  memoryPlugin.register(api);
  assert.equal(api.state.tools.length, 1);
  assert.deepEqual(api.state.tools[0].opts.names, ["memory_search"]);
  assert.deepEqual(
    api.state.hooks.map((entry) => entry.name),
    ["before_prompt_build", "agent_end", "before_compaction", "before_reset"],
  );

  const factory = api.state.tools[0].tool;
  const tools = factory({ sessionKey: "agent:main:test", sessionId: "sid" });
  assert.equal(Array.isArray(tools), true);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "memory_search");
});

test("memory plugin auto recalls before prompt build", async () => {
  const api = createMockApi({
    apiKey: "qbk_test",
    baseUrl: "https://example.test/api/v2",
  });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, body: JSON.parse(options.body) };
    return mockJsonResponse(200, {
      success: true,
      message: "ok",
      code: 200,
      data: {
        evidence_details: [
          {
            event_id: "evt-1",
            text: "Today I got up at 08:00 and got off work at 23:00.",
            source: "memory",
          },
        ],
      },
    });
  };
  memoryPlugin.register(api);
  const recallHook = api.state.hooks.find((entry) => entry.name === "before_prompt_build");
  const result = await recallHook.handler(
    { prompt: "我今天起床和下班时间" },
    { sessionKey: "agent:main:test", sessionId: "sid" },
  );
  assert.equal(captured.url, "https://example.test/api/v2/memory/retrieval");
  assert.equal(captured.body.query, "今天起床和下班时间");
  assert.match(result.prependSystemContext, /OmniMemory is active/);
  assert.match(result.prependSystemContext, /08:00/);
  assert.match(result.prependSystemContext, /23:00/);
  assert.match(result.appendSystemContext, /memory_search/);
});

test("manifests use v2 base URL and do not mention memory_get", async () => {
  const memory = JSON.parse(await readFile(new URL("../plugins/omnimemory-memory/openclaw.plugin.json", import.meta.url), "utf8"));
  assert.equal(memory.uiHints.baseUrl.placeholder, "https://cvlymnfmxqow.sealoshzh.site/api/v2");
  assert.deepEqual(memory.contracts.tools, ["memory_search"]);
  assert.equal(JSON.stringify(memory).includes("memory_get"), false);
});

test("manifest schema declares every runtime-supported launch config", async () => {
  const memory = JSON.parse(await readFile(new URL("../plugins/omnimemory-memory/openclaw.plugin.json", import.meta.url), "utf8"));
  const properties = memory.configSchema.properties;
  for (const key of [
    "apiKey",
    "baseUrl",
    "allowInsecureBaseUrl",
    "deviceNo",
    "groupId",
    "sessionId",
    "sessionScope",
    "searchLimit",
    "failSilent",
    "timeoutMs",
    "autoRecall",
    "recallTopK",
    "recallMinScore",
    "minPromptChars",
    "autoCapture",
    "captureStrategy",
    "captureRoles",
    "writeWait",
    "writeWaitTimeoutMs",
    "debugLogContent",
    "promptBlockTitle",
  ]) {
    assert.ok(properties[key], `missing schema property: ${key}`);
  }
  assert.equal(memory.configSchema.additionalProperties, false);
});

test("installer dry-run config grants conversation access and safe defaults", () => {
  const script = new URL("../skills/omnimemory-installer/scripts/install_omnimemory.mjs", import.meta.url);
  const pluginRoot = new URL("..", import.meta.url);
  const result = spawnSync(
    process.execPath,
    [
      script.pathname,
      "--mode",
      "memory",
      "--plugin-root",
      pluginRoot.pathname,
      "--api-key-env",
      "OMNI_MEMORY_API_KEY",
      "--dry-run",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: "/tmp/omnimemory-openclaw-test-config.json",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.hooks, { allowConversationAccess: true });
  assert.equal(report.config.apiKey, "${OMNI_MEMORY_API_KEY}");
  assert.equal(report.config.autoRecall, true);
  assert.equal(report.config.autoCapture, true);
  assert.equal(report.config.writeWait, false);
  assert.equal(report.config.debugLogContent, false);
});
