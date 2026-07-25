export function requestId(request: Request): string {
  return request.headers.get("cf-ray") ?? crypto.randomUUID();
}

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization === null) {
    return null;
  }
  const [scheme, token, extra] = authorization.split(" ");
  if (scheme !== "Bearer" || token === undefined || extra !== undefined || token.length === 0) {
    return null;
  }
  return token;
}

export function isLocalHost(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
