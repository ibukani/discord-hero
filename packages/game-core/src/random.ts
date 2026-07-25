function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    const codePoint = seed.charCodeAt(index);
    hash ^= codePoint;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x9e3779b9;
}

export function initialRandomState(seed: string): number {
  return hashSeed(seed);
}

export interface RandomResult {
  readonly value: number;
  readonly state: number;
}

export function nextRandom(state: number): RandomResult {
  let next = state >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  const normalized = (next >>> 0) / 0x1_0000_0000;
  return { value: normalized, state: next >>> 0 };
}
