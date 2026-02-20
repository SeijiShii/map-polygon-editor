import type { AreaLevel } from "../types/index.js";

export class InvalidAreaLevelConfigError extends Error {
  override name = "InvalidAreaLevelConfigError" as const;

  constructor(message: string) {
    super(message);
    // Restore prototype chain (needed when targeting ES5/CommonJS)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Validates a set of AreaLevel definitions.
 *
 * Rules enforced:
 * 1. No duplicate keys
 * 2. Every non-null parent_level_key must reference an existing key
 * 3. No circular references
 * 4. Linear hierarchy constraint — each parent may be referenced by at most
 *    one child (including null, which may only appear once)
 *
 * @throws {InvalidAreaLevelConfigError}
 */
export function validateAreaLevels(levels: AreaLevel[]): void {
  if (levels.length === 0) return;

  const keySet = new Set<string>();

  // --- Rule 1: no duplicate keys ---
  for (const level of levels) {
    if (keySet.has(level.key)) {
      throw new InvalidAreaLevelConfigError(
        `Duplicate AreaLevel key: "${level.key}"`
      );
    }
    keySet.add(level.key);
  }

  // --- Rule 2: parent_level_key must exist ---
  for (const level of levels) {
    if (
      level.parent_level_key !== null &&
      !keySet.has(level.parent_level_key)
    ) {
      throw new InvalidAreaLevelConfigError(
        `AreaLevel "${level.key}" references nonexistent parent_level_key: "${level.parent_level_key}"`
      );
    }
  }

  // --- Rule 4: linear hierarchy — each parent_level_key value appears at most once ---
  // This covers both the "two children with the same parent" case and
  // the "two root levels (null)" case, because null is also a parent key value.
  const parentKeyCount = new Map<string | null, number>();
  for (const level of levels) {
    const count = parentKeyCount.get(level.parent_level_key) ?? 0;
    parentKeyCount.set(level.parent_level_key, count + 1);
  }
  for (const [parentKey, count] of parentKeyCount) {
    if (count > 1) {
      const label =
        parentKey === null ? "null (multiple root levels)" : `"${parentKey}"`;
      throw new InvalidAreaLevelConfigError(
        `Multiple AreaLevels share the same parent_level_key: ${label}. The hierarchy must be linear (each parent has at most one child level).`
      );
    }
  }

  // --- Rule 3: no circular references ---
  // Build a map from key → parent_level_key for DFS cycle detection
  const parentOf = new Map<string, string | null>();
  for (const level of levels) {
    parentOf.set(level.key, level.parent_level_key);
  }

  // For each node, walk up the chain; if we revisit the same node, it's a cycle.
  for (const level of levels) {
    const visited = new Set<string>();
    let current: string | null = level.key;

    while (current !== null) {
      if (visited.has(current)) {
        throw new InvalidAreaLevelConfigError(
          `Circular reference detected in AreaLevel hierarchy involving key: "${current}"`
        );
      }
      visited.add(current);
      current = parentOf.get(current) ?? null;
    }
  }
}
