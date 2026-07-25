# AGENTS.md

## Purpose

This repository contains a production-oriented Discord Activity for a cooperative, semi-idle roguelite RPG. The same game rules must run in local standalone development and in Cloudflare Durable Objects in production.

## Non-negotiable engineering rules

1. Preserve strict type safety.
   - Do not introduce explicit `any` types.
   - Do not use `@ts-ignore` or `@ts-nocheck`.
   - Treat data from HTTP, WebSocket, Discord, D1, Queue, environment variables, and persisted snapshots as `unknown` until validated.
   - Prefer discriminated unions, exhaustive switches, branded identifiers, and schema-derived types.
   - Do not use unsafe type assertions to bypass a missing model. Narrow or validate instead.

2. Keep the game core platform-independent.
   - `packages/game-core` must not import React, PixiJS, Discord SDK, Cloudflare APIs, WebSocket APIs, D1 APIs, or environment variables.
   - Do not call `Date.now()` or `Math.random()` in game rules.
   - Time, randomness, identifiers, and content must enter through explicit inputs.
   - Equal state, command sequence, elapsed time, ruleset, and random seed must produce equal results.

3. Keep the server authoritative.
   - Clients send intent, never trusted outcomes.
   - Damage, healing, cooldowns, enemy behavior, drops, progression, victory, defeat, and rewards are calculated on the server.
   - Reject commands that are invalid for the current match state or player state.

4. Validate every boundary.
   - Use the schemas in `packages/protocol` for WebSocket and HTTP payloads.
   - Validate Durable Object snapshots before restoring them.
   - Validate Queue messages before writing to D1.
   - Keep protocol schemas and inferred TypeScript types in the same module.

5. Preserve dependency direction.
   - `game-core` depends on no application or infrastructure package.
   - `content` may depend on public types from `game-core`.
   - `protocol` is transport-focused and must not import client or worker code.
   - Client and worker code may depend on `game-core`, `content`, and `protocol`.
   - Do not create circular workspace dependencies.

6. Keep local and production behavior aligned.
   - Local mode may replace identity and Discord context, but not game rules or transport message shapes.
   - Production-only secrets must never be exposed through Vite variables.
   - Local authentication routes must remain impossible to enable in staging or production by configuration mistakes.

7. Make persistence idempotent.
   - Match completion events require stable `eventId` and `matchId` values.
   - Queue consumers must tolerate retries and duplicate delivery.
   - D1 writes spanning multiple related tables must run in a batch or transaction-compatible operation.

8. Handle failures explicitly.
   - Catch values are `unknown`; normalize them with shared error helpers.
   - Client-visible errors use stable codes and safe messages.
   - Logs may contain internal diagnostics but must not contain Discord access tokens, session tokens, room tickets, client secrets, or raw authorization codes.

## Repository conventions

- Runtime source files use TypeScript.
- Use `import type` for type-only imports.
- Prefer small modules with one clear responsibility.
- Public package APIs are exported through each package's `src/index.ts`.
- Use named exports. Default exports are reserved for framework-required entry points.
- Use ISO 8601 UTC strings at persistence boundaries.
- Use integer milliseconds for simulation time.
- Use semantic, stable identifiers such as `mage.arc_burst`, not display labels.
- User-visible Japanese text belongs in the client presentation layer, not in game rules.

## Commands

Before completing an AI-authored change, run:

```bash
npm run agent:task -- <task-id>
npm run agent:verify -- .ai/tasks/<task-id>.json
```

For human-authored changes without a task contract, run:

```bash
npm run check
```

Focused commands:

```bash
npm run check:no-any
npm run check:dependencies
npm run check:cf-types
npm run check:architecture
npm run check:task-contract
npm run check:task-scope
npm run check:repo-map
npm run agent:smoke
npm run agent:harness:self-test
npm run assets:validate
npm run assets:prepare:local
npm run lint
npm run typecheck
npm run test
npm run build
npm run deploy:preflight -- staging
npm run deploy:preflight -- production
```

Local database and Cloudflare environment types:

```bash
npm run db:migrate:local
```

```bash
npm run cf:typegen
```

## Tests required by change type

- Game rule change: deterministic unit tests in `packages/game-core`.
- Protocol change: valid and invalid payload tests in `packages/protocol`.
- Durable Object change: worker-runtime integration tests, including reconnect or restore behavior when applicable.
- Persistence change: migration plus duplicate-event test.
- Client state change: reducer or component behavior test.
- Security-sensitive change: rejection-path tests, not only successful-path tests.

## Protocol compatibility

- `protocolVersion` changes only for incompatible wire changes.
- New optional fields may remain within the current protocol version when old clients can safely ignore them.
- A server must reject unsupported versions with `unsupported_protocol`.
- Never silently reinterpret an existing field.

## Durable Object rules

- One canonical room key maps to one `GameRoom` Durable Object.
- Use WebSocket Hibernation APIs for accepted sockets.
- Restore per-connection identity from validated WebSocket attachments after hibernation.
- Active combat may keep a timer running; lobby and decision states should be hibernation-eligible.
- Durable Object memory is a cache. Persist checkpoints needed to recover after eviction or restart.
- Do not write a snapshot every simulation tick.
- Do not perform D1 writes from the combat tick loop.

## Asset rules

- Every runtime asset must be declared by `assets/packs/<pack-id>/asset-pack.json` and referenced by a stable logical ID.
- Do not hard-code source archive paths or hashed output names in client code. Read the generated catalog through `@discord-hero/assets`.
- Put project-owned or explicitly redistributable files in `assets/repository`. Use `assets/repository-lfs` for large redistributable files.
- Put purchased, private, unknown-license, or redistribution-restricted files in `.local/assets`; never force-add them to Git.
- `apps/activity/public/assets/generated` is deterministic build output and must not be tracked.
- Record license, redistribution, modification, attribution, repository policy, and deployment policy accurately. Unknown terms use the conservative `forbidden` repository policy.
- Asset pack additions require `npm run assets:validate` and the relevant `assets:prepare:<environment>` command.
- Optional packs must have a safe runtime fallback. Required packs must fail the build when unavailable.
- Remote archives require an immutable SHA-256. External delivery should use content-versioned URLs.

## Security review checklist

- Is every external value validated?
- Can a user impersonate another player?
- Can a command be replayed?
- Can an invalid room identifier reach a Durable Object?
- Can a local-only route be enabled outside local mode?
- Does a log expose a credential or stable personal identifier?
- Is a token short-lived and scoped to its purpose?
- Are rate and payload limits enforced?
- Is a duplicate Queue event harmless?

## Deployment safeguards

- Generate and commit `package-lock.json` before deploying.
- Use the pinned Node.js/npm toolchain and keep npm install-script approvals version-specific.
- Staging and production workflows must use `npm ci`.
- Production deploys require a protected GitHub Environment or equivalent approval control.
- Review D1 migrations separately from application code and preserve backward compatibility during rollout.
- Never deploy with placeholder resource IDs or Discord Client IDs.
- Run deployment preflight before D1 migrations or Worker uploads.

## Documentation policy

Update documentation when behavior, architecture, protocol, environment configuration, persistence schema, or operational assumptions change. Do not add speculative claims that are not represented in code or clearly labeled as target behavior.

## AI task contract

- AI-authored repository changes should have a task file derived from `.ai/task.template.json`.
- The task must define concrete acceptance criteria and verification commands.
- `allowedPaths` and `forbiddenPaths` are enforced against the current git working tree during `agent:verify`.
- CI must also pass a base revision so committed changes in a clean checkout remain in scope.
- Do not broaden allowed paths merely to make verification pass; update the task only when the scope genuinely changes.
- The generated `.ai/REPOSITORY_MAP.md` must remain synchronized with package metadata.
- Review `.artifacts/agent/verification.md` before declaring the task complete.
