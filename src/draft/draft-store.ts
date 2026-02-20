import type { DraftID, PersistedDraft } from "../types/index.js";

/**
 * In-memory store for PersistedDraft entities.
 *
 * Provides:
 * - `getAll()` — all stored drafts (in insertion/upsert order)
 * - `get(id)` — single draft by ID or null
 * - `save(draft)` — insert or update (upsert) by ID
 * - `delete(id)` — remove by ID (no-op if not found)
 */
export class DraftStore {
  /**
   * We use a Map to preserve insertion order while enabling O(1) lookup.
   * The map is keyed by DraftID (which is a branded string).
   */
  private readonly drafts: Map<DraftID, PersistedDraft>;

  constructor(initial: PersistedDraft[]) {
    this.drafts = new Map();
    for (const draft of initial) {
      this.drafts.set(draft.id, draft);
    }
  }

  // ---- query API ----

  /**
   * Returns all stored drafts in insertion order.
   * Returns a defensive copy — mutations to the returned array do not
   * affect the store.
   */
  getAll(): PersistedDraft[] {
    return Array.from(this.drafts.values());
  }

  /**
   * Returns the PersistedDraft with the given ID, or null if not found.
   */
  get(id: DraftID): PersistedDraft | null {
    return this.drafts.get(id) ?? null;
  }

  // ---- mutation API ----

  /**
   * Inserts or updates (upserts) a draft.
   * If a draft with the same ID already exists it is replaced in-place
   * (Map.set preserves the insertion position for existing keys).
   */
  save(draft: PersistedDraft): void {
    this.drafts.set(draft.id, draft);
  }

  /**
   * Removes the draft with the given ID.
   * Is a no-op if the ID is not found.
   */
  delete(id: DraftID): void {
    this.drafts.delete(id);
  }
}
