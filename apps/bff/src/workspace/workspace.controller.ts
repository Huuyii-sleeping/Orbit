import { Body, Controller, Get, Inject, Patch, Put, Res } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { ProfileService } from "./profile.service.js";
import { SettingsService } from "./settings.service.js";
import { writeJson } from "../http/http-utils.js";

/** 工作区个人资料和界面设置接口。 */
@Controller("/api")
export class WorkspaceController {
  constructor(
    @Inject(ProfileService) private readonly profileService: ProfileService,
    @Inject(SettingsService) private readonly settingsService: SettingsService,
  ) {}

  @Get("profile")
  async profile(@Res() res: ServerResponse): Promise<void> {
    writeJson(res, 200, { ok: true, profile: await this.profileService.getProfile() });
  }

  @Put("profile")
  async updateProfile(@Body() body: unknown, @Res() res: ServerResponse): Promise<void> {
    writeJson(res, 200, { ok: true, profile: await this.profileService.updateProfile(body) });
  }

  @Get("settings")
  async settings(@Res() res: ServerResponse): Promise<void> {
    writeJson(res, 200, { ok: true, settings: await this.settingsService.getSettings() });
  }

  @Patch("settings")
  async patchSettings(@Body() body: unknown, @Res() res: ServerResponse): Promise<void> {
    writeJson(res, 200, { ok: true, settings: await this.settingsService.patchSettings(body) });
  }

}
