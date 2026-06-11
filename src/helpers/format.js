const { v4: uuidv4 } = require("uuid");

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/** Generate a prefixed ID like `chatcmpl-abc123...` */
const newId = (prefix) => `${prefix}-${uuidv4().replace(/-/g, "")}`;

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

/**
 * Extract plain text from a qodercli message object.
 * Handles both array-of-parts and plain string content gracefully.
 */
const extractTextContent = (message) => {
  if (!message) return "";
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (!part) return "";
        if (typeof part === "string") return part;
        if (typeof part.text === "string") return part.text;
        if (typeof part.value === "string") return part.value;
        return "";
      })
      .join("");
  }
  if (typeof message.content === "string") return message.content;
  return "";
};

const { loadConfig } = require("../store/configStore");

// ---------------------------------------------------------------------------
// Model catalogue
// ---------------------------------------------------------------------------

/**
 * Get the full catalogue of qodercli models.
 * Dynamically loaded from the persistent store.
 */
const getQoderModels = () => {
  try {
    return loadConfig().models;
  } catch {
    // Fallback if store fails
    return [
      { id: "auto", label: "Auto (Smart Select)", tier: "paid" },
    ];
  }
};

/**
 * OpenAI-name → qodercli model id aliases.
 */
const ALIAS_MAP = {
  // GPT-4 class → auto tier
  "gpt-4": "auto",
  "gpt-4-turbo": "auto",
  "gpt-4o": "auto",
  o1: "ultimate",
  "o1-mini": "performance",
  "o3-mini": "performance",
  // Lightweight → lite
  "gpt-4o-mini": "auto",
  "gpt-3.5-turbo": "auto",
  // Claude aliases
  "claude-3-opus": "ultimate",
  "claude-3-sonnet": "performance",
  "claude-3-haiku": "auto",
  "claude-3.5-sonnet": "auto",
  "claude-3.5-haiku": "efficient",
  "claude-3.7-sonnet": "auto",
  // Gemini aliases
  "gemini-pro": "performance",
  "gemini-flash": "efficient",
  // Friendly names for "new model" tier
  qwen: "qmodel",
  deepseek: "dmodel",
  "deepseek-flash": "dfmodel",
  "deepseek-v4": "dmodel",
  "deepseek-v4-flash": "dfmodel",
  glm: "gm51model",
  kimi: "kmodel",
  minimax: "mmodel",
};

/**
 * Resolve an OpenAI model name (or any alias) to a qodercli --model value.
 */
const getModelMapping = (requestedModel) => {
  if (!requestedModel) return "auto";

  const models = getQoderModels();
  
  // 1. Direct qodercli model id
  if (models.some(m => m.id === requestedModel)) return requestedModel;

  // 2. Exact alias match
  if (ALIAS_MAP[requestedModel]) return ALIAS_MAP[requestedModel];

  // 3. Heuristic partial matching
  const lower = requestedModel.toLowerCase();
  if (lower === "lite") return "auto";
  if (lower === "efficient") return "performance";

  if (lower.includes("claude")) {
    if (lower.includes("opus")) return "ultimate";
    return "auto";
  }
  if (lower.includes("gpt-4") || lower.includes("gpt4")) return "auto";
  if (lower.includes("gpt-3") || lower.includes("gpt3")) return "auto";
  if (/^o\d/.test(lower)) {
    if (lower.includes("mini")) return "performance";
    return "ultimate";
  }
  if (lower.includes("gemini")) {
    if (lower.includes("flash") || lower.includes("nano")) return "efficient";
    return "performance";
  }
  
  // Search in dynamic models by partial ID match
  for (const m of models) {
    if (lower.includes(m.id.toLowerCase())) return m.id;
  }

  return "auto";
};

// ---------------------------------------------------------------------------
// Message → prompt conversion
// ---------------------------------------------------------------------------

/**
 * Convert an OpenAI messages array into a single prompt string for qodercli.
 *
 * Includes conversation history (up to last 10 messages) so the model has
 * context for follow-up questions and multi-turn edits. Older messages are
 * dropped to avoid exceeding qodercli's context limits.
 *
 * Format:
 *   System: <system message if present>
 *   User: <message>
 *   Assistant: <message>
 *   User: <latest message>
 */
const messagesToPrompt = (messages) => {
  if (!messages || messages.length === 0) return "Hello";

  // Separate system message from conversation
  const systemMsg = messages.find((m) => m.role === "system");
  const conversation = messages.filter((m) => m.role !== "system");

  // Keep last 10 conversation turns to avoid context overflow
  const recent = conversation.slice(-10);

  const extractContent = (msg) => {
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
    }
    return msg.content || "";
  };

  const parts = [];

  // Include system message if present
  if (systemMsg) {
    const sysContent = extractContent(systemMsg);
    if (sysContent.trim()) parts.push(`System: ${sysContent.trim()}`);
  }

  // Include conversation history
  for (const msg of recent) {
    const content = extractContent(msg).trim();
    if (!content) continue;
    if (msg.role === "user") parts.push(`User: ${content}`);
    else if (msg.role === "assistant") parts.push(`Assistant: ${content}`);
  }

  return parts.join("\n\n") || "Hello";
};

// ---------------------------------------------------------------------------
// Response builders — chat completions
// ---------------------------------------------------------------------------

const buildStreamChunk = (content, model, id) => ({
  id,
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [
    { index: 0, delta: { role: "assistant", content }, finish_reason: null },
  ],
});

const buildDoneChunk = (model, id, finishReason = "stop") => ({
  id,
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
});

const buildFullChatResponse = (content, model, finishReason, id) => ({
  id,
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [
    {
      index: 0,
      message: { role: "assistant", content },
      finish_reason: finishReason || "stop",
    },
  ],
  usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
});

// ---------------------------------------------------------------------------
// Response builders — legacy text completions
// ---------------------------------------------------------------------------

const buildCompletionStreamChunk = (text, model, id) => ({
  id,
  object: "text_completion_chunk",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, text, finish_reason: null }],
});

const buildFullCompletionResponse = (text, model, finishReason, id) => ({
  id,
  object: "text_completion",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, text, finish_reason: finishReason || "stop" }],
  usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
});

/**
 * Extracts tool calls from qodercli message content
 * @param {Array} content - The content array from qodercli message
 * @returns {Array|null} - Array of OpenAI-format tool calls or null
 */
const extractToolCalls = (content) => {
  if (!Array.isArray(content)) return null;

  const toolCalls = [];
  for (const item of content) {
    if (item.type === "function" && item.id && item.name && item.input) {
      toolCalls.push({
        id: item.id,
        type: "function",
        function: {
          name: item.name,
          arguments: item.input,
        },
      });
    }
  }

  return toolCalls.length > 0 ? toolCalls : null;
};

/**
 * Build streaming chunk with tool calls
 * @param {Object} data - qodercli data object
 * @param {string} model - model name
 * @param {string} id - completion id
 * @returns {Object} - OpenAI format streaming chunk
 */
const buildToolCallStreamChunk = (data, model, id) => {
  const toolCalls = extractToolCalls(data.message?.content);

  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: toolCalls ? { tool_calls: toolCalls } : {},
        finish_reason:
          data.message?.status === "tool_calling" ? null : "tool_calls",
      },
    ],
  };
};

/**
 * Build full chat response with tool calls
 * @param {Array} toolCalls - Array of tool calls
 * @param {string} content - Text content
 * @param {string} model - model name
 * @param {string} finishReason - finish reason
 * @param {string} id - completion id
 * @returns {Object} - OpenAI format response
 */
const buildFullChatResponseWithTools = (
  toolCalls,
  content,
  model,
  finishReason,
  id,
) => ({
  id,
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls,
      },
      finish_reason: finishReason || (toolCalls ? "tool_calls" : "stop"),
    },
  ],
  usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
});

module.exports = {
  newId,
  extractTextContent,
  extractToolCalls,
  getModelMapping,
  messagesToPrompt,
  buildStreamChunk,
  buildDoneChunk,
  buildFullChatResponse,
  buildToolCallStreamChunk,
  buildFullChatResponseWithTools,
  buildCompletionStreamChunk,
  buildFullCompletionResponse,
  // Model catalogue — used by /v1/models endpoint
  getQoderModels,
};
