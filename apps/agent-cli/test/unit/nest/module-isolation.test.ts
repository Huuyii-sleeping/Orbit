import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import type { WorkflowRuntimePort } from "@orbit/runtime-contracts";
import { describe, expect, it, vi } from "vitest";
import { WorkflowRuntimeModule } from "../../../src/nest/workflow/workflow.module.js";
import { WORKFLOW_RUNTIME_PORT } from "../../../src/nest/tokens.js";
import { OrbitShutdownService } from "../../../src/nest/orbit-shutdown.service.js";

@Module({})
class TestRuntimeModule {}

describe("Nest 模块依赖隔离", () => {
  it("工作流 HTTP 模块只需要 Workflow Port 和连接生命周期，不加载聊天或模型配置", async () => {
    const get = vi.fn<WorkflowRuntimePort["get"]>(async () => null);
    const app = await NestFactory.create(WorkflowRuntimeModule.register({
      module: TestRuntimeModule,
      providers: [
        { provide: WORKFLOW_RUNTIME_PORT, useValue: { get } },
        OrbitShutdownService,
      ],
      exports: [WORKFLOW_RUNTIME_PORT, OrbitShutdownService],
    }), { logger: false, abortOnError: false });
    try {
      await app.listen(0, "127.0.0.1");
      const response = await fetch(`${await app.getUrl()}/workflow-runs/missing`);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "WORKFLOW_RUN_NOT_FOUND" } });
      expect(get).toHaveBeenCalledOnce();
      expect((await fetch(`${await app.getUrl()}/chat`)).status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
