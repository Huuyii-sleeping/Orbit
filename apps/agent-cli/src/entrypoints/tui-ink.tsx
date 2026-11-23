import { render } from "ink";
import type { ReadStream, WriteStream } from "node:tty";
import { createInkRuntimeController } from "../cli/ink/controller.js";
import { createTerminalRuntime } from "../cli/tui/runtime.js";
import {
  type DaemonTuiServiceResolution,
  type TerminalTuiServiceLike,
} from "../cli/tui/service.js";
import { RUNTIME_CONFIG } from "../config/runtime-config.js";
import {
  InkTuiPreviewApp,
  buildInkTuiPreviewSnapshot,
  type InkTuiPreviewMessage,
} from "../terminal-ui/ink-tui.js";

export type InkTerminalTuiIo = {
  input: NodeJS.ReadableStream & { isTTY?: boolean };
  output: NodeJS.WritableStream;
  errorOutput?: NodeJS.WritableStream;
  service?: TerminalTuiServiceLike;
  resolveDaemonService?: () => Promise<DaemonTuiServiceResolution | null>;
};

async function readStdin(input: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export { createInkRuntimeController } from "../cli/ink/controller.js";

async function runScriptedInput(
  script: string,
  submit: (line: string) => Promise<{ messages: InkTuiPreviewMessage[]; exit: boolean }>,
): Promise<InkTuiPreviewMessage[]> {
  const messages: InkTuiPreviewMessage[] = [];
  for (const rawLine of script.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line === "q" || line === "exit" || line === "\u001b" || line === "\u0003") {
      break;
    }
    messages.push({ role: "user", marker: ">", text: rawLine, tone: "user" });
    const result = await submit(rawLine);
    messages.push(...result.messages);
    if (result.exit) {
      break;
    }
  }
  return messages;
}

/** Start the Ink/TSX terminal CLI surface. */
export async function runInkTerminalTui(input: InkTerminalTuiIo): Promise<void> {
  const runtime = await createTerminalRuntime(input);
  const controller = createInkRuntimeController(runtime);
  if (!input.input.isTTY) {
    const script = await readStdin(input.input);
    const extraMessages = await runScriptedInput(script, controller.submit);
    const app = render(
      <InkTuiPreviewApp
        snapshot={buildInkTuiPreviewSnapshot({ extraMessages })}
        interactive={false}
      />,
      {
        stdin: input.input as ReadStream,
        stdout: input.output as WriteStream,
        stderr: input.errorOutput as WriteStream | undefined,
        exitOnCtrlC: false,
      },
    );
    app.unmount();
    return;
  }

  const snapshot = buildInkTuiPreviewSnapshot();

  await new Promise<void>((resolve) => {
    let settled = false;
    const renderOptions: Parameters<typeof render>[1] = {
      // Ink's public types are TTY-specific, while the CLI dispatcher keeps IO injectable.
      stdin: input.input as ReadStream,
      stdout: input.output as WriteStream,
      exitOnCtrlC: false,
      alternateScreen: true,
    };
    if (input.errorOutput) {
      renderOptions.stderr = input.errorOutput as WriteStream;
    }
    const app = render(
      <InkTuiPreviewApp
        snapshot={snapshot}
        onSubmitInput={async (line) => {
          const result = await controller.submit(line);
          if (result.exit) {
            finish();
          }
          return result.messages;
        }}
        onScheduledTick={controller.runScheduledTick}
        schedulerIntervalMs={RUNTIME_CONFIG.schedulerPollIntervalMs}
        onExit={() => finish()}
      />,
      {
        ...renderOptions,
      },
    );

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      input.input.off("end", onEnd);
      app.unmount();
      resolve();
    };
    const onEnd = () => {
      if (!input.input.isTTY) {
        finish();
      }
    };

    input.input.on("end", onEnd);
    input.input.resume();
  });
}
