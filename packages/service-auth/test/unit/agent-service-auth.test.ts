import { describe, expect, it } from "vitest";
import { assertAgentServiceListenAddress, matchesAgentServiceToken, resolveAgentServiceToken } from "../../src/agent-service-auth.js";

const token = "test-agent-service-token-0123456789abcdef";

describe("Agent service credentials", () => {
  it("requires a token in production and validates configured values without exposing them", () => {
    expect(resolveAgentServiceToken({}, {})).toBeUndefined();
    expect(() => resolveAgentServiceToken({}, { NODE_ENV: "production" })).toThrow(/AGENT_SERVICE_TOKEN/);
    expect(resolveAgentServiceToken({}, { NODE_ENV: "production", AGENT_SERVICE_TOKEN: token })).toBe(token);
    for (const invalid of ["", "short", "x".repeat(513), "x".repeat(32) + "\nheader", "x".repeat(32) + "汉"]) {
      expect(() => resolveAgentServiceToken({ agentServiceToken: invalid }, {})).toThrow(/AGENT_SERVICE_TOKEN/);
    }
    expect(() => resolveAgentServiceToken({ agentServiceToken: "" }, { AGENT_SERVICE_TOKEN: token })).toThrow();
    expect(resolveAgentServiceToken({ agentServiceToken: token }, { AGENT_SERVICE_TOKEN: "invalid" })).toBe(token);
  });

  it("accepts only an exact Bearer credential", () => {
    expect(matchesAgentServiceToken(`Bearer ${token}`, token)).toBe(true);
    expect(matchesAgentServiceToken(`bearer ${token}`, token)).toBe(true);
    for (const header of [undefined, token, `Basic ${token}`, `Bearer ${token}-wrong`, `Bearer ${token}, Bearer ${token}`, `Bearer ${token}\n`, "Bearer wrong"]) {
      expect(matchesAgentServiceToken(header, token)).toBe(false);
    }
  });

  it("restricts anonymous listeners to loopback IPs", () => {
    for (const host of ["127.0.0.1", "127.2.3.4", "::1"]) expect(() => assertAgentServiceListenAddress(host, undefined)).not.toThrow();
    for (const host of ["0.0.0.0", "::", "192.168.1.2", "localhost", "127.invalid"]) expect(() => assertAgentServiceListenAddress(host, undefined)).toThrow();
    expect(() => assertAgentServiceListenAddress("0.0.0.0", token)).not.toThrow();
    expect(() => assertAgentServiceListenAddress("::", token)).not.toThrow();
  });
});
