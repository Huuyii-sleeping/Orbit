import type { Writable } from "node:stream";

/** 等待缓冲区排空或连接关闭；关闭时不会永久等待 drain。 */
export async function writeStreamChunk(res: Pick<Writable, "destroyed" | "writableEnded" | "write" | "once" | "off">, chunk: string | Uint8Array): Promise<boolean> {
  if (res.destroyed || res.writableEnded) return false;
  if (res.write(chunk)) return true;
  return new Promise<boolean>((resolve, reject) => {
    const cleanup = () => { res.off("drain", drain); res.off("close", close); res.off("error", error); };
    const drain = () => { cleanup(); resolve(true); };
    const close = () => { cleanup(); resolve(false); };
    const error = (cause: Error) => { cleanup(); reject(cause); };
    res.once("drain", drain);
    res.once("close", close);
    res.once("error", error);
    if (res.destroyed || res.writableEnded) close();
  });
}
