import { buildClientMeta, requireApiKey, resolveGroupId, resolveSessionId } from "./config.js";
import {
  fingerprintMessages,
  isLowValueMemoryText,
  normalizeMemorySearchQuery,
  scoreMemoryTextRelevance,
} from "./messages.js";
import { readPersistentState, writePersistentState } from "./persistent-state.js";

const sessionWriteState = new Map();

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clampTopK(value, fallback) {
  const n = Math.floor(typeof value === "number" && Number.isFinite(value) ? value : fallback);
  return Math.min(20, Math.max(1, n));
}

function clampFetchTopK(value, fallback) {
  const requestedTopK = clampTopK(value, fallback);
  return Math.min(20, Math.max(requestedTopK, requestedTopK * 4));
}

function parseJsonMaybe(text) {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function envelopeMessage(json, fallback) {
  if (json && typeof json === "object") {
    return normalizeString(json.message) || normalizeString(json?.data?.error) || fallback;
  }
  return fallback;
}

export async function requestJson({ config, path, method = "GET", body }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": requireApiKey(config),
    ...(config.deviceNo ? { "X-Device-No": config.deviceNo } : {}),
  };
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const rawText = await response.text();
    const json = parseJsonMaybe(rawText);
    const payload =
      json && typeof json === "object" && Object.hasOwn(json, "data") ? json.data : json;
    const envelopeFailed = json && typeof json === "object" && json.success === false;
    if (!response.ok || envelopeFailed) {
      const error = new Error(envelopeMessage(json, `${method} ${path} failed`));
      error.status = response.status;
      error.responseStatus = response.status;
      error.code = json && typeof json === "object" ? json.code : undefined;
      error.errorCode = json && typeof json === "object" ? json?.data?.error : undefined;
      error.payload = payload;
      throw error;
    }
    return { status: response.status, payload, envelope: json };
  } finally {
    clearTimeout(timeout);
  }
}

function logStatus(logger, message) {
  if (typeof logger?.info === "function") {
    logger.info(`[omnimemory] ${message}`);
  }
}

function logFailure(logger, message) {
  if (typeof logger?.warn === "function") {
    logger.warn(`[omnimemory] ${message}`);
  } else if (typeof logger?.info === "function") {
    logger.info(`[omnimemory] ${message}`);
  }
}

function truncateForLog(value, maxLength = 160) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) {
    return "";
  }
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function describeOptional(value) {
  return normalizeString(value) || "none";
}

function describeSet(value) {
  return normalizeString(value) ? "set" : "none";
}

function describeScore(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "n/a";
}

function describeSearchItem(item, index, { includeContent = false } = {}) {
  const parts = [
    `#${index + 1}`,
    `score=${describeScore(item.score)}`,
    `rel=${describeScore(item.relevanceScore)}`,
    `source=${describeOptional(item.source)}`,
    `role=${describeOptional(item.role)}`,
    `group=${describeOptional(item.groupId)}`,
    `event=${describeOptional(item.eventId)}`,
    `time=${describeOptional(item.timestamp)}`,
    `chars=${typeof item.text === "string" ? item.text.length : 0}`,
  ];
  if (includeContent) {
    parts.push(`text="${truncateForLog(item.text)}"`);
  }
  return parts.join(" ");
}

export function coerceSearchItems(payload) {
  const rawItems = Array.isArray(payload?.evidence_details) ? payload.evidence_details : [];
  return rawItems
    .map((raw, index) => {
      const text = normalizeString(raw?.text);
      if (!text) {
        return null;
      }
      return {
        text,
        summary: normalizeString(raw?.summary),
        score: typeof raw?.score === "number" ? raw.score : 1,
        timestamp: normalizeString(raw?.timestamp),
        source: normalizeString(raw?.source) || "memory",
        role: normalizeString(raw?.role),
        senderName: normalizeString(raw?.sender_name),
        eventId: normalizeString(raw?.event_id) || normalizeString(raw?.eventId),
        groupId: normalizeString(raw?.group_id) || normalizeString(raw?.groupId),
        index,
      };
    })
    .filter(Boolean);
}

function buildSearchPath(item, index) {
  if (item.eventId) {
    return `omnimemory://event/${encodeURIComponent(item.eventId)}`;
  }
  return `omnimemory://result/${index + 1}`;
}

export async function searchMemory({ config, query, sessionKey, sessionId, groupId, topK, minScore = 0, logger }) {
  const requestedTopK = clampTopK(topK, config.searchLimit);
  const trimmedQuery = normalizeMemorySearchQuery(query);
  if (!trimmedQuery) {
    logStatus(logger, `recall skipped (empty query, original="${truncateForLog(query)}")`);
    return [];
  }
  const resolvedGroupId = resolveGroupId(config, { sessionKey, sessionId, groupId });
  const resolvedSessionId = resolveSessionId(config, { sessionKey, sessionId });
  const clientMeta = buildClientMeta(config);
  const fetchTopK = clampFetchTopK(topK, config.searchLimit);
  const body = {
    query: trimmedQuery,
    top_k: fetchTopK,
    ...(resolvedGroupId ? { group_id: resolvedGroupId } : {}),
    ...(clientMeta ? { client_meta: clientMeta } : {}),
  };
  logStatus(
    logger,
    [
      "recall request -> POST /memory/retrieval",
      `query_chars=${trimmedQuery.length}`,
      `original_chars=${typeof query === "string" ? query.length : 0}`,
      `requested_top_k=${requestedTopK}`,
      `fetch_top_k=${fetchTopK}`,
      `min_score=${describeScore(minScore)}`,
      `session_id=${describeOptional(resolvedSessionId)}`,
      `group_id=${describeOptional(resolvedGroupId)}`,
      `device_no=${describeSet(config.deviceNo)}`,
    ].join(" "),
  );
  if (config.debugLogContent) {
    logStatus(
      logger,
      `recall request content query="${truncateForLog(trimmedQuery, 120)}" original="${truncateForLog(query, 120)}"`,
    );
  }
  try {
    const result = await requestJson({
      config,
      path: "/memory/retrieval",
      method: "POST",
      body,
    });
    const rawItems = coerceSearchItems(result.payload);
    let droppedByScore = 0;
    let droppedLowValue = 0;
    const candidates = [];
    for (const item of rawItems) {
      if (item.score < minScore) {
        droppedByScore += 1;
        continue;
      }
      if (isLowValueMemoryText(item.text)) {
        droppedLowValue += 1;
        continue;
      }
      candidates.push(item);
    }
    const items = candidates
      .map((item, originalIndex) => ({
        ...item,
        originalIndex,
        relevanceScore: scoreMemoryTextRelevance(trimmedQuery, item.text),
      }))
      .sort((left, right) => {
        if (right.relevanceScore !== left.relevanceScore) {
          return right.relevanceScore - left.relevanceScore;
        }
        return left.originalIndex - right.originalIndex;
      })
      .slice(0, requestedTopK)
      .map((item, index) => ({ ...item, path: buildSearchPath(item, index) }));
    logStatus(
      logger,
      [
        `recall response <- status=${result.status}`,
        `raw_items=${rawItems.length}`,
        `candidates=${candidates.length}`,
        `returned=${items.length}`,
        `dropped_low_value=${droppedLowValue}`,
        `dropped_score=${droppedByScore}`,
      ].join(" "),
    );
    for (const [index, item] of items.entries()) {
      logStatus(logger, `recall item ${describeSearchItem(item, index, { includeContent: config.debugLogContent })}`);
    }
    return items;
  } catch (error) {
    logFailure(
      logger,
      `recall failed <- status=${error?.responseStatus || "n/a"} message="${truncateForLog(error?.message)}"`,
    );
    throw error;
  }
}

async function waitForJob({ config, jobId, timeoutMs, logger }) {
  const deadline = Date.now() + timeoutMs;
  const pollPath = `/memory/ingest/jobs/${encodeURIComponent(jobId)}`;
  let pollDelayMs = 500;
  while (true) {
    logStatus(logger, `ingest job poll -> job_id=${jobId} path=${pollPath}`);
    const { payload } = await requestJson({
      config,
      path: pollPath,
      method: "GET",
    });
    const status = (normalizeString(payload?.status) || "").toLowerCase();
    logStatus(logger, `ingest job status <- job_id=${jobId} status=${status || "unknown"}`);
    if (["completed", "done", "succeeded", "success"].includes(status)) {
      return payload;
    }
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      throw new Error(`OmniMemory ingest job failed: ${JSON.stringify(payload?.last_error || payload)}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`OmniMemory ingest wait timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollDelayMs, Math.max(0, deadline - Date.now()))));
    pollDelayMs = Math.min(5_000, Math.floor(pollDelayMs * 1.6));
  }
}

export async function ingestMessages({ config, sessionKey, sessionId, groupId, messages, statePath, wait = false, logger }) {
  const resolvedSessionId = resolveSessionId(config, { sessionKey, sessionId });
  const resolvedGroupId = resolveGroupId(config, { sessionKey, sessionId, groupId });
  const turns = Array.isArray(messages) ? messages : [];
  logStatus(
    logger,
    [
      "ingest prepare",
      `input_turns=${turns.length}`,
      `session_id=${describeOptional(resolvedSessionId)}`,
      `group_id=${describeOptional(resolvedGroupId)}`,
      `state_path=${statePath ? "set" : "none"}`,
      `wait=${wait ? "true" : "false"}`,
    ].join(" "),
  );
  if (!turns.length) {
    logStatus(logger, "ingest skipped (no turns)");
    return { skipped: true, reason: "no turns" };
  }
  const payloadTurns = turns
    .map((turn) => ({
      role: ["user", "assistant", "system"].includes(turn.role) ? turn.role : "user",
      content: normalizeString(turn.text),
      ...(turn.timestampIso ? { timestamp: turn.timestampIso } : {}),
      ...(turn.name ? { sender_name: turn.name } : {}),
    }))
    .filter((turn) => turn.content);
  if (!payloadTurns.length) {
    logStatus(logger, "ingest skipped (no non-empty turns after normalization)");
    return { skipped: true, reason: "no non-empty turns" };
  }

  const fingerprint = fingerprintMessages(payloadTurns);
  const shortCommit = fingerprint.slice(0, 12);
  logStatus(
    logger,
    [
      "ingest payload",
      `turns=${payloadTurns.length}`,
      `roles=${payloadTurns.map((turn) => turn.role).join(",")}`,
      `commit=${shortCommit}`,
      `device_no=${describeSet(config.deviceNo)}`,
    ].join(" "),
  );
  for (const [index, turn] of payloadTurns.entries()) {
    const baseMessage = `ingest turn #${index + 1} role=${turn.role} chars=${turn.content.length}`;
    logStatus(
      logger,
      config.debugLogContent ? `${baseMessage} text="${truncateForLog(turn.content)}"` : baseMessage,
    );
  }
  const stateKey = resolvedSessionId || resolvedGroupId || "global";
  const lastState = sessionWriteState.get(stateKey);
  const persistedState = await readPersistentState(statePath);
  const previousFingerprint = lastState?.fingerprint || persistedState?.fingerprint;
  if (previousFingerprint === fingerprint) {
    logStatus(logger, `ingest skipped (duplicate, turns=${payloadTurns.length}, commit=${shortCommit})`);
    return { skipped: true, reason: "duplicate" };
  }

  const clientMeta = buildClientMeta(config);
  const body = {
    turns: payloadTurns,
    commit_id: fingerprint,
    ...(resolvedSessionId ? { session_id: resolvedSessionId } : {}),
    ...(resolvedGroupId ? { group_id: resolvedGroupId } : {}),
    ...(clientMeta ? { client_meta: clientMeta } : {}),
  };

  logStatus(
    logger,
    [
      "ingest request -> POST /memory/ingest",
      `turns=${payloadTurns.length}`,
      `commit=${shortCommit}`,
      `session_id=${describeOptional(resolvedSessionId)}`,
      `group_id=${describeOptional(resolvedGroupId)}`,
    ].join(" "),
  );
  let result;
  try {
    result = await requestJson({
      config,
      path: "/memory/ingest",
      method: "POST",
      body,
    });
  } catch (error) {
    logFailure(
      logger,
      `ingest failed <- status=${error?.responseStatus || "n/a"} message="${truncateForLog(error?.message)}"`,
    );
    throw error;
  }
  const jobId = normalizeString(result.payload?.job_id);
  const statusUrl = normalizeString(result.payload?.status_url);
  logStatus(
    logger,
    [
      `ingest response <- status=${result.status}`,
      `accepted=${result.status === 202}`,
      `job_id=${describeOptional(jobId)}`,
      `returned_session_id=${describeOptional(result.payload?.session_id)}`,
      `backend_status=${describeOptional(result.payload?.status)}`,
      `backend_status_url_ignored=${describeOptional(statusUrl)}`,
    ].join(" "),
  );
  if (statusUrl && /\/api\/v1\//i.test(statusUrl)) {
    logFailure(
      logger,
      `ingest response included legacy status_url="${truncateForLog(statusUrl)}" (ignored; polling v2 /memory/ingest/jobs/{job_id})`,
    );
  }

  const nextState = {
    fingerprint,
    count: payloadTurns.length,
    sessionId: resolvedSessionId,
    groupId: resolvedGroupId,
    updatedAt: new Date().toISOString(),
  };
  sessionWriteState.set(stateKey, nextState);
  await writePersistentState(statePath, nextState);
  if (wait && jobId) {
    await waitForJob({ config, jobId, timeoutMs: config.writeWaitTimeoutMs, logger });
  } else if (wait && !jobId) {
    logStatus(logger, "ingest wait skipped (no job_id returned)");
  }
  return {
    skipped: false,
    sessionId: resolvedSessionId,
    groupId: resolvedGroupId,
    committedTurns: payloadTurns.length,
    jobId,
  };
}
