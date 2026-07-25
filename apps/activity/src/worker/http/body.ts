const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

export async function readJsonBody(
  request: Request,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new HttpBodyError("request_body_too_large");
    }
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new HttpBodyError("request_body_too_large");
  }
  if (text.length === 0) {
    throw new HttpBodyError("request_body_required");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpBodyError("invalid_json");
  }
}

export class HttpBodyError extends Error {
  public constructor(
    public readonly code: "request_body_too_large" | "request_body_required" | "invalid_json",
  ) {
    super(code);
    this.name = "HttpBodyError";
  }
}
