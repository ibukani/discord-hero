import type { ErrorCode } from "@discord-hero/protocol";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

export function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [name, headerValue] of Object.entries(JSON_HEADERS)) {
    headers.set(name, headerValue);
  }
  return new Response(JSON.stringify(value), { ...init, headers });
}

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  requestId: string,
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        requestId,
      },
    },
    { status },
  );
}

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), geolocation=(), payment=()");
  headers.set(
    "content-security-policy",
    "default-src 'self'; img-src 'self' data: https://cdn.discordapp.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' wss: https://discord.com https://*.discord.com; frame-ancestors https://discord.com https://*.discord.com",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
