import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";

/** 只给隔离浏览器验收提供已构建的静态文件；生产使用正式同源网关。 */
export function createStaticWebFixture() {
  const root = resolve(fileURLToPath(new URL("../../../web-console/dist/", import.meta.url)));
  const types = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".html": "text/html", ".woff2": "font/woff2" };
  return createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const path = pathname.startsWith("/assets/") ? resolve(root, `.${pathname}`) : resolve(root, "index.html");
      if (!path.startsWith(root + sep)) { res.writeHead(404); res.end(); return; }
      const body = await readFile(path);
      res.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
}
