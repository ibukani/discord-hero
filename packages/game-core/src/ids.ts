type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type MatchId = Brand<string, "MatchId">;
export type PlayerId = Brand<string, "PlayerId">;
export type EnemyId = Brand<string, "EnemyId">;
export type ActionId = Brand<string, "ActionId">;

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

function validateId(value: string, label: string): string {
  if (!ID_PATTERN.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function matchId(value: string): MatchId {
  return validateId(value, "matchId") as MatchId;
}

export function playerId(value: string): PlayerId {
  return validateId(value, "playerId") as PlayerId;
}

export function enemyId(value: string): EnemyId {
  return validateId(value, "enemyId") as EnemyId;
}

export function actionId(value: string): ActionId {
  return validateId(value, "actionId") as ActionId;
}
