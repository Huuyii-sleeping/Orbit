import { Module, type DynamicModule } from "@nestjs/common";

/** MCP 显式复用当前宿主服务，不依赖全局注入。 */
@Module({})
export class McpModule {
  static register(runtime: DynamicModule): DynamicModule {
    return { module: McpModule, imports: [runtime], exports: [runtime] };
  }
}
