/** 聊天请求状态。 */
export type LoadState = "idle" | "loading" | "sending";

/** 运行时事件连接状态。 */
export type StreamState = "connecting" | "connected" | "disconnected";

/** 工作台可切换页面。 */
export type AppView = "agent" | "skills" | "builder" | "chat" | "settings";
