export { resolveDaemonCliService as resolveDaemonTuiService } from "../service-adapter.js";

export type TerminalTuiServiceLike = {
  bridgeManifest(): Record<string, unknown>;
  createSession(): { id: string } | Promise<{ id: string }>;
  listSessions(): Array<{ id: string; busy: boolean; history: unknown[] }>;
  toolsMetadata(): Promise<Array<Record<string, string>>>;
  chat(input: {
    session_id?: string;
    message?: string;
    include_scheduled_notifications?: boolean;
  }): Promise<Record<string, unknown>>;
  runToolByName?(name: string, argumentsJson: string): Promise<string>;
  compactSession?(sessionId: string, keepRecent?: number): Promise<SessionCompactionResult>;
};

export type DaemonTuiServiceResolution = {
  service: TerminalTuiServiceLike;
  notice: string;
};
import type { SessionCompactionResult } from "@orbit/runtime-contracts";
