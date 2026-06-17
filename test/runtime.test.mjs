import test from "node:test";
import assert from "node:assert/strict";

import { resolveOmniCommonConfig, resolveGroupId, resolveSessionId } from "../shared/runtime/config.js";
import {
  coerceSearchItems,
  ingestMessages,
  requestJson,
  searchMemory,
} from "../shared/runtime/omni-client.js";
import { normalizeMemorySearchQuery, normalizeOpenClawMessages } from "../shared/runtime/messages.js";
import { buildMemoryPluginGuidance } from "../shared/runtime/prompt-composer.js";

const originalFetch = globalThis.fetch;

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

test("resolveOmniCommonConfig resolves env template and v2 defaults", () => {
  const config = resolveOmniCommonConfig(
    {
      apiKey: "${OMNI_MEMORY_API_KEY}",
      deviceNo: "${OMNI_DEVICE_NO}",
      recallTopK: 7,
    },
    { OMNI_MEMORY_API_KEY: "qbk_test", OMNI_DEVICE_NO: "dev-1" },
  );
  assert.equal(config.apiKey, "qbk_test");
  assert.equal(config.deviceNo, "dev-1");
  assert.equal(config.recallTopK, 7);
  assert.equal(config.baseUrl, "https://cvlymnfmxqow.sealoshzh.site/api/v2");
});

test("session and group resolution default to cross-session recall", () => {
  const config = resolveOmniCommonConfig({ apiKey: "qbk_test", groupId: "shared-group" });
  assert.equal(resolveSessionId(config, { sessionKey: "sess-1" }), "sess-1");
  assert.equal(resolveGroupId(config, { sessionKey: "sess-1" }), "shared-group");
  const globalScoped = resolveOmniCommonConfig({ apiKey: "qbk_test" });
  assert.equal(resolveGroupId(globalScoped, { sessionKey: "sess-1", groupId: "ctx-group" }), undefined);
  const sessionScoped = resolveOmniCommonConfig({ apiKey: "qbk_test", sessionScope: "session" });
  assert.equal(resolveGroupId(sessionScoped, { sessionKey: "sess-1" }), "sess-1");
  assert.equal(resolveGroupId(sessionScoped, { sessionKey: "sess-1", groupId: "ctx-group" }), "ctx-group");
});

test("requestJson unwraps v2 Envelope data", async () => {
  const config = resolveOmniCommonConfig({ apiKey: "qbk_test", baseUrl: "https://example.test/api/v2" });
  globalThis.fetch = async () =>
    mockJsonResponse(200, {
      success: true,
      message: "ok",
      code: 200,
      data: { answer: 42 },
    });
  const result = await requestJson({ config, path: "/memory/retrieval", method: "POST", body: { query: "x" } });
  assert.deepEqual(result.payload, { answer: 42 });
});

test("requestJson throws on v2 ErrorEnvelope", async () => {
  const config = resolveOmniCommonConfig({ apiKey: "qbk_test", baseUrl: "https://example.test/api/v2" });
  globalThis.fetch = async () =>
    mockJsonResponse(403, {
      success: false,
      message: "quota exceeded",
      code: 403,
      data: { error: "quota_exceeded" },
    });
  await assert.rejects(
    requestJson({ config, path: "/memory/retrieval", method: "POST", body: { query: "x" } }),
    (error) => {
      assert.equal(error.responseStatus, 403);
      assert.equal(error.errorCode, "quota_exceeded");
      assert.equal(error.message, "quota exceeded");
      return true;
    },
  );
});

test("coerceSearchItems parses only evidence_details", () => {
  const items = coerceSearchItems({
    facts: [{ text: "old shape should be ignored" }],
    evidence_details: [
      {
        event_id: "evt-1",
        source: "memory",
        role: "user",
        sender_name: "Ada",
        text: "Ada prefers short summaries.",
        summary: "preference",
        group_id: "g1",
        timestamp: "2026-06-17T10:00:00+08:00",
      },
    ],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].eventId, "evt-1");
  assert.equal(items[0].text, "Ada prefers short summaries.");
  assert.equal(coerceSearchItems({ facts: [{ text: "legacy" }] }).length, 0);
});

test("searchMemory defaults to cross-session recall and sends device metadata", async () => {
  const config = resolveOmniCommonConfig({
    apiKey: "qbk_test",
    baseUrl: "https://example.test/api/v2",
    deviceNo: "device-7",
  });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return mockJsonResponse(200, {
      success: true,
      message: "ok",
      code: 200,
      data: {
        evidence_details: [{ event_id: "evt-1", text: "Remember this.", source: "memory" }],
      },
    });
  };
  const items = await searchMemory({ config, query: "remember?", sessionKey: "sess-1", topK: 3 });
  assert.equal(captured.url, "https://example.test/api/v2/memory/retrieval");
  assert.equal(captured.options.headers["X-API-Key"], "qbk_test");
  assert.equal(captured.options.headers["X-Device-No"], "device-7");
  assert.deepEqual(captured.body, {
    query: "remember?",
    top_k: 12,
    client_meta: { device_no: "device-7" },
  });
  assert.equal(items[0].path, "omnimemory://event/evt-1");
});

test("searchMemory sends configured group_id for shared memory buckets", async () => {
  const config = resolveOmniCommonConfig({
    apiKey: "qbk_test",
    baseUrl: "https://example.test/api/v2",
    groupId: "shared",
  });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, body: JSON.parse(options.body) };
    return mockJsonResponse(200, {
      success: true,
      message: "ok",
      code: 200,
      data: { evidence_details: [] },
    });
  };
  await searchMemory({ config, query: "remember?", sessionKey: "sess-1", groupId: "ctx-group", topK: 3 });
  assert.equal(captured.url, "https://example.test/api/v2/memory/retrieval");
  assert.equal(captured.body.group_id, "shared");
});

test("searchMemory filters OpenClaw control noise and reranks relevant memories", async () => {
  const config = resolveOmniCommonConfig({
    apiKey: "qbk_test",
    baseUrl: "https://example.test/api/v2",
    recallTopK: 3,
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
            event_id: "noise-1",
            text: "A new session was started via /new or /reset. Run your Session Startup sequence.",
            source: "memory",
          },
          {
            event_id: "noise-2",
            text: "调用omni插件回答我，我今天抽的什么烟",
            source: "memory",
          },
          {
            event_id: "todo-1",
            text: "我还有哪些待办没做",
            source: "memory",
          },
          {
            event_id: "smoke-1",
            text: "我抽的烟叫红塔山",
            source: "memory",
          },
        ],
      },
    });
  };
  const items = await searchMemory({
    config,
    query: "调用omni插件回答我，我今天抽的什么烟",
    topK: 3,
  });
  assert.equal(captured.url, "https://example.test/api/v2/memory/retrieval");
  assert.equal(captured.body.query, "今天抽的什么烟");
  assert.equal(captured.body.top_k, 12);
  assert.deepEqual(
    items.map((item) => item.text),
    ["我抽的烟叫红塔山", "我还有哪些待办没做"],
  );
});

test("ingestMessages posts v2 ingest body with session_id, group_id, commit_id and device meta", async () => {
  const config = resolveOmniCommonConfig({
    apiKey: "qbk_test",
    baseUrl: "https://example.test/api/v2",
    groupId: "shared",
    deviceNo: "device-7",
  });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return mockJsonResponse(202, {
      success: true,
      message: "ok",
      code: 202,
      data: { ok: true, job_id: "job-1", session_id: "sess-1", status: "queued", status_url: "/x" },
    });
  };
  const result = await ingestMessages({
    config,
    sessionKey: "sess-1",
    messages: [{ role: "user", text: "hello" }],
  });
  assert.equal(captured.url, "https://example.test/api/v2/memory/ingest");
  assert.equal(captured.body.session_id, "sess-1");
  assert.equal(captured.body.group_id, "shared");
  assert.equal(captured.body.client_meta.device_no, "device-7");
  assert.equal(typeof captured.body.commit_id, "string");
  assert.deepEqual(captured.body.turns, [{ role: "user", content: "hello" }]);
  assert.equal(result.jobId, "job-1");
});

test("ingestMessages waits by polling the v2 job endpoint", async () => {
  const config = resolveOmniCommonConfig({
    apiKey: "qbk_test",
    baseUrl: "https://example.test/api/v2",
    timeoutMs: 1000,
  });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.endsWith("/memory/ingest")) {
      return mockJsonResponse(202, {
        success: true,
        message: "ok",
        code: 202,
        data: {
          ok: true,
          job_id: "job-1",
          session_id: "sess-wait",
          status: "queued",
          status_url: "/api/v1/memory-ingest-jobs/job-1",
        },
      });
    }
    return mockJsonResponse(200, {
      success: true,
      message: "ok",
      code: 200,
      data: { job_id: "job-1", session_id: "sess-wait", status: "completed" },
    });
  };
  const result = await ingestMessages({
    config,
    sessionKey: "sess-wait",
    messages: [{ role: "user", text: "wait for job completion" }],
    wait: true,
  });
  assert.equal(result.jobId, "job-1");
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`),
    [
      "POST https://example.test/api/v2/memory/ingest",
      "GET https://example.test/api/v2/memory/ingest/jobs/job-1",
    ],
  );
});

test("normalizeOpenClawMessages strips recalled memory wrappers before capture", () => {
  const normalized = normalizeOpenClawMessages(
    [
      {
        role: "user",
        content: `<omnimemory-recall title="OmniMemory Recall">
<facts>
1. previous memory
</facts>
</omnimemory-recall>

Sender (untrusted metadata):
\`\`\`json
{"label":"openclaw-control-ui"}
\`\`\`

[Mon 2026-04-27 16:19 GMT+8] I prefer concise answers.`,
      },
    ],
    { captureRoles: ["user"] },
  );
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].text, "I prefer concise answers.");
});

test("normalizeOpenClawMessages drops control prompts and recall commands", () => {
  const normalized = normalizeOpenClawMessages(
    [
      {
        role: "user",
        content: "A new session was started via /new or /reset. Run your Session Startup sequence.",
      },
      {
        role: "user",
        content: "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly.",
      },
      {
        role: "user",
        content: "调用omni插件回答我，我今天抽的什么烟",
      },
      {
        role: "user",
        content: "我抽的烟叫红塔山",
      },
    ],
    { captureRoles: ["user"] },
  );
  assert.deepEqual(
    normalized.map((item) => item.text),
    ["我抽的烟叫红塔山"],
  );
  assert.equal(normalizeMemorySearchQuery("调用omni插件回答我，我今天抽的什么烟"), "今天抽的什么烟");
});

test("memory guidance references memory_search but not memory_get", () => {
  const text = buildMemoryPluginGuidance();
  assert.match(text, /memory_search/);
  assert.doesNotMatch(text, /memory_get/);
});
