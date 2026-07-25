import { z } from "zod";

const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function postJson<Output>(
  path: string,
  body: unknown,
  schema: z.ZodType<Output>,
  bearerToken?: string,
): Promise<Output> {
  const headers = new Headers({
    "content-type": "application/json",
  });
  if (bearerToken !== undefined) {
    headers.set("authorization", `Bearer ${bearerToken}`);
  }

  const response = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await readResponseJson(response);
  if (!response.ok) {
    const parsedError = ApiErrorSchema.safeParse(payload);
    if (parsedError.success) {
      throw new ApiError(
        response.status,
        parsedError.data.error.code,
        parsedError.data.error.message,
        parsedError.data.error.requestId,
      );
    }
    throw new ApiError(response.status, "unknown_error", "Request failed", null);
  }
  return schema.parse(payload);
}

async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(response.status, "invalid_response", "Invalid server response", null);
  }
}
