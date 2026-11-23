import { AgentHost } from "../../../src/host/agent-host.js";
import { describe, expect, it, vi } from "vitest";
import { AgentService } from "../../../src/service-api/index.js";
import { runServer } from "../../../src/entrypoints/server.js";
import * as config from "../../../src/config/config.js";
import { afterEach } from "vitest";

afterEach(() => vi.unstubAllEnvs());

describe("entrypoints/server", () => {
  it("initializes the provided host before listening", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AGENT_SERVICE_TOKEN", undefined);
    vi.stubEnv("AGENT_HTTP_HOST", undefined);
    const ensureModel = vi.spyOn(config, "ensureModelConfigured").mockImplementation(() => {
      throw new Error("Missing environment variable: MODEL_ID");
    });
    const defaultModel = vi.spyOn(config, "getDefaultModel").mockReturnValue("unset-model");
    const host = new AgentHost();
    vi.spyOn(host, "initialize").mockResolvedValue(undefined);
    const listen = vi.fn((port: number, bind: string, callback: () => void) => {
      callback();
      return undefined;
    });
    const output = {
      chunks: [] as string[],
      write(chunk: string) {
        this.chunks.push(String(chunk));
        return true;
      },
    };

    await runServer({
      host,
      port: 4318,
      output: output as unknown as NodeJS.WritableStream,
      serverFactory: (service) => {
        expect(service).toBeInstanceOf(AgentService);
        return {
          once() {
            return this;
          },
          close(callback?: (error?: Error) => void) {
            callback?.();
            return this;
          },
          listen,
        } as {
          once(event: string, listener: (error: Error) => void): unknown;
          close(callback?: (error?: Error) => void): unknown;
          listen(port: number, host: string, callback: () => void): void;
        };
      },
    });

    expect(host.initialize).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith(4318, "127.0.0.1", expect.any(Function));
    expect(output.chunks.join("")).toContain("http://127.0.0.1:4318");
    expect(ensureModel).not.toHaveBeenCalled();
    ensureModel.mockRestore();
    defaultModel.mockRestore();
  });

  it("rejects missing production token and anonymous public binding before initializing host", async () => {
    const initialize = vi.fn();
    const host = { initialize } as unknown as AgentHost;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGENT_SERVICE_TOKEN", undefined);
    await expect(runServer({ host })).rejects.toThrow(/AGENT_SERVICE_TOKEN/);
    vi.stubEnv("NODE_ENV", "test");
    await expect(runServer({ host, bindAddress: "0.0.0.0" })).rejects.toThrow(/AGENT_SERVICE_TOKEN/);
    expect(initialize).not.toHaveBeenCalled();
  });
});
