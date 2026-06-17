import { createHash } from "node:crypto";

const CONTROL_PATTERNS = [
  /^a new session was started via \/new or \/reset\b/i,
  /\brun your session startup sequence\b/i,
  /^read heartbeat\.md\b/i,
  /\bheartbeat\.md\b/i,
  /^current time:/i,
  /^heartbeat_ok$/i,
  /<omnimemory-recall\b/i,
];

const RECALL_COMMAND_PREFIXES = [
  /^\s*(调用|使用|用)\s*omni(?:memory)?\s*插件\s*(来)?\s*(帮我)?\s*(回答|查询|搜索|召回|查)?\s*(我)?[，,：:\s]*/i,
  /^\s*(请)?\s*(调用|使用|用)\s*omni(?:memory)?\s*(来)?\s*(帮我)?\s*(回答|查询|搜索|召回|查)?\s*(我)?[，,：:\s]*/i,
];

function normalizeWhitespace(text) {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

export function normalizeMemorySearchQuery(query) {
  let normalized = normalizeWhitespace(query);
  for (const pattern of RECALL_COMMAND_PREFIXES) {
    normalized = normalized.replace(pattern, "").trim();
  }
  normalized = normalized.replace(/^\s*我(?=今|昨|明|的|有|要|想|喜欢|讨厌|抽|喝|吃|买|用|穿|拿|带|叫|是)/, "").trim();
  return normalized || normalizeWhitespace(query);
}

export function isLowValueMemoryText(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return true;
  }
  return (
    CONTROL_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    RECALL_COMMAND_PREFIXES.some((pattern) => pattern.test(normalized))
  );
}

function tokenizeForRelevance(text) {
  const normalized = normalizeWhitespace(text).toLowerCase();
  const terms = new Set();
  for (const match of normalized.matchAll(/[a-z0-9_]{2,}/gi)) {
    terms.add(match[0]);
  }
  for (const match of normalized.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const run = match[0];
    for (let size = 2; size <= 3; size += 1) {
      for (let index = 0; index <= run.length - size; index += 1) {
        terms.add(run.slice(index, index + size));
      }
    }
  }
  return terms;
}

export function scoreMemoryTextRelevance(query, text) {
  const queryTerms = tokenizeForRelevance(normalizeMemorySearchQuery(query));
  const textTerms = tokenizeForRelevance(text);
  let score = 0;
  for (const term of queryTerms) {
    if (textTerms.has(term)) {
      score += term.length >= 3 ? 2 : 1;
    }
  }
  return score;
}

function normalizeRole(value) {
  if (typeof value !== "string") {
    return null;
  }
  const role = value.trim().toLowerCase();
  return ["user", "assistant", "tool", "system"].includes(role) ? role : null;
}

function extractText(content) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && typeof block === "object")
      .map((block) => {
        if (block.type === "text" && typeof block.text === "string") {
          return block.text.trim();
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

export function sanitizeCapturedText(text) {
  if (typeof text !== "string" || !text.trim()) {
    return "";
  }
  return text
    .replace(/<omnimemory-recall\b[\s\S]*?<\/omnimemory-recall>\s*/gi, "")
    .replace(/Sender \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, "")
    .replace(/^Sender \(untrusted metadata\):[^\n]*(?:\n|$)/gim, "")
    .replace(/^\[[A-Za-z]{3}\s+\d{4}-\d{2}-\d{2}[^\]]*]\s*/gm, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeOpenClawMessages(messages, options = {}) {
  const allowedRoles = new Set(options.captureRoles || ["user", "assistant"]);
  const normalized = [];
  for (const raw of Array.isArray(messages) ? messages : []) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const role = normalizeRole(raw.role);
    if (!role || !allowedRoles.has(role)) {
      continue;
    }
    const text = sanitizeCapturedText(extractText(raw.content));
    if (!text || isLowValueMemoryText(text)) {
      continue;
    }
    normalized.push({
      role,
      text,
      name: typeof raw.name === "string" ? raw.name.trim() || undefined : undefined,
      timestampIso:
        typeof raw.timestamp === "string"
          ? raw.timestamp
          : typeof raw.timestampIso === "string"
            ? raw.timestampIso
            : undefined,
    });
  }
  return normalized;
}

export function selectMessagesForCapture(messages, strategy = "last_turn") {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }
  if (strategy === "full_session") {
    return [...messages];
  }
  const lastUserIndex = [...messages].map((msg) => msg.role).lastIndexOf("user");
  if (lastUserIndex === -1) {
    return messages.slice(-2);
  }
  const selected = [messages[lastUserIndex]];
  for (let index = lastUserIndex + 1; index < messages.length; index += 1) {
    const msg = messages[index];
    if (msg.role === "user") {
      break;
    }
    selected.push(msg);
  }
  return selected;
}

export function fingerprintMessages(messages) {
  return createHash("sha1").update(JSON.stringify(messages)).digest("hex");
}
