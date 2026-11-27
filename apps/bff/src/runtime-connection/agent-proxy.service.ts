import { writeStreamChunk } from "../stream-utils.js";
import { Injectable } from "@nestjs/common";
import { resolveAgentServiceToken, resolveServiceEndpoint, currentServiceTenant, encodeServiceTenant,
  SERVICE_TENANT_HEADER, type AgentServiceAuthOptions } from "@orbit/service-auth";
import type { IncomingMessage, ServerResponse } from "node:http";
import { errorPayload, applyCommonHeaders, writeJson, type JsonObject } from "../http/http-utils.js";

export type ProxyResult =
  | { ok: true; status: number; body: unknown; retryAfterSeconds?: number }
  | { ok: false; status: number; body: JsonObject };

/** BFF 到受信 Agent 上游的连接、认证与超时配置。 */
export type AgentProxyOptions = AgentServiceAuthOptions & {
  agentBaseUrl: string;
  fetchImpl?: typeof fetch;
  /** 普通请求总时限，以及 SSE 建连时限；不限制正常 SSE 的总时长。 */
  requestTimeoutMs?: number;
};

function getObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function upstreamUrl(agentBaseUrl: string, pathname: string, search = ""): URL {
  return resolveServiceEndpoint(`${pathname}${search}`, agentBaseUrl);
}

@Injectable()
export class AgentProxyService {
  private readonly agentBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly agentServiceToken: string | undefined;

  constructor(options: AgentProxyOptions) {
    this.agentServiceToken = resolveAgentServiceToken(options);
    resolveServiceEndpoint("/", options.agentBaseUrl);
    this.agentBaseUrl = options.agentBaseUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 1) throw new Error("invalid upstream request timeout");
  }

  async proxyJson(input: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    pathname: string;
    search?: string;
    body?: unknown;
  }): Promise<ProxyResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(upstreamUrl(this.agentBaseUrl, input.pathname, input.search ?? ""), {
        signal: controller.signal,
        method: input.method,
        redirect: "error",
        headers: {
          ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...this.serviceHeaders(),
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      });
      const raw = await response.text();
      const body = raw.trim() ? (JSON.parse(raw) as unknown) : {};
      const retryAfter = Number(response.headers.get("retry-after"));
      return { ok: true, status: response.status, body,
        ...(response.status === 429 && Number.isSafeInteger(retryAfter) && retryAfter > 0
          ? { retryAfterSeconds: Math.min(retryAfter, 3_600) } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        status: controller.signal.aborted ? 504 : 502,
        body: controller.signal.aborted
          ? errorPayload("AGENT_UPSTREAM_TIMEOUT", "Agent request exceeded the time limit")
          : errorPayload("AGENT_UPSTREAM_UNAVAILABLE", error instanceof Error ? error.message : String(error)),
      };
    } finally { clearTimeout(timer); }
  }

  /** 读取 Runtime 实际注册的工具，不执行任何调用。 */
  async agentTools(): Promise<ProxyResult> {
    return this.proxyJson({ method: "GET", pathname: "/tools" });
  }

  async health(): Promise<ProxyResult> {
    return this.proxyJson({ method: "GET", pathname: "/health" });
  }

  async sessions(): Promise<ProxyResult> {
    return this.proxyJson({ method: "GET", pathname: "/sessions" });
  }

  async createSession(body: JsonObject = {}): Promise<ProxyResult> {
    return this.proxyJson({ method: "POST", pathname: "/sessions", body: { agent: body.agent } });
  }

  async sessionDetail(sessionId: string): Promise<ProxyResult> {
    return this.proxyJson({ method: "GET", pathname: `/sessions/${encodeURIComponent(sessionId)}` });
  }

  async transcript(sessionId: string): Promise<ProxyResult> {
    const result = await this.sessionDetail(sessionId);
    if (!result.ok) {
      return result;
    }
    const body = getObject(result.body);
    if (body.ok === false) {
      return result;
    }
    const session = getObject(body.session);
    return {
      ok: true,
      status: result.status,
      body: {
        ok: true,
        session_id: String(session.id ?? sessionId),
        messages: Array.isArray(session.messages) ? session.messages : [],
        session,
      },
    };
  }

  async sendMessage(sessionId: string, body: JsonObject): Promise<ProxyResult> {
    return this.proxyJson({
      method: "POST",
      pathname: "/chat",
      body: {
        session_id: sessionId,
        message: body.message,
        agent: body.agent,
        include_scheduled_notifications: body.include_scheduled_notifications === true,
      },
    });
  }

  async resolveAgentSkills(body: JsonObject): Promise<ProxyResult> {
    return this.proxyJson({
      method: "POST",
      pathname: "/skills/resolve",
      body: { agent: body.agent },
    });
  }

  async auditEvents(search: string): Promise<ProxyResult> {
    return this.proxyJson({ method: "GET", pathname: "/audit/events", search });
  }

  async securityFindings(search: string): Promise<ProxyResult> {
    return this.proxyJson({ method: "GET", pathname: "/security/findings", search });
  }

  /** 启动 Agent runtime 工作流。 */
  async startWorkflowRun(body: JsonObject): Promise<ProxyResult> {
    return this.proxyJson({ method: "POST", pathname: "/workflow-runs", body });
  }

  /** 查询 Agent runtime 工作流快照。 */
  async workflowRun(runId: string): Promise<ProxyResult> {
    return this.proxyJson({ method: "GET", pathname: `/workflow-runs/${encodeURIComponent(runId)}` });
  }

  /** 向 Agent runtime 传播取消请求。 */
  async cancelWorkflowRun(runId: string): Promise<ProxyResult> {
    return this.proxyJson({ method: "POST", pathname: `/workflow-runs/${encodeURIComponent(runId)}/cancel` });
  }

  /** 将绑定具体 run 的 interrupt 决定转发到 Agent Runtime。 */
  async resumeWorkflowRun(runId: string, body: JsonObject): Promise<ProxyResult> {
    return this.proxyJson({ method: "POST", pathname: `/workflow-runs/${encodeURIComponent(runId)}/resume`, body });
  }

  /** 打开 Agent runtime SSE，并保留事件游标与取消信号。 */
  workflowEventStream(runId: string, search: string, lastEventId: string | undefined, signal: AbortSignal): Promise<Response> {
    const headers: HeadersInit = { Accept: "text/event-stream" };
    if (lastEventId) headers["Last-Event-ID"] = lastEventId;
    return this.fetchStream(upstreamUrl(this.agentBaseUrl, `/workflow-runs/${encodeURIComponent(runId)}/events`, search), {
      method: "GET",
      headers,
      signal,
    });
  }

  async proxyEventStream(req: IncomingMessage, res: ServerResponse, search: string): Promise<void> {
    const controller = new AbortController();
    const close = () => controller.abort();
    res.once("close", close);
    try {
      const headers: HeadersInit = {};
      const lastEventId = req.headers["last-event-id"];
      if (typeof lastEventId === "string") {
        headers["Last-Event-ID"] = lastEventId;
      }
      const upstream = await this.fetchStream(upstreamUrl(this.agentBaseUrl, "/events", search), {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      applyCommonHeaders(res);
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "text/event-stream; charset=utf-8");
      await this.pipeWebStream(upstream, res);
    } catch (error) {
      if (controller.signal.aborted || res.destroyed || res.writableEnded) return;
      if (res.headersSent) {
        res.end();
        return;
      }
      writeJson(
        res,
        502,
        errorPayload("AGENT_UPSTREAM_UNAVAILABLE", error instanceof Error ? error.message : String(error)),
      );
    } finally { res.off("close", close); controller.abort(); }
  }

  async proxyChatMessageStream(res: ServerResponse, sessionId: string, body: JsonObject): Promise<void> {
    const controller = new AbortController();
    const close = () => controller.abort();
    res.once("close", close);
    try {
      const upstream = await this.fetchStream(upstreamUrl(this.agentBaseUrl, "/chat/stream"), {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          session_id: sessionId,
          message: body.message,
          agent: body.agent,
          include_scheduled_notifications: body.include_scheduled_notifications === true,
        }),
      });
      applyCommonHeaders(res);
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "text/event-stream; charset=utf-8");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      await this.pipeWebStream(upstream, res);
    } catch (error) {
      if (controller.signal.aborted || res.destroyed || res.writableEnded) return;
      if (res.headersSent) {
        this.writeSseEvent(res, "message.error", {
          code: "AGENT_UPSTREAM_UNAVAILABLE",
          message: error instanceof Error ? error.message : String(error),
        });
        res.end();
        return;
      }
      writeJson(
        res,
        502,
        errorPayload("AGENT_UPSTREAM_UNAVAILABLE", error instanceof Error ? error.message : String(error)),
      );
    } finally { res.off("close", close); controller.abort(); }
  }

  private async fetchStream(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const headers = new Headers(init.headers);
      for (const [name, value] of Object.entries(this.serviceHeaders())) headers.set(name, value);
      return await this.fetchImpl(url, { ...init, headers, redirect: "error", signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
    } finally { clearTimeout(timer); }
  }

  private serviceHeaders(): Record<string, string> {
    const tenant = currentServiceTenant();
    if (tenant && !this.agentServiceToken) throw new Error("Tenant requests require Agent service credentials");
    return {
      ...(this.agentServiceToken ? { Authorization: `Bearer ${this.agentServiceToken}` } : {}),
      ...(tenant ? { [SERVICE_TENANT_HEADER]: encodeServiceTenant(tenant) } : {}),
    };
  }

  private async pipeWebStream(upstream: Response, res: ServerResponse): Promise<void> {
    if (!upstream.body) {
      res.end();
      return;
    }
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!await writeStreamChunk(res, value)) break;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    res.end();
  }

  private writeSseEvent(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}
