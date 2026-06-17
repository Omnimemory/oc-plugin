const DEFAULT_BASE_URL = "https://cvlymnfmxqow.sealoshzh.site/api/v2";

export const COMMON_DEFAULTS = Object.freeze({
  baseUrl: DEFAULT_BASE_URL,
  sessionScope: "global",
  searchLimit: 8,
  failSilent: true,
  timeoutMs: 10_000,
  autoRecall: true,
  autoCapture: true,
  recallTopK: 5,
  recallMinScore: 0,
  minPromptChars: 2,
  captureStrategy: "last_turn",
  captureRoles: ["user"],
  writeWait: true,
  promptBlockTitle: "OmniMemory Recall",
});

function parseEnvTemplate(value, env = process.env) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = /^\$\{([A-Z0-9_]+)\}$/i.exec(trimmed);
  if (!match) {
    return trimmed;
  }
  const resolved = env[match[1]];
  return typeof resolved === "string" && resolved.trim() ? resolved.trim() : undefined;
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNumber(value, fallback, { min = undefined } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  if (typeof min === "number" && value < min) {
    return fallback;
  }
  return value;
}

function normalizeString(value, fallback = undefined) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = normalizeString(value);
  return normalized && allowed.includes(normalized) ? normalized : fallback;
}

function normalizeRoles(value) {
  if (!Array.isArray(value)) {
    return [...COMMON_DEFAULTS.captureRoles];
  }
  const allowed = new Set(["user", "assistant", "tool", "system"]);
  const roles = value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => allowed.has(entry));
  return roles.length > 0 ? roles : [...COMMON_DEFAULTS.captureRoles];
}

export function resolveOmniCommonConfig(rawConfig = {}, env = process.env) {
  const apiKey = parseEnvTemplate(rawConfig.apiKey, env);
  const baseUrl = normalizeString(rawConfig.baseUrl, COMMON_DEFAULTS.baseUrl)?.replace(/\/+$/, "");
  return {
    apiKey,
    baseUrl,
    deviceNo: parseEnvTemplate(rawConfig.deviceNo, env),
    groupId: parseEnvTemplate(rawConfig.groupId, env),
    sessionId: parseEnvTemplate(rawConfig.sessionId, env),
    sessionScope: normalizeEnum(rawConfig.sessionScope, ["global", "session"], COMMON_DEFAULTS.sessionScope),
    searchLimit: Math.floor(normalizeNumber(rawConfig.searchLimit, COMMON_DEFAULTS.searchLimit, { min: 1 })),
    failSilent: normalizeBoolean(rawConfig.failSilent, COMMON_DEFAULTS.failSilent),
    timeoutMs: Math.floor(normalizeNumber(rawConfig.timeoutMs, COMMON_DEFAULTS.timeoutMs, { min: 1 })),
    autoRecall: normalizeBoolean(rawConfig.autoRecall, COMMON_DEFAULTS.autoRecall),
    autoCapture: normalizeBoolean(rawConfig.autoCapture, COMMON_DEFAULTS.autoCapture),
    recallTopK: Math.floor(normalizeNumber(rawConfig.recallTopK, COMMON_DEFAULTS.recallTopK, { min: 1 })),
    recallMinScore: normalizeNumber(rawConfig.recallMinScore, COMMON_DEFAULTS.recallMinScore),
    minPromptChars: Math.floor(normalizeNumber(rawConfig.minPromptChars, COMMON_DEFAULTS.minPromptChars, { min: 0 })),
    captureStrategy: normalizeEnum(
      rawConfig.captureStrategy,
      ["last_turn", "full_session"],
      COMMON_DEFAULTS.captureStrategy,
    ),
    captureRoles: normalizeRoles(rawConfig.captureRoles),
    writeWait: normalizeBoolean(rawConfig.writeWait, COMMON_DEFAULTS.writeWait),
    promptBlockTitle: normalizeString(rawConfig.promptBlockTitle, COMMON_DEFAULTS.promptBlockTitle),
  };
}

export function requireApiKey(config) {
  if (!config.apiKey) {
    throw new Error("omnimemory apiKey is required");
  }
  return config.apiKey;
}

export function resolveSessionId(config, ctx = {}) {
  return normalizeString(config.sessionId) || normalizeString(ctx.sessionId) || normalizeString(ctx.sessionKey);
}

export function resolveGroupId(config, ctx = {}) {
  const configuredGroupId = normalizeString(config.groupId);
  if (configuredGroupId) {
    return configuredGroupId;
  }
  if (config.sessionScope === "session") {
    return normalizeString(ctx.groupId) || resolveSessionId(config, ctx);
  }
  return undefined;
}

export function buildClientMeta(config, extra = undefined) {
  const meta = {
    ...(extra && typeof extra === "object" ? extra : {}),
    ...(config.deviceNo ? { device_no: config.deviceNo } : {}),
  };
  return Object.keys(meta).length ? meta : undefined;
}
