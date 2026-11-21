import { createAppError } from "../lib/errors/error-factory";
import {
  type ChatMessage,
  type SessionSummary,
  type SessionDetail,
  type HealthStatus,
  type AgentRuntimeContext,
  type SendMessageResult,
  type StreamMessageEvent,
  type AgentStreamEvent,
  type AgentEventStream,
} from "./types";
import {
  type JsonObject,
  type EventSourceConstructor,
  asObject,
  asString,
  asNumber,
  asBoolean,
  requestJson,
  fetchResponse,
  readJsonResponse,
  parseEventData,
} from "./client";
import { normalizeAgentRuntimeContext } from "./agents";

const agentStreamEventTypes = [
  "bridge.ready",
  "session.created",
  "chat.started",
  "chat.completed",
  "chat.failed",
];

function normalizeMessage(value: unknown): ChatMessage | null {
  const record = asObject(value);
  const role = asString(record.role);
  if (
    role !== "system" &&
    role !== "user" &&
    role !== "assistant" &&
    role !== "tool"
  ) {
    return null;
  }
  const content = record.content;
  return {
    role,
    content:
      typeof content === "string"
        ? content
        : content === null
          ? null
          : JSON.stringify(content ?? ""),
    tool_call_id:
      typeof record.tool_call_id === "string" ? record.tool_call_id : undefined,
    name: typeof record.name === "string" ? record.name : undefined,
  };
}

function normalizeSessionSummary(value: unknown): SessionSummary {
  const record = asObject(value);
  return {
    id: asString(record.id),
    createdAt: asNumber(record.createdAt),
    updatedAt: asNumber(record.updatedAt),
    busy: asBoolean(record.busy),
    messageCount: Number(record.messageCount ?? 0),
    rounds: asNumber(record.rounds),
    agent: normalizeAgentRuntimeContext(record.agent),
  };
}

function normalizeSessionDetail(value: unknown): SessionDetail {
  const record = asObject(value);
  const summary = normalizeSessionSummary(record);
  const messages = Array.isArray(record.messages)
    ? record.messages
        .map(normalizeMessage)
        .filter((item): item is ChatMessage => Boolean(item))
    : [];
  return { ...summary, messages };
}

function parseStreamMessageEvent(
  type: string,
  data: unknown,
): StreamMessageEvent | null {
  const record = asObject(data);
  if (type === "message.start") {
    return {
      type,
      data: { session_id: asString(record.session_id) || undefined },
    };
  }
  if (type === "message.delta") {
    return { type, data: { delta: asString(record.delta) } };
  }
  if (type === "message.done") {
    return {
      type,
      data: {
        ok: record.ok !== false,
        assistant:
          typeof record.assistant === "string" ? record.assistant : undefined,
        session: record.session
          ? normalizeSessionSummary(record.session)
          : undefined,
      },
    };
  }
  if (type === "message.error") {
    return {
      type,
      data: {
        code: asString(record.code) || "CHAT_STREAM_FAILED",
        message: asString(record.message) || "chat stream failed",
      },
    };
  }
  return null;
}

function parseSseBlock(raw: string): { type: string; data: unknown } | null {
  const lines = raw.split(/\r?\n/);
  let type = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      type = line.slice("event:".length).trim();
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  return { type, data: parseEventData(dataLines.join("\n")) };
}

async function readSseResponse(
  response: Response,
  onEvent: (event: StreamMessageEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw createAppError("stream response body is not available", { code: "INVALID_RESPONSE" });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const blocks = buffered.split(/\n\n/);
      buffered = blocks.pop() ?? "";
      for (const block of blocks) {
        const parsed = parseSseBlock(block.trim());
        if (!parsed) {
          continue;
        }
        const event = parseStreamMessageEvent(parsed.type, parsed.data);
        if (event) {
          onEvent(event);
        }
      }
      if (done) {
        break;
      }
    }
    const tail = parseSseBlock(buffered.trim());
    if (tail) {
      const event = parseStreamMessageEvent(tail.type, tail.data);
      if (event) {
        onEvent(event);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Opens the BFF SSE stream and forwards known agent events to the caller. */
export function createAgentEventStream(input: {
  onOpen?: () => void;
  onError?: () => void;
  onEvent: (event: AgentStreamEvent) => void;
  eventSourceCtor?: EventSourceConstructor;
}): AgentEventStream {
  const EventSourceImpl = input.eventSourceCtor ?? globalThis.EventSource;
  if (!EventSourceImpl) {
    throw createAppError("EventSource is not available in this browser", { code: "BROWSER_UNSUPPORTED" });
  }
  const source = new EventSourceImpl("/api/events/stream?since_id=-1");
  source.onopen = () => input.onOpen?.();
  source.onerror = () => input.onError?.();
  for (const type of agentStreamEventTypes) {
    source.addEventListener(type, (event) => {
      input.onEvent({
        type,
        id: event.lastEventId || null,
        data: parseEventData(event.data),
      });
    });
  }
  return source;
}

/** Fetches BFF health and normalizes upstream connectivity for the UI. */
export async function fetchHealth(): Promise<HealthStatus> {
  const response = await requestJson<JsonObject>("/api/health");
  const bff = asObject(response.bff);
  const agent = asObject(response.agent);
  return {
    ok: response.ok !== false,
    connected: response.ok !== false && agent.ok !== false,
    bffStatus: asString(bff.status) || "unknown",
    agentStatus:
      asString(agent.status) || (agent.ok === false ? "error" : "ok"),
  };
}

/** Fetches the current session list through the BFF. */
export async function fetchSessions(): Promise<SessionSummary[]> {
  const response = await requestJson<JsonObject>("/api/sessions");
  const sessions = Array.isArray(response.sessions) ? response.sessions : [];
  return sessions.map(normalizeSessionSummary).filter((session) => session.id);
}

/** Creates a new local agent session through the BFF. */
export async function createSession(
  agent?: AgentRuntimeContext | null,
): Promise<SessionSummary> {
  const response = await requestJson<JsonObject>("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: agent ?? null }),
  });
  return normalizeSessionSummary(response.session);
}

/** Fetches one session and its transcript through the BFF. */
export async function fetchSession(sessionId: string): Promise<SessionDetail> {
  const response = await requestJson<JsonObject>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
  );
  return normalizeSessionDetail(response.session);
}

/** Sends a user message to a session through the BFF chat endpoint. */
export async function sendSessionMessage(
  sessionId: string,
  message: string,
  agent?: AgentRuntimeContext | null,
): Promise<SendMessageResult> {
  const response = await requestJson<JsonObject>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, agent: agent ?? null }),
    },
  );
  return {
    ok: response.ok !== false,
    assistant:
      typeof response.assistant === "string" ? response.assistant : undefined,
    session: response.session
      ? normalizeSessionSummary(response.session)
      : undefined,
  };
}

/** Sends a user message and consumes message-level SSE events from the BFF. */
export async function sendSessionMessageStream(
  sessionId: string,
  message: string,
  onEvent: (event: StreamMessageEvent) => void,
  agent?: AgentRuntimeContext | null,
): Promise<void> {
  const response = await fetchResponse(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages/stream`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ message, agent: agent ?? null }),
    },
  );
  if (!response.ok) {
    await readJsonResponse(response);
  }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
    throw createAppError(response.headers.get("content-type"), { code: "INVALID_RESPONSE" });
  }
  try {
    await readSseResponse(response, onEvent);
  } catch (error) {
    throw createAppError(error, { code: "CHAT_STREAM_FAILED" });
  }
}
