import { describe, expect, it } from "vitest";
import { resolveServiceEndpoint } from "../../src/service-endpoint.js";

describe("service endpoint boundary", () => {
  it("resolves paths and same-origin absolute endpoints", () => {
    expect(resolveServiceEndpoint("/bridge/state", "https://agent.example").href).toBe("https://agent.example/bridge/state");
    expect(resolveServiceEndpoint("https://agent.example/events", "https://agent.example").pathname).toBe("/events");
  });
  it.each(["https://other.example/events", "//other.example/events", "http://agent.example/events", "https://user:secret@agent.example/events", "file:///etc/passwd"])("rejects credential forwarding to %s", (endpoint) => {
    expect(() => resolveServiceEndpoint(endpoint, "https://agent.example")).toThrow();
  });
  it("rejects configured URL credentials", () => {
    expect(() => resolveServiceEndpoint("/events", "https://user:secret@agent.example")).toThrow();
  });
});
