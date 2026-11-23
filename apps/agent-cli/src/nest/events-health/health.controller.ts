import { Controller, Get, Inject } from "@nestjs/common";
import type { AgentService } from "../../service-api/index.js";
import { AGENT_RUNTIME_INFO } from "../tokens.js";

@Controller()
export class HealthController {
  constructor(@Inject(AGENT_RUNTIME_INFO) private readonly service: Pick<AgentService, "runtimeInfo" | "bridgeManifest">) {}

  @Get("health")
  async health(): Promise<Record<string, unknown>> {
    return { ok: true, status: "ok", runtime: await this.service.runtimeInfo() };
  }

  @Get("ready")
  async ready(): Promise<Record<string, unknown>> {
    return { ok: true, ready: true, status: "ready", runtime: await this.service.runtimeInfo() };
  }

  @Get("info")
  async info(): Promise<Record<string, unknown>> {
    return {
      ok: true,
      name: "agent-cli",
      version: "0.1.0",
      bridge: this.service.bridgeManifest(),
      runtime: await this.service.runtimeInfo(),
    };
  }

}
