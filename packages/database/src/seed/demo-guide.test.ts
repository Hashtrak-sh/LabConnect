import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_CATALOGUE, DEMO_PARAMETER_META, DEMO_SYNONYMS } from './demo-catalogue.js';
import { DEMO_GUIDE_END, DEMO_GUIDE_START, demoGuide, renderDemoGuide } from './demo-guide.js';
import {
  NAMED_LABS,
  NAME_WORDS,
  offeredBy,
  parameterCodesOf,
  PROFILES,
  termsFor,
} from './demo-labs.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

describe('the printed demo guide', () => {
  it('is in infrastructure/README.md exactly as the seed generates it', () => {
    const readme = readFileSync(join(root, 'infrastructure', 'README.md'), 'utf8');
    const start = readme.indexOf(DEMO_GUIDE_START);
    const end = readme.indexOf(DEMO_GUIDE_END);
    expect(start).toBeGreaterThan(0);
    expect(readme.slice(start, end + DEMO_GUIDE_END.length)).toBe(renderDemoGuide());
  });

  it('names five or six search terms, the four bookable sites, two unclaimed labs and the accounts', () => {
    const guide = demoGuide();
    expect(guide.searches.length).toBeGreaterThanOrEqual(5);
    expect(guide.searches.length).toBeLessThanOrEqual(6);
    expect(guide.bookableSites).toHaveLength(4);
    expect(guide.claimLabs).toHaveLength(2);
    expect(
      guide.accounts.filter((account) => account.email.startsWith('lab.owner.demo')),
    ).toHaveLength(3);
    for (const entry of [...guide.bookableSites, ...guide.claimLabs]) {
      expect(entry.name).toContain('(DEMO)');
      expect(entry.certificateNo).toMatch(/^DEMO-TC-\d{4}-\d$/);
    }
    for (const account of guide.accounts) expect(account.email).toMatch(/@demo\.labconnect\.test$/);
  });

  it('only names terms that the catalogue knows', () => {
    const words = [
      ...DEMO_CATALOGUE.flatMap((discipline) =>
        discipline.groups.flatMap((group) =>
          group.products.flatMap((product) => [
            product.name,
            ...(product.aliases ?? []),
            ...product.parameters.flatMap((parameter) => [
              parameter.name,
              ...(parameter.aliases ?? []),
            ]),
          ]),
        ),
      ),
      ...DEMO_SYNONYMS.map((synonym) => synonym.term),
    ].map((word) => word.toLowerCase());
    for (const tip of demoGuide().searches) {
      expect(
        words.some((word) => word.includes(tip.term.toLowerCase())),
        tip.term,
      ).toBe(true);
    }
  });
});

describe('the demo catalogue and labs, as data', () => {
  it('has no parameter whose code, alias or name is shorter than it should be', () => {
    for (const discipline of DEMO_CATALOGUE) {
      for (const group of discipline.groups) {
        for (const product of group.products) {
          expect(product.parameters.length).toBeGreaterThan(0);
          for (const parameter of product.parameters) {
            expect(parameter.code.length).toBeLessThanOrEqual(100);
            expect(parameter.name).not.toMatch(/DEMO parameter/);
            // a search matches by substring: an alias of one or two letters would match almost everything
            for (const alias of parameter.aliases ?? [])
              expect(alias.length).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });

  it('lets only the labs that offer a product have a test that is exclusive to them', () => {
    const productOf = new Map(
      DEMO_CATALOGUE.flatMap((d) =>
        d.groups.flatMap((g) =>
          g.products.flatMap((p) => p.parameters.map((x) => [x.code, p.code] as const)),
        ),
      ),
    );
    for (const [code, meta] of DEMO_PARAMETER_META) {
      expect(productOf.get(code)).toBe(meta.productCode);
      for (const key of meta.only ?? []) {
        const site = NAMED_LABS.flatMap((lab) => lab.sites).find(
          (candidate) => candidate.key === key,
        );
        expect(site?.products, `${code} for ${key}`).toContain(meta.productCode);
      }
    }
  });

  it('has a name for every one of the 192 generic labs, none of them one of the named labs', () => {
    const profileKinds = Object.values(PROFILES).reduce(
      (sum, profile) => sum + profile.kinds.length,
      0,
    );
    expect(NAME_WORDS.length * 2).toBeGreaterThan(192);
    expect(profileKinds).toBeGreaterThan(10);
    const named = NAMED_LABS.map((lab) => lab.name.split(' ')[0]);
    for (const word of NAME_WORDS) expect(named).not.toContain(word);
    expect(new Set(NAME_WORDS).size).toBe(NAME_WORDS.length);
  });
});

describe('prices of the bookable demo sites', () => {
  /** The tests a named site really offers: every test of its products that it may offer. */
  const codesOf = (key: 'vasundhara-faridabad' | 'aravali'): string[] => {
    const site = NAMED_LABS.flatMap((lab) => lab.sites).find((candidate) => candidate.key === key);
    expect(site, key).toBeDefined();
    return (site?.products ?? [])
      .flatMap((product) => parameterCodesOf(product))
      .filter((code) => offeredBy(code, key));
  };

  it('differ between two sites for most of the tests both offer', () => {
    // Faridabad and Aravali both test water. A price is a whole multiple of ten rupees, so single
    // tests can coincide; the demo needs the two price lists to differ visibly, not on every line.
    const aravali = new Set(codesOf('aravali'));
    const shared = codesOf('vasundhara-faridabad').filter((code) => aravali.has(code));
    expect(shared.length).toBeGreaterThan(5);
    const different = shared.filter(
      (code) =>
        termsFor('vasundhara-faridabad', code).pricePaise !== termsFor('aravali', code).pricePaise,
    );
    expect(different.length).toBeGreaterThan(shared.length / 2);
  });
});
