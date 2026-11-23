import { Module, type DynamicModule } from "@nestjs/common";
import { LocalStoreService } from "../storage/local-store.service.js";
import { SkillInstallerService } from "./skill-installer.service.js";
import { SkillRegistryService, type SkillRegistryOptions } from "./skill-registry.service.js";
import { SkillStoreService } from "./skill-store.service.js";
import { SkillValidatorService } from "./skill-validator.service.js";
import { SkillsController } from "./skills.controller.js";

/** 封装技能生命周期，依赖的本地存储由应用显式传入。 */
@Module({})
export class SkillsModule {
  static register(options: SkillRegistryOptions, store: DynamicModule): DynamicModule {
    return {
      module: SkillsModule,
      imports: [store],
      controllers: [SkillsController],
      providers: [
        SkillValidatorService,
        {
          provide: SkillStoreService,
          inject: [SkillValidatorService],
          useFactory: (validator: SkillValidatorService) => new SkillStoreService(validator, options),
        },
        SkillInstallerService,
        {
          provide: SkillRegistryService,
          inject: [LocalStoreService, SkillStoreService, SkillInstallerService],
          useFactory: (local: LocalStoreService, packages: SkillStoreService, installer: SkillInstallerService) =>
            new SkillRegistryService(local, packages, installer),
        },
      ],
      exports: [SkillRegistryService],
    };
  }
}
