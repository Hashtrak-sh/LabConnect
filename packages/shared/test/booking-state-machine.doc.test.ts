// Doc-equality: src/booking-state-machine.ts against BOOKING_STATE_MACHINE.md (§1 states,
// §2 diagram, §3 transition table, §4 sub-state machines), the Prisma enums and the
// booking_transition rows of the reference-data migration. Every comparison is an exact
// equality, so a row missing on either side fails.
import { describe, expect, it } from 'vitest';

import {
  BOOKING_LINE_STATE_MACHINE,
  BOOKING_STATUS_CATEGORIES,
  BOOKING_STATUSES,
  BOOKING_TRANSITION_ROWS,
  BOOKING_TRANSITIONS,
  PACKAGE_STATE_MACHINE,
  PAYMENT_ORDER_STATE_MACHINE,
  RECEIPT_RECORD_STATE_MACHINE,
  REPORT_VERSION_STATE_MACHINE,
  type SubStateMachine,
  type SystemActorSource,
  type TransitionActor,
} from '../src/booking-state-machine.js';
import { ROLE_CODES, ROLES, type RoleCode } from '../src/permissions.js';
import { backticked, markdownSection, markdownTable, prismaEnum, readRepoFile } from './helpers.js';

const doc = readRepoFile('docs/02-architecture/BOOKING_STATE_MACHINE.md');

// ---------------------------------------------------------------------------------------------
// §3 actor cells → structured actors. An unknown token fails the test, so a new actor in the
// document cannot slip through.

const ROLE_BY_ABBREVIATION = new Map<string, RoleCode>(
  ROLE_CODES.map((code) => [ROLES[code].abbreviation, code]),
);
// §3 writes "Ops" for the P-Ops column of the permission matrix.
ROLE_BY_ABBREVIATION.set('Ops', 'PLATFORM_OPS');

const SYSTEM_SOURCES: Record<string, SystemActorSource> = {
  Payments: 'PAYMENTS',
  'EC-01': 'EC-01',
};

function roleOf(abbreviation: string): RoleCode {
  const code = ROLE_BY_ABBREVIATION.get(abbreviation);
  if (!code) throw new Error(`Unknown role in §3: ${abbreviation}`);
  return code;
}

function parseActor(token: string): TransitionActor {
  if (token === 'owner') return { kind: 'OWNER' };
  const system = /^system(?: \((.+)\))?$/.exec(token);
  if (system) {
    if (system[1] === undefined) return { kind: 'SYSTEM' };
    const source = SYSTEM_SOURCES[system[1]];
    if (!source) throw new Error(`Unknown system source in §3: ${token}`);
    return { kind: 'SYSTEM', source };
  }
  const onBehalf = /^\((\S+) on behalf\)$/.exec(token);
  if (onBehalf) return { kind: 'ROLE', role: roleOf(onBehalf[1] ?? ''), qualifier: 'ON_BEHALF' };
  const own = /^(\S+) \(own\)$/.exec(token);
  if (own) return { kind: 'ROLE', role: roleOf(own[1] ?? ''), qualifier: 'OWN' };
  const ofSite = /^(\S+) of the site$/.exec(token);
  if (ofSite) return { kind: 'ROLE', role: roleOf(ofSite[1] ?? ''), qualifier: 'OF_SITE' };
  if (/^\S+$/.test(token)) return { kind: 'ROLE', role: roleOf(token) };
  throw new Error(`Unknown actor in §3: ${token}`);
}

function documentedTransitions() {
  const { header, rows } = markdownTable(markdownSection(doc, '## 3. Transition table'));
  expect(header).toEqual(['ID', 'From', 'To', 'Command', 'Actor', 'Guards', 'Side effects']);
  return rows.map(([id = '', from = '', to = '', command = '', actor = '']) => {
    const names = backticked(command);
    // With several commands (T-08), the actor cell pairs with them by " / ".
    const actorGroups = names.length > 1 ? actor.split(' / ') : [actor];
    expect(actorGroups, `${id}: one actor group per command`).toHaveLength(names.length);
    return {
      id,
      from: from === '—' ? [] : from.split(',').map((state) => state.trim()),
      to,
      commands: names.map((name, i) => ({
        name,
        actors: (actorGroups[i] ?? '').split(',').map((token) => parseActor(token.trim())),
      })),
    };
  });
}

describe('BOOKING_STATE_MACHINE.md', () => {
  it('§1: the states and their categories equal BOOKING_STATUSES', () => {
    const { rows } = markdownTable(markdownSection(doc, '## 1. States'));
    const documented = rows.map(([state = '', category = '']) => [
      backticked(state).join(),
      category,
    ]);
    expect(documented).toEqual(
      BOOKING_STATUSES.map((status) => [status, BOOKING_STATUS_CATEGORIES[status]]),
    );
    expect(documented).toHaveLength(18);
  });

  it('§3: the transition table equals BOOKING_TRANSITIONS (ids, from, to, commands, actors)', () => {
    const documented = documentedTransitions();
    expect(BOOKING_TRANSITIONS).toEqual(documented);
    expect(documented).toHaveLength(28);
  });

  it('§2: the diagram has exactly the (from, to) edges of the transition table', () => {
    const mermaid = /```mermaid\r?\n([\s\S]*?)```/.exec(
      markdownSection(doc, '## 2. Diagram').join('\n'),
    )?.[1];
    expect(mermaid).toBeDefined();
    const diagramEdges = new Set(
      [...(mermaid ?? '').matchAll(/^\s*(\[\*\]|[A-Z_]+) --> ([A-Z_]+)/gm)].map(
        ([, from = '', to = '']) => `${from === '[*]' ? '' : from}>${to}`,
      ),
    );
    const tableEdges = new Set(
      BOOKING_TRANSITION_ROWS.map((row) => `${row.fromStatus ?? ''}>${row.toStatus}`),
    );
    expect([...diagramEdges].sort()).toEqual([...tableEdges].sort());
    // T-27 and T-28 share SAMPLE_RECORDED → CANCELLED, so 33 rows make 32 distinct edges.
    expect(tableEdges.size).toBe(32);
  });
});

describe('the database', () => {
  it('BOOKING_STATUSES equals the Prisma enum BookingStatus', () => {
    expect(BOOKING_STATUSES).toEqual(prismaEnum('BookingStatus'));
  });

  it('BOOKING_TRANSITION_ROWS equals the booking_transition rows of the reference-data migration', () => {
    const sql = readRepoFile(
      'packages/database/prisma/migrations/20261124090600_reference_data/migration.sql',
    );
    const insert = /INSERT INTO booking_transition \(([^)]*)\) VALUES([\s\S]*?);/.exec(sql);
    expect(insert?.[1]).toBe('seq, transition_id, from_status, to_status');
    const rows = [
      ...(insert?.[2] ?? '').matchAll(
        /\(\s*(\d+),\s*'(T-\d\d)',\s*(?:NULL|'([A-Z_]+)'),\s*'([A-Z_]+)'\)/g,
      ),
    ].map(([, seq = '', transitionId = '', fromStatus, toStatus = '']) => ({
      seq: Number(seq),
      transitionId,
      fromStatus: fromStatus ?? null,
      toStatus,
    }));
    expect(
      rows.map(({ transitionId, fromStatus, toStatus }) => ({
        transitionId,
        fromStatus,
        toStatus,
      })),
    ).toEqual(BOOKING_TRANSITION_ROWS);
    expect(rows.map((row) => row.seq)).toEqual(rows.map((_, i) => i + 1));
    expect(rows).toHaveLength(33);
  });
});

// ---------------------------------------------------------------------------------------------
// §4 sub-state machines.

const INCLUDED: Record<string, SubStateMachine<string>> = {
  'Payment order': PAYMENT_ORDER_STATE_MACHINE,
  Package: PACKAGE_STATE_MACHINE,
  'Receipt record': RECEIPT_RECORD_STATE_MACHINE,
  'Report version': REPORT_VERSION_STATE_MACHINE,
  'Booking line': BOOKING_LINE_STATE_MACHINE,
};
// Not stated unambiguously in §4, so not modelled (see the P2-07 report).
const LEFT_OUT = ['Dispute', 'Payout'];

function subStateLines(): Map<string, string> {
  const entries = markdownSection(doc, '## 4. Sub-state machines')
    .map((line) => /^\*\*(.+?):\*\* (.*)$/.exec(line))
    .filter((match) => match !== null)
    .map((match): [string, string] => [match[1] ?? '', match[2] ?? '']);
  return new Map(entries);
}

/** The edges of one §4 line: arrow chains in backticks, plus "or `X` (from `A` or `B`". */
function documentedEdges(text: string): string[] {
  const edges: string[] = [];
  for (const chain of backticked(text).filter((token) => token.includes('→'))) {
    const groups = chain.split('→').map((group) => group.split('|').map((s) => s.trim()));
    groups.slice(1).forEach((targets, i) => {
      for (const from of groups[i] ?? []) for (const to of targets) edges.push(`${from}>${to}`);
    });
  }
  const orFrom = /or `([A-Z_]+)` \(from ((?:`[A-Z_]+`(?: or )?)+)/.exec(text);
  const [, target = '', sources = ''] = orFrom ?? [];
  for (const from of backticked(sources)) edges.push(`${from}>${target}`);
  return edges.sort();
}

function documentedStates(text: string): string[] {
  const states = backticked(text).flatMap((token) => token.match(/[A-Z][A-Z_]+/g) ?? []);
  return [...new Set(states)].sort();
}

describe('§4 sub-state machines', () => {
  it('names exactly the modelled machines plus the ones left out', () => {
    expect([...subStateLines().keys()].sort()).toEqual(
      [...Object.keys(INCLUDED), ...LEFT_OUT].sort(),
    );
  });

  for (const [name, machine] of Object.entries(INCLUDED)) {
    it(`${name}: states and edges equal the document`, () => {
      const text = subStateLines().get(name) ?? '';
      expect([...machine.states].sort()).toEqual(documentedStates(text));
      expect(machine.transitions.map(([from, to]) => `${from}>${to}`).sort()).toEqual(
        documentedEdges(text),
      );
    });
  }

  it('the states equal the Prisma enums', () => {
    expect(PAYMENT_ORDER_STATE_MACHINE.states).toEqual(prismaEnum('PaymentOrderStatus'));
    expect(PACKAGE_STATE_MACHINE.states).toEqual(prismaEnum('PackageStatus'));
    expect(REPORT_VERSION_STATE_MACHINE.states).toEqual(prismaEnum('ReportVersionStatus'));
    expect(BOOKING_LINE_STATE_MACHINE.states).toEqual(prismaEnum('BookingLineStatus'));
    // SUBMITTED is `decision IS NULL` in receipt_record.
    expect(RECEIPT_RECORD_STATE_MACHINE.states.filter((s) => s !== 'SUBMITTED')).toEqual(
      prismaEnum('ReceiptDecision'),
    );
  });
});
