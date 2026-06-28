import { normalizeOpenClawMessages, selectMessagesForCapture } from "./messages.js";
import { buildMemoryPluginGuidance, buildRecallPromptBlock } from "./prompt-composer.js";
import { ingestMessages, searchMemory } from "./omni-client.js";
import { jsonResult } from "./result.js";
import { readOpenClawSessionMessages } from "./session-transcript.js";
import { buildPersistentStatePath } from "./persistent-state.js";

export async function buildRecallContext({ config, event, ctx, logger, mode = "plugin" }) {
  if (!config.autoRecall) {
    logger?.info?.(`[omnimemory] ${mode} recall skipped (autoRecall disabled)`);
    return undefined;
  }
  const prompt = typeof event?.prompt === "string" ? event.prompt.trim() : "";
  if (!prompt || prompt.length < config.minPromptChars) {
    logger?.info?.(
      `[omnimemory] ${mode} recall skipped (prompt chars=${prompt.length}, min=${config.minPromptChars})`,
    );
    return {
      prependSystemContext: "OmniMemory is active for external long-term memory recall.",
    };
  }
  logger?.info?.(`[omnimemory] ${mode} recall hook prompt_chars=${prompt.length}`);
  try {
    const items = await searchMemory({
      config,
      query: prompt,
      sessionKey: ctx?.sessionKey,
      sessionId: ctx?.sessionId,
      groupId: ctx?.groupId,
      topK: config.recallTopK,
      minScore: config.recallMinScore,
      logger,
    });
    const promptBlock = buildRecallPromptBlock({
      title: config.promptBlockTitle,
      items,
    });
    logger?.info?.(
      `[omnimemory] ${mode} recall injected items=${items.length} block_chars=${promptBlock?.length || 0}`,
    );
    return {
      prependSystemContext: [
        "OmniMemory is active for external long-term memory recall.",
        promptBlock || "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  } catch (error) {
    logger?.warn?.(`omnimemory ${mode} recall failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      prependSystemContext: "OmniMemory is active for external long-term memory recall.",
    };
  }
}

async function resolveCapturableMessages({ config, event }) {
  const inlineMessages = normalizeOpenClawMessages(event?.messages, {
    captureRoles: config.captureRoles,
  });
  if (inlineMessages.length > 0) {
    return inlineMessages;
  }
  if (typeof event?.sessionFile === "string" && event.sessionFile.trim()) {
    const transcriptMessages = await readOpenClawSessionMessages(event.sessionFile);
    return normalizeOpenClawMessages(transcriptMessages, {
      captureRoles: config.captureRoles,
    });
  }
  return [];
}

export async function captureConversation({ config, event, ctx, logger, wait }) {
  if (!config.autoCapture) {
    logger?.info?.("[omnimemory] capture skipped (autoCapture disabled)");
    return { skipped: true, reason: "autoCapture disabled" };
  }
  const normalized = await resolveCapturableMessages({ config, event });
  const selected = selectMessagesForCapture(normalized, config.captureStrategy);
  logger?.info?.(
    `[omnimemory] capture hook normalized=${normalized.length} selected=${selected.length} strategy=${config.captureStrategy}`,
  );
  if (!selected.length) {
    return { skipped: true, reason: "no capturable messages" };
  }
  try {
    return await ingestMessages({
      config,
      sessionKey: ctx?.sessionKey,
      sessionId: ctx?.sessionId,
      groupId: ctx?.groupId,
      messages: selected,
      statePath: buildPersistentStatePath({
        workspaceDir: ctx?.workspaceDir,
        sessionFile: event?.sessionFile,
        sessionKey: ctx?.sessionKey,
        sessionId: ctx?.sessionId,
      }),
      wait,
      logger,
    });
  } catch (error) {
    logger?.warn?.(`omnimemory capture failed: ${error instanceof Error ? error.message : String(error)}`);
    return { skipped: true, reason: "ingest failed" };
  }
}

export function createMemorySearchTool({ config, sessionKey, sessionId, groupId, logger }) {
  return {
    name: "memory_search",
    label: "Memory Search",
    description:
      "Search long-term memory from OmniMemory for prior work, decisions, dates, people, preferences, or todos.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "number" },
        minScore: { type: "number" },
      },
      required: ["query"],
    },
    async execute(_id, params) {
      try {
        const items = await searchMemory({
          config,
          query: params?.query,
          sessionKey,
          sessionId,
          groupId,
          topK: params?.maxResults,
          minScore: params?.minScore,
          logger,
        });
        const results = items.map((item) => ({
          path: item.path,
          startLine: 1,
          endLine: 1,
          score: item.score,
          snippet: item.text,
          source: item.source || "omnimemory",
          metadata: {
            eventId: item.eventId,
            groupId: item.groupId,
            role: item.role,
            senderName: item.senderName,
            timestamp: item.timestamp,
            summary: item.summary,
          },
        }));
        return jsonResult({ results, provider: "omnimemory" });
      } catch (error) {
        if (config.failSilent) {
          return jsonResult({
            results: [],
            provider: "omnimemory",
            disabled: true,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    },
  };
}

export async function buildMemoryModePromptHookResult({ config, event, ctx, logger, mode = "plugin" } = {}) {
  const recallContext = await buildRecallContext({ config, event, ctx, logger, mode });
  return {
    ...recallContext,
    appendSystemContext: buildMemoryPluginGuidance(),
  };
}
