export function requestId(request: Request): string {
  const candidate = request.headers.get("cf-ray");
  return candidate !== null && /^[A-Za-z0-9-]{1,128}$/u.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

export function requestRouteLabel(request: Request): string {
  const path = new URL(request.url).pathname;
  if (path === "/api/health") {
    return "/api/health";
  }
  if (path === "/api/auth/discord/exchange") {
    return "/api/auth/discord/exchange";
  }
  if (path === "/api/auth/local") {
    return "/api/auth/local";
  }
  if (path === "/api/rooms/ticket") {
    return "/api/rooms/ticket";
  }
  if (/^\/api\/rooms\/[^/]+\/socket$/u.test(path)) {
    return "/api/rooms/:roomId/socket";
  }
  return path.startsWith("/api/") ? "/api/*" : "static_asset";
}

export function rateLimitKey(request: Request): string {
  const candidate = request.headers.get("cf-connecting-ip");
  const actor =
    candidate !== null && /^[0-9A-Fa-f:.]{3,64}$/u.test(candidate) ? candidate : "unknown";
  return `${requestRouteLabel(request)}:${actor}`;
}

export function requiresEntryRateLimit(request: Request): boolean {
  const route = requestRouteLabel(request);
  return request.method === "POST"
    ? route === "/api/auth/discord/exchange" ||
        route === "/api/auth/local" ||
        route === "/api/rooms/ticket"
    : request.method === "GET" && route === "/api/rooms/:roomId/socket";
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
