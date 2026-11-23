import { AgentHost } from "../../../src/host/agent-host.js";
import { describe, expect, it, vi } from "vitest";
import { AgentService } from "../../../src/service-api/index.js";
import { runServer } from "../../../src/entrypoints/server.js";
import * as config from "../../../src/config/config.js";

describe("entrypoints/server", () => {
  it("initializes the provided host before listening", async () => {
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
    expect(listen).toHaveBeenCalledWith(4318, "0.0.0.0", expect.any(Function));
    expect(output.chunks.join("")).toContain("http://0.0.0.0:4318");
    expect(ensureModel).not.toHaveBeenCalled();
    ensureModel.mockRestore();
    defaultModel.mockRestore();
  });
});
