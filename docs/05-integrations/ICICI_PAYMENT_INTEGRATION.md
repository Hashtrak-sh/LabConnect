# ICICI Bank payment integration: investigation and design

**Status:** INVESTIGATION OPEN. **Nothing in this document describes ICICI's actual API.** Fill in sections 2–3 from official ICICI documentation only. Until then, all code uses the `PaymentGateway` interface and `FakePaymentGateway`.

> **Rule for Claude Code:** Don't invent ICICI endpoints, field names, signature algorithms, webhook payloads, settlement behaviour or capabilities. If you need something that isn't recorded here, stop and ask.

## 1. What we need from the gateway (requirements)

| # | Capability | Needed for | Must/Should |
|---|---|---|---|
| G-1 | Hosted checkout (no card data on our servers) for UPI, cards and net banking | FR-PAY-02, PCI SAQ-A | Must |
| G-2 | Create an order carrying our reference (booking number or payment order ID) and the amount in paise or rupees | FR-PAY-01 | Must |
| G-3 | Signed server-to-server notification (webhook) for success or failure, with a unique event or transaction ID | FR-PAY-07 | Must |
| G-4 | A status enquiry API by order or transaction reference | EC-15 reconciliation | Must |
| G-5 | Full and partial refunds via API, with a refund reference and status | FR-PAY-06 | Must |
| G-6 | A daily settlement report (format, delivery method) | FR-FIN-03 | Must |
| G-7 | A sandbox or UAT environment with test instruments | Testing | Must |
| G-8 | Marketplace or split settlement to lab bank accounts | FR-PAY-09 | Unknown |
| G-9 | Delayed, held or conditional settlement (72 h after report release) | CD-15 | Unknown |
| G-10 | Payout API to arbitrary verified bank accounts | FR-PAY-09 alternative | Unknown |
| G-11 | Bank account verification (penny drop) | Lab onboarding | Should |
| G-12 | Payment links or QR (UPI intent) on mobile web | UX | Should |

## 2. Investigation checklist (owner: @Hashtrak-sh, with the operating authority's finance team)
- [ ] Which ICICI product: payment gateway / aggregator, Eazypay, or another? Merchant category for a government-operated marketplace?
- [ ] Contract entity: who is the merchant of record (the operating authority, or each lab)? This affects GST invoicing (OQ-08) and RBI PA rules.
- [ ] Integration documentation obtained (version, date). Store the PDFs in a **private** location, not in this repository if they're confidential. Link them here.
- [ ] Order creation: endpoint, auth method, request and response fields, amount units, reference field limits.
- [ ] Checkout: redirect vs. JS SDK, return URL behaviour, mobile UPI intent support.
- [ ] Webhook: URL registration, signature scheme (algorithm, key, which bytes are signed), retry policy, event ID uniqueness, source IP ranges.
- [ ] Status API: rate limits, final vs. intermediate statuses.
- [ ] Refunds: API, partial support, timelines, refund webhook.
- [ ] Settlement: T+N, report format (CSV/SFTP/API), UTR availability.
- [ ] G-8/G-9/G-10: is split, held or delayed settlement, or a payout facility, available to this merchant type? Any escrow or nodal requirements?
- [ ] Sandbox credentials and test cards/UPI handles.
- [ ] Certification or UAT sign-off process with ICICI before going live.

## 3. Findings (to be completed)
| Item | Finding | Source document & page | Date |
|---|---|---|---|
| | | | |

## 4. Adapter design (implementable now)

```ts
// packages/shared/src/payments/payment-gateway.ts (interface only)
export interface PaymentGateway {
  readonly code: 'ICICI' | 'FAKE';
  createOrder(input: { paymentOrderId: string; bookingNo: string; amountPaise: bigint;
                       customer: { name: string; email: string; phone?: string };
                       returnUrl: string; expiresAt: Date }): Promise<{ gatewayOrderRef: string; checkout: unknown }>;
  verifyAndParseWebhook(raw: { headers: Record<string,string>; body: Buffer }):
    Promise<{ valid: boolean; eventId?: string; events: GatewayEvent[] }>;
  fetchStatus(ref: { gatewayOrderRef: string }): Promise<GatewayPaymentStatus>;
  refund(input: { gatewayTxnRef: string; amountPaise: bigint; refundId: string; reason: string }):
    Promise<{ gatewayRefundRef: string; status: 'SUBMITTED'|'SUCCEEDED'|'FAILED' }>;
  // Optional capabilities, null when unsupported. Callers must handle null.
  payouts?: { create(...): Promise<...>; status(...): Promise<...> } | null;
  parseSettlementReport?(file: Buffer): Promise<SettlementLine[]>;
}
```
- `checkout` is **opaque** and passed to a web component chosen by `gateway.code`.
- `FakePaymentGateway`: deterministic, controllable from tests (success, failure, delayed webhook, duplicate webhook, invalid signature). It's used in local, CI and early UAT.
- Webhook endpoint: `POST /v1/webhooks/payments/icici`. Store the raw body before parsing, verify, dedupe on `(gateway, event_id)`, process in a transaction, return 2xx.
- Amounts are always compared in paise. Any mismatch → `PAYMENT_AMOUNT_MISMATCH` → Finance exception + automatic refund.

## 5. Settlement options (decide after §3, ADR-009 is pending)
| Option | How the 72 h hold works | Pros | Cons |
|---|---|---|---|
| A. Gateway marketplace split with delayed release | Gateway holds and releases on instruction | Funds never pass through platform accounts | Needs G-8 + G-9 |
| B. Platform collects into a designated account, then pays out via gateway payouts | Platform triggers the payout after eligibility | Full control of timing | Regulatory review (holding funds), needs G-10 |
| C. Platform collects, Finance pays out by bank transfer (manual, from the exported payout file) | Manual release after eligibility | No dependency on G-8 to G-10 | Operational load, slower |

Until this is decided, `payout.mechanism = 'TBD'`, and the system computes eligibility and produces payout files (Option C works as an interim).
