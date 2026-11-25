import { TRANSITION_IDS, type TransitionId } from '@labconnect/shared';
import { describe, expect, it } from 'vitest';
import { TransitionRegistry } from './registry.js';
import type { TransitionEffect, TransitionGuard } from './types.js';

const guard = (name: string): TransitionGuard => ({ name, run: () => undefined });
const effect = (name: string): TransitionEffect => ({ name, run: () => undefined });

describe('TransitionRegistry', () => {
  it('is empty by default', () => {
    const registry = new TransitionRegistry();
    for (const id of TRANSITION_IDS) {
      expect(registry.guardsFor(id)).toEqual([]);
      expect(registry.effectsFor(id)).toEqual([]);
      expect(registry.columnsFor(id)).toEqual([]);
    }
  });

  it('returns the entries of a transition in registration order, mixing single, list and ALL', () => {
    const [a, b, c, d] = [guard('a'), guard('b'), guard('c'), guard('d')];
    const registry = new TransitionRegistry()
      .addGuard('T-03', a)
      .addGuard(['T-03', 'T-05'], b)
      .addGuard('ALL', c)
      .addGuard('T-05', d);
    expect(registry.guardsFor('T-03')).toEqual([a, b, c]);
    expect(registry.guardsFor('T-05')).toEqual([b, c, d]);
    expect(registry.guardsFor('T-09')).toEqual([c]);
  });

  it('keeps guards, effects and column contributors apart', () => {
    const registry = new TransitionRegistry()
      .addGuard('T-03', guard('x'))
      .addEffect('T-03', effect('x'))
      .addColumns('T-03', { name: 'x', build: () => ({}) });
    expect(registry.guardsFor('T-03')).toHaveLength(1);
    expect(registry.effectsFor('T-03')).toHaveLength(1);
    expect(registry.columnsFor('T-03')).toHaveLength(1);
  });

  it('refuses a duplicate name per kind, whichever transition it is for', () => {
    const registry = new TransitionRegistry().addGuard('T-03', guard('same'));
    expect(() => registry.addGuard('T-05', guard('same'))).toThrow(/already registered/);
    expect(() => registry.addEffect('T-03', effect('e')).addEffect('T-05', effect('e'))).toThrow(
      /already registered/,
    );
    expect(() =>
      registry
        .addColumns('T-03', { name: 'c', build: () => ({}) })
        .addColumns('T-04', { name: 'c', build: () => ({}) }),
    ).toThrow(/already registered/);
  });

  it('refuses an empty name, an empty selection and an unknown transition id', () => {
    const registry = new TransitionRegistry();
    expect(() => registry.addGuard('T-03', guard('  '))).toThrow(/needs a name/);
    expect(() => registry.addGuard([], guard('g'))).toThrow(/names no transition/);
    const unknown = 'T-99';
    expect(() => registry.addGuard([unknown as TransitionId], guard('g'))).toThrow(
      /not a transition id/,
    );
  });
});
