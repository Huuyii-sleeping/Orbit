import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { request } from "node:http";

/** 仅用于隔离验收：TLS 终止后转发到本轮创建的 HTTP 服务，不作为生产代理。 */
export async function createTestHttpsProxy(keyPath, certPath, upstream) {
  return createServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (incoming, outgoing) => {
    const baseURL = upstream(incoming.url ?? "/");
    if (!baseURL) { outgoing.writeHead(503); outgoing.end(); return; }
    const target = new URL(incoming.url ?? "/", baseURL);
    const forwarded = request(target, { method: incoming.method, headers: {
      ...incoming.headers, host: target.host,
      "x-forwarded-proto": "https", "x-forwarded-host": incoming.headers.host,
      "x-forwarded-port": String(incoming.socket.localPort), "x-forwarded-for": incoming.socket.remoteAddress,
    } }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.once("aborted", () => outgoing.destroy());
      response.once("error", () => outgoing.destroy());
      response.pipe(outgoing);
    });
    forwarded.on("error", () => {
      if (outgoing.destroyed) return;
      if (outgoing.headersSent) outgoing.destroy();
      else { outgoing.writeHead(502); outgoing.end(); }
    });
    outgoing.once("close", () => forwarded.destroy());
    incoming.pipe(forwarded);
  });
}
