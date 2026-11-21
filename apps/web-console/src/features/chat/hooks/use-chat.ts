import { getErrorMessage, createAppError } from "../../../lib/errors/error-factory";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  createAgentEventStream,
  createSession,
  fetchHealth,
  fetchSession,
  fetchSessions,
  sendSessionMessageStream,
  type AgentProfile,
  type AgentRuntimeContext,
  type HealthStatus,
  type SessionDetail,
  type SessionSummary,
} from "../../../api";
import { shouldReloadSessionFromAgentEvent } from "../../../chat-stream-state";
import { resolveActiveSessionId } from "../../../session-selection";
import {
  isSessionHidden,
  readSessionMetadata,
} from "../../../session-metadata";
import {
  sortSessionsByRecent,
  sortSessionsForSidebar,
} from "../lib/chat-format";
import type { LoadState, StreamState } from "../../../app/types";

/** 管理聊天会话、流式消息和运行时连接。 */
export function useChat(
  activeAgent: AgentProfile | null,
  onOpen: () => void,
  setError: (error: string | null) => void,
) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<SessionDetail | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [sessionMetadata] = useState(() =>
    typeof window === "undefined"
      ? {}
      : readSessionMetadata(window.localStorage),
  );
  const activeSessionIdRef = useRef<string | null>(null);
  const streamingSessionIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeSummary = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const visibleSessions = useMemo(
    () =>
      sortSessionsForSidebar(sessions, sessionMetadata).filter(
        (session) => !isSessionHidden(session.id, sessionMetadata),
      ),
    [sessions, sessionMetadata],
  );
  const isBusy = loadState === "sending" || activeSummary?.busy === true;
  const canSend = Boolean(activeSessionId && draft.trim() && !isBusy);

  function runtimeContextFromAgent(
    agent: AgentProfile | null,
  ): AgentRuntimeContext | null {
    return agent
      ? {
          id: agent.id,
          name: agent.name,
          skills: agent.skills,
        }
      : null;
  }

  async function refreshHealth(): Promise<void> {
    try {
      setHealth(await fetchHealth());
    } catch (err) {
      setHealth({
        ok: false,
        connected: false,
        bffStatus: "error",
        agentStatus: "unavailable",
      });
      setError(getErrorMessage(err));
    }
  }

  async function refreshSessions(selectFirst = false): Promise<void> {
    const next = sortSessionsByRecent(await fetchSessions());
    setSessions(next);
    const nextVisibleSessions = sortSessionsForSidebar(
      next,
      sessionMetadata,
    ).filter((session) => !isSessionHidden(session.id, sessionMetadata));
    const nextActiveSessionId = resolveActiveSessionId(
      activeSessionId,
      nextVisibleSessions,
    );
    if (selectFirst && !activeSessionId && nextActiveSessionId) {
      setActiveSessionId(nextActiveSessionId);
    }
  }

  async function loadSession(
    sessionId: string,
    options: { silent?: boolean } = {},
  ): Promise<void> {
    if (!options.silent) {
      setLoadState("loading");
    }
    try {
      const detail = await fetchSession(sessionId);
      setActiveSession(detail);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      if (!options.silent) {
        setLoadState("idle");
      }
    }
  }

  async function handleCreateSession(): Promise<void> {
    onOpen();
    setLoadState("loading");
    try {
      const session = await createSession(runtimeContextFromAgent(activeAgent));
      await refreshSessions();
      setActiveSessionId(session.id);
      setActiveSession({ ...session, messages: [] });
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoadState("idle");
    }
  }

  async function sendDraft(): Promise<void> {
    if (!activeSessionId || !draft.trim() || isBusy) {
      return;
    }
    const message = draft.trim();
    const targetSessionId = activeSessionId;
    setDraft("");
    setLoadState("sending");
    streamingSessionIdRef.current = targetSessionId;
    setActiveSession((session) =>
      session
        ? {
            ...session,
            messages: [
              ...session.messages,
              { role: "user", content: message },
              { role: "assistant", content: "", name: "streaming" },
            ],
          }
        : session,
    );
    try {
      await sendSessionMessageStream(
        activeSessionId,
        message,
        (event) => {
          if (event.type === "message.delta") {
            const delta = event.data.delta ?? "";
            if (!delta) {
              return;
            }
            setActiveSession((session) =>
              session
                ? {
                    ...session,
                    messages: session.messages.map((item, index) =>
                      index === session.messages.length - 1 &&
                      item.role === "assistant"
                        ? {
                            role: "assistant",
                            content: `${item.content ?? ""}${delta}`,
                          }
                        : item,
                    ),
                  }
                : session,
            );
          }
          if (event.type === "message.done" && event.data.assistant) {
            const assistant = event.data.assistant;
            setActiveSession((session) =>
              session
                ? {
                    ...session,
                    messages: session.messages.map((item, index) =>
                      index === session.messages.length - 1 &&
                      item.role === "assistant"
                        ? { role: "assistant", content: assistant }
                        : item,
                    ),
                  }
                : session,
            );
          }
          if (event.type === "message.error") {
            throw createAppError(event.data);
          }
        },
        runtimeContextFromAgent(activeAgent),
      );
      await Promise.all([refreshSessions(), loadSession(activeSessionId)]);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      if (streamingSessionIdRef.current === targetSessionId) {
        streamingSessionIdRef.current = null;
      }
      setLoadState("idle");
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await sendDraft();
  }

  function handleComposerKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void sendDraft();
      return;
    }
    if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  }

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    setStreamState("connecting");
    try {
      const stream = createAgentEventStream({
        onOpen: () => setStreamState("connected"),
        onError: () => setStreamState("disconnected"),
        onEvent: () => {
          void refreshSessions();
          const currentSessionId = activeSessionIdRef.current;
          if (
            shouldReloadSessionFromAgentEvent({
              activeSessionId: currentSessionId,
              streamingSessionId: streamingSessionIdRef.current,
            })
          ) {
            void loadSession(currentSessionId, { silent: true });
          }
        },
      });
      return () => stream.close();
    } catch {
      setStreamState("disconnected");
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (activeSessionId) {
      void loadSession(activeSessionId);
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    const nextActiveSessionId = resolveActiveSessionId(
      activeSessionId,
      visibleSessions,
    );
    if (nextActiveSessionId === activeSessionId) {
      return;
    }
    setActiveSessionId(nextActiveSessionId);
    setActiveSession(null);
  }, [activeSessionId, visibleSessions]);

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        textareaRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  return {
    health,
    sessions,
    visibleSessions,
    activeSession,
    activeSessionId,
    draft,
    setDraft,
    loadState,
    setLoadState,
    streamState,
    isBusy,
    canSend,
    textareaRef,
    refreshHealth,
    refreshSessions,
    handleCreateSession,
    handleSend,
    handleComposerKeyDown,
  };
}
