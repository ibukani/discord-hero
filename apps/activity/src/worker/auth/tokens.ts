import { DisplayNameSchema, RoomIdSchema, SafeIdSchema } from "@discord-hero/protocol";
import { z } from "zod";

const TOKEN_HEADER = { alg: "HS256", typ: "JWT" } as const;
const TokenHeaderSchema = z.object({
  alg: z.literal(TOKEN_HEADER.alg),
  typ: z.literal(TOKEN_HEADER.typ),
});
const SESSION_TTL_SECONDS = 60 * 60;
const ROOM_TICKET_TTL_SECONDS = 60;

const TokenTimeSchema = z.object({
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

const SessionClaimsSchema = TokenTimeSchema.extend({
  kind: z.literal("session"),
  sub: SafeIdSchema,
  displayName: DisplayNameSchema,
  roomId: RoomIdSchema,
});

const RoomTicketClaimsSchema = TokenTimeSchema.extend({
  kind: z.literal("room_ticket"),
  sub: SafeIdSchema,
  displayName: DisplayNameSchema,
  roomId: RoomIdSchema,
  nonce: SafeIdSchema,
});

export type SessionClaims = z.infer<typeof SessionClaimsSchema>;
export type RoomTicketClaims = z.infer<typeof RoomTicketClaimsSchema>;

type TokenClaims = SessionClaims | RoomTicketClaims;

export async function issueSessionToken(
  userId: string,
  displayName: string,
  roomId: string,
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const claims: SessionClaims = SessionClaimsSchema.parse({
    kind: "session",
    sub: userId,
    displayName,
    roomId,
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
  });
  return signToken(claims, secret);
}

export async function verifySessionToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<SessionClaims> {
  const payload = await verifyToken(token, secret);
  const claims = SessionClaimsSchema.parse(payload);
  assertNotExpired(claims.exp, now);
  return claims;
}

export async function issueRoomTicket(
  session: SessionClaims,
  roomId: string,
  secret: string,
  now: Date = new Date(),
): Promise<{ readonly token: string; readonly expiresAt: string }> {
  if (session.roomId !== roomId) {
    throw new TokenError("room_scope_mismatch");
  }
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const claims: RoomTicketClaims = RoomTicketClaimsSchema.parse({
    kind: "room_ticket",
    sub: session.sub,
    displayName: session.displayName,
    roomId,
    nonce: crypto.randomUUID(),
    iat: issuedAt,
    exp: issuedAt + ROOM_TICKET_TTL_SECONDS,
  });
  return {
    token: await signToken(claims, secret),
    expiresAt: new Date(claims.exp * 1_000).toISOString(),
  };
}

export async function verifyRoomTicket(
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<RoomTicketClaims> {
  const payload = await verifyToken(token, secret);
  const claims = RoomTicketClaimsSchema.parse(payload);
  assertNotExpired(claims.exp, now);
  return claims;
}

async function signToken(claims: TokenClaims, secret: string): Promise<string> {
  validateSecret(secret);
  const header = encodeJson(TOKEN_HEADER);
  const payload = encodeJson(claims);
  const signingInput = `${header}.${payload}`;
  const signature = await createSignature(signingInput, secret);
  return `${signingInput}.${signature}`;
}

async function verifyToken(token: string, secret: string): Promise<unknown> {
  validateSecret(secret);
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new TokenError("invalid_token");
  }
  const headerPart = parts[0];
  const payloadPart = parts[1];
  const signaturePart = parts[2];
  if (headerPart === undefined || payloadPart === undefined || signaturePart === undefined) {
    throw new TokenError("invalid_token");
  }

  const signingInput = `${headerPart}.${payloadPart}`;
  const valid = await verifySignature(signingInput, signaturePart, secret);
  if (!valid) {
    throw new TokenError("invalid_signature");
  }

  const header = decodeJson(headerPart);
  if (!isTokenHeader(header)) {
    throw new TokenError("invalid_header");
  }
  return decodeJson(payloadPart);
}

function assertNotExpired(expiration: number, now: Date): void {
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (expiration <= nowSeconds) {
    throw new TokenError("token_expired");
  }
}

function validateSecret(secret: string): void {
  if (secret.length < 32) {
    throw new TokenError("weak_signing_secret");
  }
}

function isTokenHeader(value: unknown): value is typeof TOKEN_HEADER {
  return TokenHeaderSchema.safeParse(value).success;
}

function encodeJson(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson(value: string): unknown {
  try {
    const decoded = new TextDecoder().decode(decodeBase64Url(value));
    return JSON.parse(decoded) as unknown;
  } catch {
    throw new TokenError("invalid_payload");
  }
}

async function createSignature(input: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return encodeBase64Url(new Uint8Array(signature));
}

async function verifySignature(input: string, signature: string, secret: string): Promise<boolean> {
  const key = await importHmacKey(secret, ["verify"]);
  return crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(signature),
    new TextEncoder().encode(input),
  );
}

function importHmacKey(secret: string, usages: readonly KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [...usages],
  );
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const paddingLength = (4 - (value.length % 4)) % 4;
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(paddingLength);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export class TokenError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "TokenError";
  }
}
