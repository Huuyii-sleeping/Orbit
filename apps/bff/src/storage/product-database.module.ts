import { Module, type DynamicModule } from "@nestjs/common";
import { SopDatabase, type SopDatabaseOptions } from "./sop-database.js";

/** 产品 SQLite 的唯一创建与关闭边界，业务模块不重复注册数据库。 */
@Module({})
export class ProductDatabaseModule {
  static register(options: SopDatabaseOptions): DynamicModule {
    return {
      module: ProductDatabaseModule,
      providers: [{ provide: SopDatabase, useValue: new SopDatabase(options) }],
      exports: [SopDatabase],
    };
  }
}
