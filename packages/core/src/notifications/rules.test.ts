import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_EVENT_TYPES } from '../platform/routes.js';
import {
  channelsOf,
  deliveryDecision,
  type DeliveryChannel,
  NOTIFICATION_RULES,
  type Party,
  rulesCoverEveryEvent,
} from './rules.js';

const matrix = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../docs/01-product/NOTIFICATIONS_MATRIX.md',
  ),
  'utf8',
);

const PARTY_COLUMNS: readonly (readonly [number, Party])[] = [
  [3, 'CUSTOMER'],
  [4, 'LAB_MAKER'],
  [5, 'LAB_CHECKER'],
  [6, 'OPS'],
];
const LETTER: Record<string, DeliveryChannel> = { I: 'IN_APP', E: 'EMAIL' };

interface Cell {
  channels: DeliveryChannel[];
  bold: boolean;
}

function parseCell(raw: string): Cell | null {
  if (raw === '—') return null;
  const letters = /\(([IE](?:,[IE])*)\)/.exec(raw)?.[1];
  // "Overdue list" (handover.overdue, Ops) names no channel: an Ops list is an in-app view.
  const channels = (letters ? letters.split(',') : ['I']).map(
    (letter) => LETTER[letter] ?? 'IN_APP',
  );
  return { channels: channels.sort(), bold: raw.includes('**') };
}

interface MatrixRow {
  codes: string[];
  cells: Map<Party, Cell>;
  mvp: DeliveryChannel[];
}

function parseMatrix(): MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (const line of matrix.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    const codes = cells[1]?.match(/`([a-z_.]+)`/g)?.map((code) => code.replaceAll('`', ''));
    if (!codes || cells.length < 9) continue;
    const parties = new Map<Party, Cell>();
    for (const [column, party] of PARTY_COLUMNS) {
      const parsed = parseCell(cells[column] ?? '');
      if (parsed) parties.set(party, parsed);
    }
    const mvp = (cells[7] ?? '')
      .split(',')
      .map((letter) => LETTER[letter.trim()] ?? 'IN_APP')
      .sort();
    rows.push({ codes, cells: parties, mvp });
  }
  return rows;
}

describe('the recipient rules against NOTIFICATIONS_MATRIX.md', () => {
  const rows = parseMatrix();

  it('read the whole matrix', () => {
    expect(rows.length).toBe(34);
  });

  it('have a rule set for every notification event and for no other code', () => {
    expect(rulesCoverEveryEvent()).toBe(true);
    const inMatrix = rows.flatMap((row) => row.codes).filter((code) => code !== 'auth.otp');
    expect(inMatrix.sort()).toEqual([...NOTIFICATION_EVENT_TYPES].sort());
  });

  for (const row of rows) {
    for (const code of row.codes) {
      if (code === 'auth.otp') continue; // never an outbox event (OQ-65)
      it(`${code}: channels, parties and action-required match the matrix`, () => {
        const rules = NOTIFICATION_RULES[code] ?? [];
        expect(channelsOf(code)).toEqual(row.mvp);

        if (code === 'user.invited') {
          // Three identical "Invite (E)" cells: one rule for the invited user. Not muteable (OQ-142).
          expect(rules).toHaveLength(1);
          expect(rules[0]).toMatchObject({ party: 'INVITEE', channels: ['EMAIL'] });
          return;
        }
        const shared = row.codes.length > 1;
        for (const [, party] of PARTY_COLUMNS) {
          const cell = row.cells.get(party);
          const rule = rules.find((candidate) => candidate.party === party);
          if (!cell) {
            expect(
              rule,
              `${code} has a rule for ${party} that the matrix does not`,
            ).toBeUndefined();
            continue;
          }
          if (!rule) {
            // A row that holds two codes may give one party's cell to only one of them.
            expect(shared, `${code} lacks a rule for ${party}`).toBe(true);
            continue;
          }
          expect([...rule.channels].sort(), `${code} ${party} channels`).toEqual(cell.channels);
          expect(rule.actionRequired, `${code} ${party} action-required`).toBe(cell.bold);
        }
      });
    }
  }

  it('gives a conditional cell a condition, and only those', () => {
    const conditional = Object.entries(NOTIFICATION_RULES).flatMap(([code, rules]) =>
      rules.filter((rule) => rule.when).map((rule) => `${code}:${rule.party}`),
    );
    expect(conditional.sort()).toEqual([
      'approval.sla_reminder:OPS',
      'booking.cancelled:OPS',
      'booking.sla_reminder:OPS',
      'report.eta_revised:OPS',
    ]);
  });

  it('keeps the conditions closed when the event lacks the field', () => {
    const when = (code: string, party: Party) =>
      NOTIFICATION_RULES[code]?.find((rule) => rule.party === party)?.when;
    expect(when('booking.sla_reminder', 'OPS')?.({})).toBe(false);
    expect(when('booking.sla_reminder', 'OPS')?.({ percent: 50 })).toBe(false);
    expect(when('booking.sla_reminder', 'OPS')?.({ percent: 90 })).toBe(true);
    expect(when('report.eta_revised', 'OPS')?.({ delayDays: 3 })).toBe(false);
    expect(when('report.eta_revised', 'OPS')?.({ delayDays: 4 })).toBe(true);
    expect(when('booking.cancelled', 'OPS')?.({ cancelledBy: 'CUSTOMER' })).toBe(false);
    expect(when('booking.cancelled', 'OPS')?.({ cancelledBy: 'LAB' })).toBe(true);
    expect(when('approval.sla_reminder', 'OPS')?.({ breached: true })).toBe(true);
    expect(when('approval.sla_reminder', 'OPS')?.({})).toBe(false);
  });
});

describe('deliveryDecision: mandatory and optional notifications', () => {
  const pairs = Object.entries(NOTIFICATION_RULES).flatMap(([code, rules]) =>
    rules.flatMap((rule) =>
      rule.channels.map((channel) => ({
        label: `${code} ${rule.party} ${channel}`,
        actionRequired: rule.actionRequired,
      })),
    ),
  );

  it('covers a useful number of pairs, both kinds', () => {
    expect(pairs.length).toBeGreaterThan(80);
    expect(pairs.some((pair) => pair.actionRequired)).toBe(true);
    expect(pairs.some((pair) => !pair.actionRequired)).toBe(true);
  });

  for (const pair of pairs) {
    it(`${pair.label}: ${pair.actionRequired ? 'a mute is ignored' : 'a mute suppresses'}`, () => {
      expect(deliveryDecision({ actionRequired: pair.actionRequired, muted: false })).toBe(
        'DELIVER',
      );
      expect(deliveryDecision({ actionRequired: pair.actionRequired, muted: true })).toBe(
        pair.actionRequired ? 'DELIVER' : 'SUPPRESS',
      );
    });
  }
});
