import { describe, expect, it } from 'vitest';
import {
  bodySchemas,
  listOperations,
  loadBundledDocument,
  parametersOf,
  reachableProperties,
  resolve,
  type Response,
  schemaNodes,
} from './helpers.js';

// Payments and disputes (P2-06a, API_CONTRACTS.md §5 and §9). CLAUDE.md §5 "Payments (ICICI)":
// the contract is adapter-level until the ICICI documentation exists (OQ-01), and the amount of a
// payment is never taken from the client (PAYMENTS_AND_LEDGER §2, SCHEMA_SPECIFICATION §10.1).

const doc = loadBundledDocument();
const operations = listOperations(doc);

const moduleOperations = operations.filter(({ operation }) =>
  (operation.tags ?? []).some((t) => t === 'Payments' || t === 'Disputes'),
);
const paymentOperations = moduleOperations.filter(({ operation }) =>
  (operation.tags ?? []).includes('Payments'),
);

/** Property names reachable from the given schemas. */
function reachableNames(schemas: unknown[], at: string): { name: string; at: string }[] {
  return schemas.flatMap((schema) =>
    reachableProperties(doc, schema, at).map(({ name, at: where }) => ({ name, at: where })),
  );
}

describe('payments and disputes (P2-06a)', () => {
  it('covers the module', () => {
    expect(paymentOperations.length).toBeGreaterThan(0);
    expect(moduleOperations.length).toBeGreaterThan(paymentOperations.length);
  });

  it('never take an amount from the client in a payment operation', () => {
    const money = /amount|paise|total|price|money|currency|fee/i;
    const found = paymentOperations.flatMap(({ key, operation }) => [
      ...reachableNames(bodySchemas(doc, operation, 'request'), key).filter((p) =>
        money.test(p.name),
      ),
      ...parametersOf(doc, operation)
        .filter((p) => money.test(p.name))
        .map((p) => ({ name: p.name, at: `${key} (${p.in})` })),
    ]);
    expect(found).toEqual([]);
  });

  it('allow additional properties only on the opaque gateway checkout', () => {
    const open = new Set<string>();
    for (const { key, operation } of moduleOperations) {
      for (const schema of [
        ...bodySchemas(doc, operation, 'request'),
        ...bodySchemas(doc, operation, 'response'),
      ]) {
        for (const { name, at, node } of schemaNodes(doc, schema, key)) {
          if (node.additionalProperties === true) open.add(name ?? at);
        }
      }
    }
    expect([...open]).toEqual(['PaymentGatewayCheckout']);
  });

  it('keep the gateway-facing objects opaque (OQ-01)', () => {
    const checkout = doc.components.schemas.PaymentGatewayCheckout ?? {};
    expect(checkout.properties ?? {}).toEqual({});
    expect(checkout.required ?? []).toEqual([]);
    const webhook = doc.components.schemas.PaymentGatewayWebhookBody ?? {};
    expect(Object.keys(webhook).sort()).toEqual(['description']);
  });

  it('authenticate the webhook by the gateway only, naming no gateway header (OQ-01)', () => {
    const webhook = operations.find((o) => o.key === 'POST /webhooks/payments/{gateway}');
    expect(webhook).toBeDefined();
    if (!webhook) return;
    expect(webhook.operation.security).toEqual([]);
    expect(
      parametersOf(doc, webhook.operation)
        .filter((p) => p.in === 'header' || p.in === 'cookie')
        .map((p) => p.name),
    ).toEqual(['X-Request-Id']);
    expect(reachableNames(bodySchemas(doc, webhook.operation, 'request'), webhook.key)).toEqual([]);
    // The 2xx answer reveals nothing: no body.
    for (const [status, value] of Object.entries(webhook.operation.responses)) {
      if (status.startsWith('2'))
        expect(resolve<Response>(doc, value).content, status).toBeUndefined();
    }
  });

  it('name no gateway vendor in a property or parameter', () => {
    const vendors = (doc.components.schemas.GatewayCode?.enum ?? []).filter((c) => c !== 'FAKE');
    expect(vendors).not.toEqual([]);
    const vendor = new RegExp(vendors.join('|'), 'i');
    const found = moduleOperations.flatMap(({ key, operation }) => [
      ...reachableNames(
        [...bodySchemas(doc, operation, 'request'), ...bodySchemas(doc, operation, 'response')],
        key,
      ).filter((p) => vendor.test(p.name)),
      ...parametersOf(doc, operation)
        .filter((p) => vendor.test(p.name))
        .map((p) => ({ name: p.name, at: key })),
    ]);
    expect(found).toEqual([]);
  });

  it('let no party request set the visibility of a dispute message (TENANT_ISOLATION §1)', () => {
    const found = moduleOperations.flatMap(({ key, operation }) =>
      reachableNames(bodySchemas(doc, operation, 'request'), key).filter((p) =>
        /visibility/i.test(p.name),
      ),
    );
    expect(found).toEqual([]);
  });
});
