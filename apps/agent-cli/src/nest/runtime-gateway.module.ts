import { Module, type DynamicModule } from "@nestjs/common";
import type { AgentService } from "../service-api/index.js";
import {
  AGENT_CHAT_SERVICE,
  AGENT_SESSIONS_SERVICE,
  AGENT_TOOLS_SERVICE,
  AGENT_SKILLS_SERVICE,
  AGENT_HOST_EVENTS,
  AGENT_RUNTIME_INFO,
  AGENT_MCP_SERVICE,
  AGENT_RUNTIME_PORT,
  WORKFLOW_RUNTIME_PORT,
  TOOL_EXECUTION_PORT,
  MEMORY_RUNTIME_PORT,
} from "./tokens.js";
import { OrbitShutdownService } from "./orbit-shutdown.service.js";

/** 进程内依赖装配；由各 HTTP 模块显式导入，不向 Nest 全局暴露能力。 */
@Module({})
export class RuntimeGatewayModule {
  static register(service: AgentService): DynamicModule {
    const providers = [
      { provide: AGENT_CHAT_SERVICE, useValue: { chat: service.chat.bind(service) } },
      {
        provide: AGENT_SESSIONS_SERVICE,
        useValue: {
          createSession: service.createSession.bind(service),
          listSessions: service.listSessions.bind(service),
          getSessionDetail: service.getSessionDetail.bind(service),
          compactSession: service.compactSession.bind(service),
        },
      },
      {
        provide: AGENT_TOOLS_SERVICE,
        useValue: {
          toolsMetadata: service.toolsMetadata.bind(service),
          runToolByName: service.runToolByName.bind(service),
        },
      },
      {
        provide: AGENT_SKILLS_SERVICE,
        useValue: { resolveAgentSkills: service.resolveAgentSkills.bind(service) },
      },
      {
        provide: AGENT_HOST_EVENTS,
        useValue: {
          bridgeManifest: service.bridgeManifest.bind(service),
          bridgeState: service.bridgeState.bind(service),
          replayEventsSince: service.replayEventsSince.bind(service),
          subscribeEvents: service.subscribeEvents.bind(service),
        },
      },
      {
        provide: AGENT_RUNTIME_INFO,
        useValue: {
          runtimeInfo: service.runtimeInfo.bind(service),
          bridgeManifest: service.bridgeManifest.bind(service),
        },
      },
      { provide: AGENT_MCP_SERVICE, useValue: service },
      { provide: AGENT_RUNTIME_PORT, useValue: service.runtimeGateway.agent },
      { provide: WORKFLOW_RUNTIME_PORT, useValue: service.runtimeGateway.workflow },
      { provide: TOOL_EXECUTION_PORT, useValue: service.runtimeGateway.tools },
      { provide: MEMORY_RUNTIME_PORT, useValue: service.runtimeGateway.memory },
    ];
    return {
      module: RuntimeGatewayModule,
      providers: [...providers, OrbitShutdownService],
      exports: [...providers.map(({ provide }) => provide), OrbitShutdownService],
    };
  }
}
