import { beforeAll, describe, it } from 'vitest';
import { capture, createBooking, createPaymentOrder, createWorld, type World } from './fixtures.js';
import { expectPgError, insert, PG, rollback, update, useDatabase } from './helpers.js';

describe('prices', () => {
  const { db } = useDatabase();
  let world: World;
  beforeAll(async () => {
    world = await createWorld(db());
  });
  const inTx = (body: () => Promise<void>) => () => rollback(db(), body);

  it(
    'C-12 allows one published price list per lab site',
    inTx(async () => {
      const draft = await insert(db(), 'price_list', {
        organisation_id: world.orgs.lab,
        lab_site_id: world.lab.site,
        version_no: 2,
      });
      await expectPgError(db(), PG.unique, () =>
        update(db(), 'price_list', draft, { status: 'PUBLISHED' }),
      );
      await update(db(), 'price_list', world.lab.priceList, {
        status: 'SUPERSEDED',
        effective_to: new Date(),
      });
      await update(db(), 'price_list', draft, { status: 'PUBLISHED' });
    }),
  );

  it(
    'C-13 freezes a published price list and its items',
    inTx(async () => {
      await expectPgError(db(), PG.frozen, () =>
        update(db(), 'price_list', world.lab.priceList, { version_no: 9 }),
      );
      await expectPgError(db(), PG.frozen, () =>
        update(db(), 'price_list', world.lab.priceList, { status: 'DRAFT' }),
      );
      await expectPgError(db(), PG.frozen, () =>
        update(db(), 'price_item', world.lab.priceItem, { price_paise: 1 }),
      );
      await expectPgError(db(), PG.frozen, () =>
        db().query('DELETE FROM price_item WHERE id = $1', [world.lab.priceItem]),
      );
      await expectPgError(db(), PG.frozen, () =>
        db().query('DELETE FROM price_list WHERE id = $1', [world.lab.priceList]),
      );
      // superseding is the one allowed change, and it is final
      await update(db(), 'price_list', world.lab.priceList, {
        status: 'SUPERSEDED',
        effective_to: new Date(),
      });
      await expectPgError(db(), PG.frozen, () =>
        update(db(), 'price_list', world.lab.priceList, { status: 'PUBLISHED' }),
      );
    }),
  );

  it(
    'C-58 rejects nonsensical prices and items for another site’s scope line',
    inTx(async () => {
      const draft = await insert(db(), 'price_list', {
        organisation_id: world.orgs.lab,
        lab_site_id: world.lab.site,
        version_no: 2,
      });
      const item = {
        organisation_id: world.orgs.lab,
        price_list_id: draft,
        scope_line_id: world.lab.scopeLine,
        price_paise: 100,
        sample_qty: 1,
        sample_unit_node_id: world.nodes.unit,
        tat_days: 5,
      };
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'price_item', { ...item, price_paise: -1 }),
      );
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'price_item', { ...item, gst_rate_bp: 2801 }),
      );
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'price_item', { ...item, tat_days: 0 }),
      );
      await expectPgError(db(), PG.rule, () =>
        insert(db(), 'price_item', { ...item, scope_line_id: world.otherLab.scopeLine }),
      );
      await insert(db(), 'price_item', item);
    }),
  );

  it(
    'C-70 rejects overlapping effective windows for one setting or fee',
    inTx(async () => {
      const setting = {
        key: 'booking.payment_window_hours',
        scope_type: 'GLOBAL',
        value: 24,
        change_reason: 'default',
      };
      await insert(db(), 'config_parameter', {
        ...setting,
        effective_from: '2026-01-01',
        effective_to: '2026-07-01',
      });
      await expectPgError(db(), PG.exclusion, () =>
        insert(db(), 'config_parameter', { ...setting, effective_from: '2026-06-01' }),
      );
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'config_parameter', {
          ...setting,
          effective_from: '2026-08-01',
          effective_to: '2026-07-15',
        }),
      );
      await insert(db(), 'config_parameter', { ...setting, effective_from: '2026-07-01' });
      // a different scope is a different setting
      await insert(db(), 'config_parameter', {
        ...setting,
        scope_type: 'LAB_SITE',
        scope_id: world.lab.site,
        effective_from: '2026-01-01',
      });

      const fee = {
        fee_type: 'CANCELLATION_FEE',
        scope_type: 'GLOBAL',
        calc: 'PERCENT_BP',
        value: 1000,
      };
      await insert(db(), 'fee_rule', { ...fee, effective_from: '2026-01-01' });
      await expectPgError(db(), PG.exclusion, () =>
        insert(db(), 'fee_rule', { ...fee, effective_from: '2026-03-01' }),
      );
    }),
  );
});

describe('payments, refunds and payouts', () => {
  const { db } = useDatabase();
  let world: World;
  beforeAll(async () => {
    world = await createWorld(db());
  });
  const inTx = (body: () => Promise<void>) => () => rollback(db(), body);

  it(
    'C-65 makes a payment order charge exactly the booking total',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      await expectPgError(db(), PG.rule, () =>
        createPaymentOrder(db(), world, booking, { amount_paise: 117_999 }),
      );
      // a zero amount is refused even when the booking total is zero
      const free = await createBooking(db(), world, {
        overrides: { subtotal_paise: 0, gst_paise: 0, total_paise: 0 },
      });
      await expectPgError(db(), PG.check, () =>
        createPaymentOrder(db(), world, free, { amount_paise: 0 }),
      );
      const order = await createPaymentOrder(db(), world, booking);
      await expectPgError(db(), PG.unique, () => createPaymentOrder(db(), world, booking));
      await expectPgError(db(), PG.rule, () =>
        update(db(), 'payment_order', order, { amount_paise: 1 }),
      );
    }),
  );

  it(
    'C-16 allows one captured payment order per booking, also after it has been refunded',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const first = await createPaymentOrder(db(), world, booking);
      const second = await createPaymentOrder(db(), world, booking, { attempt_no: 2 });
      await update(db(), 'payment_order', first, { status: 'CAPTURED' });
      await expectPgError(db(), PG.unique, () =>
        update(db(), 'payment_order', second, { status: 'CAPTURED' }),
      );
      await update(db(), 'payment_order', first, { status: 'REFUNDED_PARTIAL' });
      await expectPgError(db(), PG.unique, () =>
        update(db(), 'payment_order', second, { status: 'CAPTURED' }),
      );
      await update(db(), 'payment_order', first, { status: 'REFUNDED_FULL' });
      await expectPgError(db(), PG.unique, () =>
        update(db(), 'payment_order', second, { status: 'CAPTURED' }),
      );
    }),
  );

  it(
    'C-66 C-17 record a gateway movement and a webhook event once',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const order = await createPaymentOrder(db(), world, booking);
      const txn = {
        payment_order_id: order,
        customer_org_id: booking.customerOrg,
        lab_org_id: booking.labOrg,
        gateway: 'FAKE',
        gateway_txn_ref: 'TXN-1',
        txn_type: 'CAPTURE',
        amount_paise: 118_000,
        status: 'SUCCESS',
      };
      await insert(db(), 'payment_transaction', txn);
      await expectPgError(db(), PG.unique, () => insert(db(), 'payment_transaction', txn));
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'payment_transaction', { ...txn, gateway_txn_ref: 'TXN-2', amount_paise: 0 }),
      );
      // the same reference from another gateway is a different movement
      await insert(db(), 'payment_transaction', { ...txn, gateway: 'ICICI' });

      const event = {
        gateway: 'FAKE',
        event_id: 'EVT-1',
        event_type: 'payment.captured',
        signature_valid: true,
        payload_ciphertext: Buffer.from('x'),
        payload_sha256: Buffer.from('y'),
      };
      await insert(db(), 'gateway_webhook_event', event);
      await expectPgError(db(), PG.unique, () => insert(db(), 'gateway_webhook_event', event));
    }),
  );

  it(
    'C-19 caps refunds at the captured amount, counting refunds that have not finished',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const order = await createPaymentOrder(db(), world, booking);
      const refund = {
        ...booking.keys,
        payment_order_id: order,
        reason_code_node_id: world.nodes.refundReason,
        initiated_by_party: 'CUSTOMER',
      };
      // nothing captured yet
      await expectPgError(db(), PG.rule, () =>
        insert(db(), 'refund', { ...refund, amount_paise: 1 }),
      );
      await capture(db(), booking, order);
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'refund', { ...refund, amount_paise: 0 }),
      );
      const first = await insert(db(), 'refund', { ...refund, amount_paise: 100_000 });
      // 100000 requested + 20000 would exceed 118000 although neither has succeeded yet
      await expectPgError(db(), PG.rule, () =>
        insert(db(), 'refund', { ...refund, amount_paise: 20_000 }),
      );
      await insert(db(), 'refund', { ...refund, amount_paise: 18_000 });
      await expectPgError(db(), PG.rule, () =>
        update(db(), 'refund', first, { amount_paise: 100_001 }),
      );
      // a failed refund frees its amount
      await update(db(), 'refund', first, { status: 'FAILED' });
      await insert(db(), 'refund', { ...refund, amount_paise: 100_000 });
    }),
  );

  it(
    'C-20 C-67 never pay a booking out twice, and require a releaser for a released payout',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const account = await insert(db(), 'bank_account', {
        organisation_id: world.orgs.lab,
        account_holder_name: 'DEMO Lab One',
        account_number_ciphertext: Buffer.from('x'),
        account_number_last4: '0001',
        ifsc: 'ICIC0000001',
      });
      const payout = () =>
        insert(db(), 'payout', {
          lab_org_id: world.orgs.lab,
          bank_account_id: account,
          amount_paise: 100_000,
        });
      const first = await payout();
      const second = await payout();
      const firstItem = await insert(db(), 'payout_item', {
        ...booking.keys,
        payout_id: first,
        amount_paise: 100_000,
      });
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'payout_item', { ...booking.keys, payout_id: second, amount_paise: 100_000 }),
      );
      // the first payout fails: its item is voided and the booking can be paid again
      await update(db(), 'payout', first, { status: 'FAILED' });
      await update(db(), 'payout_item', firstItem, { voided_at: new Date() });
      await insert(db(), 'payout_item', {
        ...booking.keys,
        payout_id: second,
        amount_paise: 100_000,
      });

      await expectPgError(db(), PG.check, () =>
        update(db(), 'payout', second, { status: 'RELEASED' }),
      );
      await expectPgError(db(), PG.check, () =>
        update(db(), 'payout', second, { amount_paise: 0 }),
      );
      await update(db(), 'payout', second, {
        status: 'RELEASED',
        released_by_user_id: world.users.admin,
        released_at: new Date(),
      });
    }),
  );
});

describe('ledger and financial documents', () => {
  const { db } = useDatabase();
  let world: World;
  beforeAll(async () => {
    world = await createWorld(db());
  });
  const inTx = (body: () => Promise<void>) => () => rollback(db(), body);

  it(
    'C-18 C-71 keep the ledger double-entry',
    inTx(async () => {
      const account = (code: string, party: string | null = null) =>
        insert(db(), 'ledger_account', { code, party_org_id: party, normal_balance: 'DEBIT' });
      const clearing = await account('GATEWAY_CLEARING');
      const prepayment = await account('CUSTOMER_PREPAYMENT');
      // one account per code when there is no party; one per party otherwise
      await expectPgError(db(), PG.unique, () => account('GATEWAY_CLEARING'));
      await account('LAB_PAYABLE', world.orgs.lab);
      await account('LAB_PAYABLE', world.orgs.otherLab);
      await expectPgError(db(), PG.unique, () => account('LAB_PAYABLE', world.orgs.lab));

      const journal = () =>
        insert(db(), 'ledger_journal', {
          journal_type: 'PAYMENT_CAPTURED',
          description: 'demo',
          occurred_at: new Date(),
        });
      const entry = (journalId: string, accountId: string, debit: number, credit: number) =>
        insert(db(), 'ledger_entry', {
          journal_id: journalId,
          account_id: accountId,
          debit_paise: debit,
          credit_paise: credit,
        });

      const balanced = await journal();
      await expectPgError(db(), PG.check, () => entry(balanced, clearing, 100, -5));
      await expectPgError(db(), PG.check, () => entry(balanced, clearing, 100, 100));
      await expectPgError(db(), PG.check, () => entry(balanced, clearing, 0, 0));
      await entry(balanced, clearing, 118_000, 0);
      await entry(balanced, prepayment, 0, 118_000);
      // the balance is checked when the transaction commits; force that check now
      await db().query('SET CONSTRAINTS ALL IMMEDIATE');
      await db().query('SET CONSTRAINTS ALL DEFERRED');

      const lopsided = await journal();
      await entry(lopsided, clearing, 100, 0);
      await expectPgError(db(), PG.rule, () => db().query('SET CONSTRAINTS ALL IMMEDIATE'));
    }),
  );

  it(
    'C-68 C-69 number documents once per series and check the tax arithmetic',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const series = {
        issuer_org_id: world.orgs.lab,
        doc_type: 'TAX_INVOICE',
        financial_year: '2026-27',
        prefix: 'INV',
      };
      const seriesId = await insert(db(), 'document_series', series);
      await expectPgError(db(), PG.unique, () => insert(db(), 'document_series', series));
      await expectPgError(db(), PG.check, () =>
        update(db(), 'document_series', seriesId, { next_number: 0 }),
      );

      const invoice = {
        ...booking.keys,
        doc_type: 'TAX_INVOICE',
        document_series_id: seriesId,
        doc_no: 'INV-000001',
        issuer_org_id: world.orgs.lab,
        recipient_org_id: world.orgs.customer,
        taxable_paise: 100_000,
        cgst_paise: 9000,
        sgst_paise: 9000,
        total_paise: 118_000,
        line_snapshot: {},
        issued_at: new Date(),
      };
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'financial_document', { ...invoice, total_paise: 118_001 }),
      );
      // inter-state supply carries IGST only
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'financial_document', {
          ...invoice,
          igst_paise: 18_000,
          total_paise: 136_000,
        }),
      );
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'financial_document', { ...invoice, issuer_gstin: 'NOT-A-GSTIN' }),
      );
      await insert(db(), 'financial_document', invoice);
      await expectPgError(db(), PG.unique, () => insert(db(), 'financial_document', invoice));
      await insert(db(), 'financial_document', {
        ...invoice,
        doc_no: 'INV-000002',
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: 18_000,
      });
    }),
  );
});
