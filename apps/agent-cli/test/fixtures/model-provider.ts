import { createServer, type ServerResponse } from "node:http";

/** 协议测试端点；只模拟供应商 HTTP，SDK、Mastra Agent 和工具执行使用真实实现。 */
export async function startModelProvider(options: { tool?: { name: string; input: Record<string, unknown> }; textOnly?: boolean; text?: (body: Record<string, any>) => string } = {}) {
  const requests: Array<{
    path: string;
    headers: Record<string, unknown>;
    body: Record<string, any>;
  }> = [];
  const state = { statusCode: 200, hold: false, errorMessage: "fixture unavailable" };
  const toolName = options.tool?.name ?? "echo";
  const toolInput = options.tool?.input ?? { value: "hello" };
  const input = JSON.stringify(toolInput);
  function sse(response: ServerResponse, payload: unknown, event?: string) {
    response.write(`${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(payload)}\n\n`);
  }
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const path = request.url ?? "";
    const text = options.text?.(body) ?? '{"text":"adapter-ok"}';
    requests.push({ path, headers: request.headers, body });
    if (state.statusCode !== 200) {
      response.writeHead(state.statusCode, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          type: "error",
          error: {
            code: state.statusCode,
            type: "permission_error",
            message: state.errorMessage,
            status: "PERMISSION_DENIED",
          },
        }),
      );
      return;
    }
    if (state.hold) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.flushHeaders();
      return;
    }
    const toolResult = /tool_result|functionResponse|function_call_output|"role":"tool"/.test(raw);
    const useTool = !options.textOnly && Boolean(body.tools?.length) && !toolResult;
    const stream = body.stream || path.includes("streamGenerateContent");
    response.writeHead(200, { "Content-Type": stream ? "text/event-stream" : "application/json" });
    if (path.includes("/messages")) {
      const content = useTool
        ? { type: "tool_use", id: "call_1", name: toolName, input: toolInput }
        : { type: "text", text };
      const message = {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [content],
        stop_reason: useTool ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 8, output_tokens: 4 },
      };
      if (!stream) return response.end(JSON.stringify(message));
      sse(
        response,
        { type: "message_start", message: { ...message, content: [], stop_reason: null } },
        "message_start",
      );
      sse(
        response,
        {
          type: "content_block_start",
          index: 0,
          content_block: useTool ? { ...content, input: {} } : { type: "text", text: "" },
        },
        "content_block_start",
      );
      sse(
        response,
        {
          type: "content_block_delta",
          index: 0,
          delta: useTool
            ? { type: "input_json_delta", partial_json: input }
            : { type: "text_delta", text },
        },
        "content_block_delta",
      );
      sse(response, { type: "content_block_stop", index: 0 }, "content_block_stop");
      sse(
        response,
        {
          type: "message_delta",
          delta: { stop_reason: message.stop_reason, stop_sequence: null },
          usage: { output_tokens: 4 },
        },
        "message_delta",
      );
      sse(response, { type: "message_stop" }, "message_stop");
    } else if (path.includes("GenerateContent") || path.includes("generateContent")) {
      const payload = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                useTool ? { functionCall: { name: toolName, args: toolInput } } : { text },
              ],
            },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 },
      };
      if (!stream) return response.end(JSON.stringify(payload));
      sse(response, payload);
    } else if (path.includes("/responses")) {
      const item = useTool
        ? {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: toolName,
            arguments: input,
            status: "completed",
          }
        : {
            type: "message",
            id: "msg_1",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text, annotations: [] }],
          };
      const payload = {
        id: "resp_1",
        object: "response",
        created_at: 1,
        model: body.model,
        status: "completed",
        output: [item],
        usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 },
      };
      if (!stream) return response.end(JSON.stringify(payload));
      sse(response, { type: "response.created", response: payload });
      sse(response, {
        type: "response.output_item.added",
        output_index: 0,
        item: useTool ? { ...item, arguments: "" } : item,
      });
      sse(
        response,
        useTool
          ? {
              type: "response.function_call_arguments.delta",
              item_id: "fc_1",
              output_index: 0,
              delta: input,
            }
          : {
              type: "response.output_text.delta",
              item_id: "msg_1",
              output_index: 0,
              content_index: 0,
              delta: text,
            },
      );
      sse(response, { type: "response.output_item.done", output_index: 0, item });
      sse(response, { type: "response.completed", response: payload });
    } else if (path.includes("/chat/completions")) {
      const tool_calls = [
        { id: "call_1", type: "function", function: { name: toolName, arguments: input } },
      ];
      if (!stream)
        return response.end(
          JSON.stringify({
            id: "chat_1",
            object: "chat.completion",
            created: 1,
            model: body.model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: useTool ? null : text,
                  ...(useTool ? { tool_calls } : {}),
                },
                finish_reason: useTool ? "tool_calls" : "stop",
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
          }),
        );
      for (const choice of [
        {
          delta: useTool
            ? { role: "assistant", tool_calls: tool_calls.map((call) => ({ ...call, index: 0 })) }
            : { role: "assistant", content: text },
          finish_reason: null,
        },
        { delta: {}, finish_reason: useTool ? "tool_calls" : "stop" },
      ])
        sse(response, {
          id: "chat_1",
          object: "chat.completion.chunk",
          created: 1,
          model: body.model,
          choices: [{ index: 0, ...choice }],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        });
      response.write("data: [DONE]\n\n");
    } else {
      response.end(JSON.stringify({ error: "unexpected protocol endpoint" }));
    }
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Model fixture did not start");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    state,
    close: () =>
      new Promise<void>((resolve, reject) =>
        { server.closeAllConnections(); server.close((error) => (error ? reject(error) : resolve())); },
      ),
  };
}
