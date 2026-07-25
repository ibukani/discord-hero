import { readFile } from "node:fs/promises";
import { parse, printParseErrorCode } from "jsonc-parser";

const REQUIRED_SECRETS = new Set(["DISCORD_CLIENT_SECRET", "SESSION_SIGNING_SECRET"]);

export async function readWranglerConfig(path) {
  const source = await readFile(path, "utf8");
  const errors = [];
  const value = parse(source, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const summary = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(", ");
    throw new Error(`Invalid Wrangler JSONC: ${summary}`);
  }
  return value;
}

export function validateDeploymentConfig(config, environment, viteDiscordClientId) {
  if (environment !== "staging" && environment !== "production") {
    return ["environment must be staging or production"];
  }
  if (!isRecord(config)) {
    return ["Wrangler config root must be an object"];
  }

  const violations = [];
  validateTopLevelWorkerConfig(config, violations);
  const environmentConfig = recordProperty(config, "env", violations, "env");
  const target = recordProperty(environmentConfig, environment, violations, `env.${environment}`);
  const variables = recordProperty(target, "vars", violations, `env.${environment}.vars`);
  const appEnvironment = stringProperty(
    variables,
    "APP_ENV",
    violations,
    `env.${environment}.vars.APP_ENV`,
  );
  const allowLocalAuth = stringProperty(
    variables,
    "ALLOW_LOCAL_AUTH",
    violations,
    `env.${environment}.vars.ALLOW_LOCAL_AUTH`,
  );
  const discordClientId = stringProperty(
    variables,
    "DISCORD_CLIENT_ID",
    violations,
    `env.${environment}.vars.DISCORD_CLIENT_ID`,
  );

  if (appEnvironment !== null && appEnvironment !== environment) {
    violations.push(`APP_ENV must equal ${environment}`);
  }
  if (allowLocalAuth !== null && allowLocalAuth !== "false") {
    violations.push("ALLOW_LOCAL_AUTH must be false outside local mode");
  }
  if (discordClientId !== null && !/^\d{17,20}$/u.test(discordClientId)) {
    violations.push("DISCORD_CLIENT_ID must be a configured Discord snowflake");
  }
  if (!/^\d{17,20}$/u.test(viteDiscordClientId)) {
    violations.push("VITE_DISCORD_CLIENT_ID must be a configured Discord snowflake");
  } else if (discordClientId !== null && viteDiscordClientId !== discordClientId) {
    violations.push("VITE_DISCORD_CLIENT_ID must match the Worker DISCORD_CLIENT_ID");
  }

  validateSecrets(target, environment, violations);
  validateDurableObjectBinding(target, environment, violations);
  validateD1Binding(target, environment, violations);
  validateRateLimitBinding(target, environment, violations);
  validateQueueBindings(target, environment, violations);

  const workerName = stringProperty(target, "name", violations, `env.${environment}.name`);
  if (workerName !== null && (hasPlaceholder(workerName) || !workerName.includes(environment))) {
    violations.push(`Worker name must be configured for ${environment}`);
  }

  return [...new Set(violations)];
}

function validateTopLevelWorkerConfig(config, violations) {
  const flags = Array.isArray(config.compatibility_flags) ? config.compatibility_flags : [];
  if (!flags.includes("nodejs_compat")) {
    violations.push("compatibility_flags must include nodejs_compat");
  }

  const observability = isRecord(config.observability) ? config.observability : {};
  const traces = isRecord(observability.traces) ? observability.traces : {};
  if (observability.enabled !== true || traces.enabled !== true) {
    violations.push("Workers logs and traces must be enabled");
  }

  const exportsConfig = isRecord(config.exports) ? config.exports : {};
  const gameRoom = isRecord(exportsConfig.GameRoom) ? exportsConfig.GameRoom : {};
  if (gameRoom.type !== "durable-object" || gameRoom.storage !== "sqlite") {
    violations.push("GameRoom must be declared as a SQLite Durable Object export");
  }
}

function validateRateLimitBinding(target, environment, violations) {
  const rateLimits = arrayProperty(
    target,
    "ratelimits",
    violations,
    `env.${environment}.ratelimits`,
  );
  const binding = rateLimits.find(
    (candidate) => isRecord(candidate) && candidate.name === "AUTH_RATE_LIMITER",
  );
  if (!isRecord(binding)) {
    violations.push("AUTH_RATE_LIMITER binding is missing");
    return;
  }
  if (typeof binding.namespace_id !== "string" || !/^[1-9]\d*$/u.test(binding.namespace_id)) {
    violations.push("AUTH_RATE_LIMITER namespace_id must be a positive integer string");
  }
  const simple = isRecord(binding.simple) ? binding.simple : {};
  if (
    typeof simple.limit !== "number" ||
    !Number.isInteger(simple.limit) ||
    simple.limit <= 0 ||
    (simple.period !== 10 && simple.period !== 60)
  ) {
    violations.push("AUTH_RATE_LIMITER must define a positive limit and a 10s or 60s period");
  }
}

export function validateRemoteSecrets(value) {
  if (!Array.isArray(value)) {
    return ["Wrangler secret list must return an array"];
  }
  const names = new Set(
    value.flatMap((entry) =>
      isRecord(entry) && typeof entry.name === "string" ? [entry.name] : [],
    ),
  );
  return [...REQUIRED_SECRETS]
    .filter((secret) => !names.has(secret))
    .map((secret) => `Remote Worker secret is missing: ${secret}`);
}

function validateSecrets(target, environment, violations) {
  const secrets = recordProperty(target, "secrets", violations, `env.${environment}.secrets`);
  const required = arrayProperty(
    secrets,
    "required",
    violations,
    `env.${environment}.secrets.required`,
  );
  const names = new Set(required.filter((value) => typeof value === "string"));
  for (const secret of REQUIRED_SECRETS) {
    if (!names.has(secret)) {
      violations.push(`Required secret declaration is missing: ${secret}`);
    }
  }
}

function validateDurableObjectBinding(target, environment, violations) {
  const durableObjects = recordProperty(
    target,
    "durable_objects",
    violations,
    `env.${environment}.durable_objects`,
  );
  const bindings = arrayProperty(
    durableObjects,
    "bindings",
    violations,
    `env.${environment}.durable_objects.bindings`,
  );
  const valid = bindings.some(
    (binding) =>
      isRecord(binding) && binding.name === "GAME_ROOMS" && binding.class_name === "GameRoom",
  );
  if (!valid) {
    violations.push("GAME_ROOMS must bind to the GameRoom Durable Object");
  }
}

function validateD1Binding(target, environment, violations) {
  const databases = arrayProperty(
    target,
    "d1_databases",
    violations,
    `env.${environment}.d1_databases`,
  );
  const binding = databases.find((database) => isRecord(database) && database.binding === "DB");
  if (!isRecord(binding)) {
    violations.push("D1 binding DB is missing");
    return;
  }
  const id = typeof binding.database_id === "string" ? binding.database_id : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id) ||
    /^0+(-0+){4}$/u.test(id)
  ) {
    violations.push("D1 database_id must be a non-placeholder UUID");
  }
  const name = typeof binding.database_name === "string" ? binding.database_name : "";
  if (hasPlaceholder(name) || !name.includes(environment)) {
    violations.push(`D1 database_name must be configured for ${environment}`);
  }
}

function validateQueueBindings(target, environment, violations) {
  const queues = recordProperty(target, "queues", violations, `env.${environment}.queues`);
  const producers = arrayProperty(
    queues,
    "producers",
    violations,
    `env.${environment}.queues.producers`,
  );
  const consumers = arrayProperty(
    queues,
    "consumers",
    violations,
    `env.${environment}.queues.consumers`,
  );
  const producer = producers.find(
    (candidate) => isRecord(candidate) && candidate.binding === "MATCH_RESULTS_QUEUE",
  );
  const queueName = isRecord(producer) && typeof producer.queue === "string" ? producer.queue : "";
  if (queueName.length === 0 || hasPlaceholder(queueName) || !queueName.includes(environment)) {
    violations.push(`MATCH_RESULTS_QUEUE must be configured for ${environment}`);
  }
  const consumer = consumers.find(
    (candidate) => isRecord(candidate) && candidate.queue === queueName,
  );
  if (!isRecord(consumer)) {
    violations.push("Queue consumer must target the MATCH_RESULTS_QUEUE queue");
    return;
  }
  const deadLetterQueue =
    typeof consumer.dead_letter_queue === "string" ? consumer.dead_letter_queue : "";
  if (
    deadLetterQueue.length === 0 ||
    hasPlaceholder(deadLetterQueue) ||
    !deadLetterQueue.includes(environment)
  ) {
    violations.push(`Queue dead-letter target must be configured for ${environment}`);
  }
}

function recordProperty(value, property, violations, label) {
  const candidate = isRecord(value) ? value[property] : undefined;
  if (!isRecord(candidate)) {
    violations.push(`${label} must be an object`);
    return {};
  }
  return candidate;
}

function arrayProperty(value, property, violations, label) {
  const candidate = isRecord(value) ? value[property] : undefined;
  if (!Array.isArray(candidate)) {
    violations.push(`${label} must be an array`);
    return [];
  }
  return candidate;
}

function stringProperty(value, property, violations, label) {
  const candidate = isRecord(value) ? value[property] : undefined;
  if (typeof candidate !== "string" || candidate.length === 0) {
    violations.push(`${label} must be a non-empty string`);
    return null;
  }
  return candidate;
}

function hasPlaceholder(value) {
  return /(?:replace[_-]?with|placeholder|change[_-]?me)/iu.test(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
