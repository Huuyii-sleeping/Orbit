/** 只允许无 userinfo 的同源 HTTP(S) endpoint，避免 manifest 将凭据导向其他服务。 */
export function resolveServiceEndpoint(pathname: string, baseUrl: string) {
  const base = new URL(baseUrl);
  const endpoint = new URL(pathname, base);
  if (!(["http:", "https:"].includes(base.protocol)) || base.username || base.password
    || endpoint.origin !== base.origin || endpoint.username || endpoint.password) {
    throw new Error("Agent service endpoint must be a same-origin HTTP(S) URL without credentials");
  }
  return endpoint;
}
