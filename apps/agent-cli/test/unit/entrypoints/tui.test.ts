import { Readable,Writable } from "node:stream";
import { describe,expect,it,vi } from "vitest";
import { createAgentAppRuntime } from "../../../src/bootstrap/app-runtime.js";
import {
runTerminalTui
} from "../../../src/entrypoints/tui.js";
import { AgentHost } from "../../../src/host/agent-host.js";
import { createService } from "../../fixtures/terminal-service.js";

describe("entrypoints/tui", () => {


  it("initializes the provided host before starting the terminal TUI", async () => {
    const host = new AgentHost();
    vi.spyOn(host, "initialize").mockResolvedValue(undefined);
    const app = createAgentAppRuntime({
      model: "gpt-test",
      promptSource: { core: "test", tools: [], skills: [], rules: [] },
    });

    await runTerminalTui({
      input: Readable.from(["/exit\n"]),
      output: new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
      host,
      app,
    });

    expect(host.initialize).toHaveBeenCalledTimes(1);
  });


  it("prefers a resolved daemon-backed service before building an embedded runtime", async () => {
    const resolveDaemonService = vi.fn(async () => ({
      service: createService(),
      notice: "Connected to daemon (pid=4242 1 shared session)",
    }));
    const chunks: string[] = [];

    await runTerminalTui({
      input: Readable.from(["/exit\n"]),
      output: new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
          callback();
        },
      }),
      resolveDaemonService,
    });

    expect(resolveDaemonService).toHaveBeenCalledTimes(1);
    expect(chunks.join("")).toContain("Connected to daemon");
  });
});
