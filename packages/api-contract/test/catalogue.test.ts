import { describe, expect, it } from 'vitest';
import {
  allowedKeys,
  compareWithContract,
  expandPath,
  firstTable,
  parseRow,
  parseSection,
} from './catalogue.js';
import { readRepoFile } from './helpers.js';

// Unit tests of the API_CONTRACTS.md table parser. Every cell below is copied from a section of
// the catalogue (§1 to §10), so a later section can be added to doc-equality.test.ts without
// parser work.

const keys = (methodCell: string, pathCell: string): string[] =>
  parseRow(methodCell, pathCell).flatMap(allowedKeys);

describe('parseRow', () => {
  it('reads one method and one path (§1)', () => {
    expect(keys('GET', '`/me`')).toEqual(['GET /me']);
  });

  it('reads several methods for one path (§1 GET/PATCH)', () => {
    expect(keys('GET/PATCH', '`/me/notification-preferences`')).toEqual([
      'GET /me/notification-preferences',
      'PATCH /me/notification-preferences',
    ]);
  });

  it('reads paths separated by · (§1)', () => {
    expect(keys('POST', '`/auth/mfa/enrol` · `/auth/mfa/enrol/confirm`')).toEqual([
      'POST /auth/mfa/enrol',
      'POST /auth/mfa/enrol/confirm',
    ]);
  });

  it('reads a per-part method and a query string (§1)', () => {
    const groups = parseRow(
      'GET',
      '`/me/notifications?unread=true` · POST `/me/notifications/{id}/read`',
    );
    expect(groups.flatMap(allowedKeys)).toEqual([
      'GET /me/notifications',
      'POST /me/notifications/{id}/read',
    ]);
    expect(groups.map((g) => g.queryNames)).toEqual([['unread'], []]);
  });

  it('reads empty query values and a long query string (§2)', () => {
    const [group] = parseRow(
      'GET',
      '`/public/search/labs?q=&lat=&lng=&pincode=&radiusKm=&discipline=&parameter=&method=&tatMax=&priceMax=&category=&cursor=`',
    );
    expect(group?.paths).toEqual(['/public/search/labs']);
    expect(group?.queryNames).toEqual([
      'q',
      'lat',
      'lng',
      'pincode',
      'radiusKm',
      'discipline',
      'parameter',
      'method',
      'tatMax',
      'priceMax',
      'category',
      'cursor',
    ]);
  });

  it('expands an optional segment (§3 `/customer/sites[/{id}]`)', () => {
    const [group] = parseRow('GET/POST/PATCH', '`/customer/sites[/{id}]`');
    expect(group?.methods).toEqual(['GET', 'POST', 'PATCH']);
    expect(group?.paths).toEqual(['/customer/sites', '/customer/sites/{id}']);
  });

  it('reads paths separated by commas (§3)', () => {
    expect(parseRow('GET/POST/DELETE', '`/customer/users`, `/customer/invitations`')).toHaveLength(
      2,
    );
  });

  it('ignores an escaped pipe in a query value (§4 `scope=customer\\|lab`)', () => {
    const [group] = parseRow('GET', '`/bookings?scope=customer\\|lab&status=&cursor=`');
    expect(group?.paths).toEqual(['/bookings']);
    expect(group?.queryNames).toEqual(['scope', 'status', 'cursor']);
  });

  it('continues the previous path after its last parameter (§4 counter)', () => {
    expect(keys('POST', '`/bookings/{id}/counter/accept` · `/counter/decline`')).toEqual([
      'POST /bookings/{id}/counter/accept',
      'POST /bookings/{id}/counter/decline',
    ]);
  });

  it('keeps a file extension and reads its query (§4 labels.pdf)', () => {
    const [group] = parseRow('GET', '`/bookings/{id}/labels.pdf?format=A4\\|THERMAL_50x25`');
    expect(group?.paths).toEqual(['/bookings/{id}/labels.pdf']);
    expect(group?.queryNames).toEqual(['format']);
  });

  it('treats a part with its own path parameter as absolute (§7 reprint requests)', () => {
    expect(
      keys('POST', '`/packages/{id}/reprint-requests` · `/reprint-requests/{id}/approve`'),
    ).toEqual(['POST /packages/{id}/reprint-requests', 'POST /reprint-requests/{id}/approve']);
  });

  it('expands an optional trailing parameter (§8 share links)', () => {
    expect(keys('POST/DELETE', '`/report-versions/{id}/share-links[/{linkId}]`')).toEqual([
      'POST /report-versions/{id}/share-links',
      'POST /report-versions/{id}/share-links/{linkId}',
      'DELETE /report-versions/{id}/share-links',
      'DELETE /report-versions/{id}/share-links/{linkId}',
    ]);
  });

  it('continues several times from the same path (§9 dispute evidence)', () => {
    expect(
      keys('POST', '`/disputes/{id}/messages` · `/evidence/upload-url` · `/evidence`'),
    ).toEqual([
      'POST /disputes/{id}/messages',
      'POST /disputes/{id}/evidence/upload-url',
      'POST /disputes/{id}/evidence',
    ]);
  });

  it('expands alternatives in a segment (§10 approve\\|reject)', () => {
    const groups = parseRow('GET/POST', '`/admin/claims`, `/admin/claims/{id}/approve\\|reject`');
    expect(groups.map((g) => g.paths)).toEqual([
      ['/admin/claims'],
      ['/admin/claims/{id}/approve', '/admin/claims/{id}/reject'],
    ]);
  });

  it('carries a part method forward and drops notes in parentheses (§10 imports)', () => {
    expect(
      keys(
        'POST',
        '`/admin/imports` (upload) · GET `/admin/imports/{id}` · `/rows` · POST `/commit` · `/discard`',
      ),
    ).toEqual([
      'POST /admin/imports',
      'GET /admin/imports/{id}',
      'GET /admin/imports/{id}/rows',
      'POST /admin/imports/{id}/commit',
      'POST /admin/imports/{id}/discard',
    ]);
  });

  it('reads CRUD as every method, none of them promised (§10)', () => {
    const [group] = parseRow('CRUD', '`/admin/mapping-templates`');
    expect(group?.methods).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    expect(group?.methodsOptional).toBe(true);
  });

  it('ignores an ellipsis query (§10 `/admin/bookings?…`)', () => {
    const groups = parseRow('GET', '`/admin/bookings?…` · `/admin/bookings/{id}`');
    expect(groups.flatMap(allowedKeys)).toEqual([
      'GET /admin/bookings',
      'GET /admin/bookings/{id}',
    ]);
    expect(groups[0]?.queryNames).toEqual([]);
  });

  it('keeps a templated file name (§10 exports)', () => {
    expect(keys('GET', '`/admin/exports/{kind}.csv`')).toEqual(['GET /admin/exports/{kind}.csv']);
  });

  it('refuses a continuation it cannot place (§10 `/admin/disputes`, `/assign`)', () => {
    expect(() => parseRow('GET/POST', '`/admin/disputes`, `/assign`, `/decide`')).toThrow(
      /Write the full path in API_CONTRACTS.md/,
    );
  });

  it('refuses text it does not understand', () => {
    expect(() => parseRow('GET', '`/x` and more')).toThrow(/Cannot parse path cell/);
    expect(() => parseRow('FETCH', '`/x`')).toThrow(/Unknown method/);
    expect(() => expandPath('/x y')).toThrow(/not a plain path/);
  });
});

describe('firstTable and parseSection', () => {
  it('finds the Method and Path columns with or without a Who column', () => {
    const table = firstTable([
      '| Method | Path | Purpose |',
      '|---|---|---|',
      '| GET | `/x` | y |',
    ]);
    expect(table.header).toEqual(['Method', 'Path', 'Purpose']);
    expect(table.rows).toEqual([['GET', '`/x`', 'y']]);
  });

  it('parses every table of the real catalogue from §1 to §9', () => {
    const markdown = readRepoFile('docs/04-api/API_CONTRACTS.md');
    const headings = [
      '## 1. ',
      '## 2. ',
      '## 3. ',
      '## 4. ',
      '## 5. ',
      '## 6. ',
      '## 7. ',
      '## 8. ',
      '## 9. ',
    ];
    for (const heading of headings) {
      expect(parseSection(markdown, heading).groups.length, heading).toBeGreaterThan(0);
    }
  });
});

describe('compareWithContract', () => {
  const section = {
    heading: 'test',
    rows: 2,
    groups: [
      ...parseRow('GET/POST/PATCH', '`/customer/sites[/{id}]`'),
      ...parseRow('GET', '`/customer/settings`'),
    ],
  };

  it('accepts methods spread over the paths of a group', () => {
    const contract = [
      'GET /customer/sites',
      'POST /customer/sites',
      'PATCH /customer/sites/{id}',
      'GET /customer/settings',
    ];
    expect(compareWithContract([section], contract)).toEqual({ missing: [], extra: [] });
  });

  it('reports a method no path uses, and a path with no method', () => {
    const contract = ['GET /customer/sites', 'POST /customer/sites'];
    expect(compareWithContract([section], contract).missing).toEqual([
      'GET/POST/PATCH /customer/sites/{id}',
      'PATCH /customer/sites or /customer/sites/{id}',
      'GET /customer/settings',
    ]);
  });

  it('reports an operation under a covered root that no row allows', () => {
    const contract = [
      'GET /customer/sites',
      'POST /customer/sites',
      'PATCH /customer/sites/{id}',
      'GET /customer/settings',
      'DELETE /customer/sites/{id}',
      'GET /health',
    ];
    expect(compareWithContract([section], contract).extra).toEqual(['DELETE /customer/sites/{id}']);
  });
});
