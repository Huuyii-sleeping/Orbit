#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { existsSync, writeFileSync } from "node:fs";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

type JsonRecord = Record<string, unknown>;

type JsonRpcMessage = {
  id?: unknown;
  method?: unknown;
  params?: {
    name?: unknown;
    arguments?: unknown;
  };
};

let buffer = Buffer.alloc(0);
let expireOnceFailed = false;

function shouldFailExpireOnce(): boolean {
  const markerPath = process.env.MCP_DEMO_EXPIRE_ONCE_MARKER?.trim();
  if (!markerPath) {
    if (expireOnceFailed) {
      return false;
    }
    expireOnceFailed = true;
    return true;
  }
  if (existsSync(markerPath)) {
    return false;
  }
  writeFileSync(markerPath, "failed", "utf8");
  return true;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function send(message: unknown): void {
  const body = JSON.stringify(message);
  process.stdout.write(`${body}\n`);
}

async function handleMessage(message: unknown): Promise<void> {
  if (!isJsonRecord(message)) {
    return;
  }
  const { id, method, params } = message as JsonRpcMessage;
  if (typeof method !== "string") {
    return;
  }
  if (method === "notifications/initialized") {
    return;
  }
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "demo-fixture", version: "0.1.0" },
        capabilities: { tools: {} },
      },
    });
    return;
  }
  if (method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "echo_upper",
            description:
              "Uppercase an input string.\u202E token=sk-demo-secret-12345678901234567890",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string" },
              },
              required: ["text"],
            },
          },
          {
            name: "fail_now",
            description: "Return a structured failure from the fixture server.",
            inputSchema: {
              type: "object",
              properties: {
                reason: { type: "string" },
              },
            },
          },
          {
            name: "delay_echo",
            description: "Return input text after a delay.",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string" },
                delayMs: { type: "number" },
              },
            },
          },
          {
            name: "auth_fail",
            description: "Return a JSON-RPC authentication failure.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "expire_once",
            description: "Fail once with a session-expired error and then succeed.",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string" },
              },
            },
          },
        ],
      },
    });
    return;
  }
  if (method === "tools/call") {
    const toolName = String(params?.name ?? "");
    const args = isJsonRecord(params?.arguments) ? params.arguments : {};
    if (toolName === "echo_upper") {
      const text = String(args.text ?? "");
      send({
        jsonrpc: "2.0",
        id,
        result: {
          structuredContent: {
            ok: true,
            echoed: text.toUpperCase(),
            secret: "token=sk-demo-secret-12345678901234567890",
            hidden: "visible\u202Etext",
            source: "mcp-demo-server",
          },
          content: [
            {
              type: "text",
              text: `${text.toUpperCase()}\u202E token=sk-demo-secret-12345678901234567890`,
            },
          ],
        },
      });
      return;
    }
    if (toolName === "fail_now") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: String(args.reason ?? "fixture failure") }],
        },
      });
      return;
    }
    if (toolName === "delay_echo") {
      const delayMs = Math.max(0, Math.min(500, Number(args.delayMs ?? 0)));
      await sleep(delayMs);
      send({
        jsonrpc: "2.0",
        id,
        result: {
          structuredContent: {
            ok: true,
            echoed: String(args.text ?? ""),
          },
        },
      });
      return;
    }
    if (toolName === "auth_fail") {
      send({
        jsonrpc: "2.0",
        id,
        error: {
          code: 401,
          message: "authentication required",
        },
      });
      return;
    }
    if (toolName === "expire_once") {
      if (shouldFailExpireOnce()) {
        send({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32001,
            message: "session expired",
          },
        });
        return;
      }
      send({
        jsonrpc: "2.0",
        id,
        result: {
          structuredContent: {
            ok: true,
            recovered: true,
            echoed: String(args.text ?? ""),
          },
        },
      });
      return;
    }
    send({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `unknown tool: ${toolName}`,
      },
    });
    return;
  }
  send({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `unknown method: ${method}`,
    },
  });
}

process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    const body = buffer.subarray(0, newline).toString("utf8");
    buffer = buffer.subarray(newline + 1);
    try {
      void handleMessage(JSON.parse(body) as unknown);
    } catch {
      process.exit(1);
    }
  }
});
