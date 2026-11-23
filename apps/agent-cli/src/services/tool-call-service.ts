import { RuntimePortError, type ToolExecutionPort } from "@orbit/runtime-contracts";
import type { ToolServiceLike } from "../tools/service.js";

/** 工具目录与直接调用共用的业务边界，不依赖聊天或 Agent 宿主。 */
export class ToolCallService {
  constructor(
    private readonly toolService: Pick<ToolServiceLike, "listToolMetadata">,
    private readonly runtime: ToolExecutionPort,
  ) {}

  async toolsMetadata(): Promise<Array<Record<string, string>>> {
    return this.toolService.listToolMetadata();
  }

  async runToolByName(name: string, argumentsJson: string): Promise<string> {
    let input: unknown = {};
    try {
      input = JSON.parse(argumentsJson || "{}") as unknown;
    } catch {
      input = {};
    }
    try {
      const result = await this.runtime.execute({
        toolId: name,
        input,
        ownerId: "local-direct-api",
        executor: { kind: "direct" },
        requestContext: { argumentsJson },
      });
      return typeof result.output === "string" ? result.output : JSON.stringify(result.output);
    } catch (error) {
      if (error instanceof RuntimePortError && typeof error.details.rawOutput === "string") {
        return error.details.rawOutput;
      }
      throw error;
    }
  }
}
