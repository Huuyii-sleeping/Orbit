import { Module, type DynamicModule } from "@nestjs/common";
import { LocalStoreService, type LocalStoreOptions } from "./local-store.service.js";

/** 独占本地业务文档的创建，各领域显式复用同一存储实例。 */
@Module({})
export class LocalStoreModule {
  static register(options: LocalStoreOptions): DynamicModule {
    return {
      module: LocalStoreModule,
      providers: [{ provide: LocalStoreService, useValue: new LocalStoreService(options) }],
      exports: [LocalStoreService],
    };
  }
}
