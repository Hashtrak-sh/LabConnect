import { isTransitionId, type TransitionId, TRANSITION_IDS } from '@labconnect/shared';
import type { ColumnContributor, TransitionEffect, TransitionGuard } from './types.js';

/** A transition id, several, or every transition. */
export type TransitionSelector = TransitionId | readonly TransitionId[] | 'ALL';

interface Entry<T> {
  readonly item: T;
  readonly ids: ReadonlySet<TransitionId>;
}

/**
 * The guards, effects and column contributors that features plug into the engine, per
 * transition. Registration order is execution order (for one transition, entries that match
 * it run in the order they were registered). A name can be registered once per kind, so
 * the same guard cannot be added twice by two modules by accident. An empty registry is a
 * valid engine: status, history, audit and event only.
 */
export class TransitionRegistry {
  private readonly guards: Entry<TransitionGuard>[] = [];
  private readonly effects: Entry<TransitionEffect>[] = [];
  private readonly columns: Entry<ColumnContributor>[] = [];

  addGuard(selector: TransitionSelector, guard: TransitionGuard): this {
    return this.add(this.guards, 'guard', selector, guard);
  }

  addEffect(selector: TransitionSelector, effect: TransitionEffect): this {
    return this.add(this.effects, 'effect', selector, effect);
  }

  addColumns(selector: TransitionSelector, contributor: ColumnContributor): this {
    return this.add(this.columns, 'column contributor', selector, contributor);
  }

  guardsFor(id: TransitionId): TransitionGuard[] {
    return this.matching(this.guards, id);
  }

  effectsFor(id: TransitionId): TransitionEffect[] {
    return this.matching(this.effects, id);
  }

  columnsFor(id: TransitionId): ColumnContributor[] {
    return this.matching(this.columns, id);
  }

  private add<T extends { name: string }>(
    list: Entry<T>[],
    kind: string,
    selector: TransitionSelector,
    item: T,
  ): this {
    if (item.name.trim().length === 0) throw new Error(`A ${kind} needs a name.`);
    if (list.some((entry) => entry.item.name === item.name)) {
      throw new Error(`A ${kind} named "${item.name}" is already registered.`);
    }
    const ids = resolve(selector);
    if (ids.size === 0) throw new Error(`The ${kind} "${item.name}" names no transition.`);
    list.push({ item, ids });
    return this;
  }

  private matching<T>(list: readonly Entry<T>[], id: TransitionId): T[] {
    return list.filter((entry) => entry.ids.has(id)).map((entry) => entry.item);
  }
}

function resolve(selector: TransitionSelector): Set<TransitionId> {
  if (selector === 'ALL') return new Set(TRANSITION_IDS);
  const list = typeof selector === 'string' ? [selector] : selector;
  for (const id of list) {
    if (!isTransitionId(id)) throw new Error(`"${String(id)}" is not a transition id.`);
  }
  return new Set(list);
}
