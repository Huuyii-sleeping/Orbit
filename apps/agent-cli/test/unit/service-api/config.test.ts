import { describe, expect, it } from "vitest";
import { resolveAgentHttpHost } from "../../../src/service-api/config.js";

describe("service-api/config", () => {
  it("defaults to loopback and accepts explicit IP addresses", () => {
    expect(resolveAgentHttpHost({})).toBe("127.0.0.1");
    expect(resolveAgentHttpHost({ AGENT_HTTP_HOST: " 0.0.0.0 " })).toBe("0.0.0.0");
    expect(resolveAgentHttpHost({ AGENT_HTTP_HOST: "::1" })).toBe("::1");
    for (const value of ["", "localhost", "bad-host"]) {
      expect(() => resolveAgentHttpHost({ AGENT_HTTP_HOST: value })).toThrow(/AGENT_HTTP_HOST/);
    }
  });
});
