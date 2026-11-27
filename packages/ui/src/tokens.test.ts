import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOKING_STATUSES } from '@labconnect/shared';
import { describe, expect, it } from 'vitest';
import {
  ACCREDITATION_STATUS_STYLES,
  BOOKING_STATUS_STYLES,
  LISTING_STATUS_STYLES,
} from './status.js';

const SRC = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(SRC, 'components');
const components = readdirSync(componentsDir)
  .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
  .map((file) => ({ file, text: readFileSync(join(componentsDir, file), 'utf8') }));
const styles = readFileSync(join(SRC, 'styles.css'), 'utf8');

describe('design tokens', () => {
  it('clears the default palette, so only semantic colours exist', () => {
    expect(styles).toMatch(/--color-\*:\s*initial;/);
  });

  it('defines every token the approved sheet uses (designs-pass-2/lc.css)', () => {
    const sheet = readFileSync(
      join(SRC, '..', '..', '..', 'docs', '09-design-handoff', 'designs-pass-2', 'lc.css'),
      'utf8',
    );
    const rootBlock = sheet.slice(
      sheet.indexOf(':root{'),
      sheet.indexOf('}', sheet.indexOf(':root{')),
    );
    const semantic = [...rootBlock.matchAll(/(--color-[a-z-]+):/g)].map((match) => match[1]);
    expect(semantic.length).toBeGreaterThan(30);
    for (const name of semantic) expect(styles, name).toContain(`${String(name)}:`);
  });

  it('keeps raw palette colours and hex literals out of components (DR-13)', () => {
    const palette =
      /\b(?:bg|text|border|ring|fill|stroke|outline|decoration)-(?:slate|gray|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b|\b(?:bg|text|border)-(?:white|black)\b/;
    const hex = /#[0-9a-fA-F]{3,8}\b/;
    const offenders = components
      .filter(
        ({ text }) => palette.test(text) || hex.test(text.replaceAll(/'#[0-9a-f]{6}'\)/g, '')),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('status mapping', () => {
  it('styles every booking state of the shared state machine', () => {
    expect(Object.keys(BOOKING_STATUS_STYLES).sort()).toEqual([...BOOKING_STATUSES].sort());
  });

  it('follows DESIGN_SYSTEM 1.3 and pass 2 A-02', () => {
    expect(BOOKING_STATUS_STYLES.ON_HOLD.tone).toBe('warning');
    expect(BOOKING_STATUS_STYLES.DISPUTED.tone).toBe('danger');
    expect(BOOKING_STATUS_STYLES.CANCELLED.tone).toBe('neutral');
    expect(BOOKING_STATUS_STYLES.REQUESTED.tone).toBe('info');
    expect(BOOKING_STATUS_STYLES.COMPLETED.tone).toBe('success');
    expect(ACCREDITATION_STATUS_STYLES.SUSPENDED.tone).toBe('warning');
    expect(LISTING_STATUS_STYLES.BOOKABLE.tone).toBe('success');
  });

  it('gives every style an icon, so status is never colour alone', () => {
    const all = [
      ...Object.values(BOOKING_STATUS_STYLES),
      ...Object.values(LISTING_STATUS_STYLES),
      ...Object.values(ACCREDITATION_STATUS_STYLES),
    ];
    expect(all.every((style) => style.icon.length > 0)).toBe(true);
  });
});
