import { Module, type DynamicModule } from "@nestjs/common";
import { EventsController } from "./events.controller.js";
import { HealthController } from "./health.controller.js";
import { OrbitFallbackController } from "./orbit-fallback.controller.js";

/** 显式接入当前进程的运行依赖。 */
@Module({})
export class EventsHealthModule {
  static register(runtime: DynamicModule): DynamicModule {
    return { module: EventsHealthModule, imports: [runtime], controllers: [HealthController, EventsController, OrbitFallbackController] };
  }
}
