import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { START, useIdentityApp } from '../support/identity-app.js';

// createCustomerOrganisation over HTTP, held to the contract, on a real database (I2-CUS-02,
// FR-ONB-01): customer self-sign-up, the first CUSTOMER_ADMIN, and the rules around it.

const ADDRESS = {
  line1: 'Plot 22, Phase II, IMT Manesar',
  line2: null,
  city: 'Gurugram',
  district: 'Gurugram',
  stateCode: 'HR',
  pincode: '122050',
};

let gstinCounter = 0;
/** A GSTIN that matches the contract's pattern and is new in this run. */
function newGstin(): string {
  gstinCounter += 1;
  const digits = String(1000 + gstinCounter).slice(-4);
  const letters = String.fromCharCode(65 + (gstinCounter % 26));
  return `06AAAA${letters}${digits}A1Z5`;
}

describe('customer sign-up: POST /v1/customer/organisations', () => {
  const t = useIdentityApp();

  const newUser = async (label = 'signup') => {
    const email = t.newEmail(label);
    const session = await t.signIn(email);
    return { email, token: session.accessToken };
  };
  const create = (token: string, body: unknown, invalidRequest?: string) =>
    t.api.post('/v1/customer/organisations', {
      token,
      body: body as object,
      ...(invalidRequest !== undefined && { invalidRequest }),
    });

  it('creates a business with the caller as its first CUSTOMER_ADMIN, and the membership shows in /me', async () => {
    const user = await newUser();
    const gstin = newGstin();
    const response = await create(user.token, {
      customerSegment: 'BUSINESS',
      legalName: '  Example Steel Works Private Limited ',
      displayName: 'Example Steel Works',
      gstin,
      registeredAddress: ADDRESS,
    });

    expect(response.status).toBe(201);
    expect(response.headers.etag).toBe('"0"');
    expect(response.body).toEqual({
      id: expect.any(String) as string,
      customerSegment: 'BUSINESS',
      legalName: 'Example Steel Works Private Limited',
      displayName: 'Example Steel Works',
      gstin,
      registeredAddress: ADDRESS,
      status: 'ACTIVE',
      createdAt: START.replace('Z', '.000Z'),
      lockVersion: 0,
    });
    const organisationId = (response.body as { id: string }).id;

    const me = await t.api.get('/v1/me', { token: user.token });
    expect(me.status).toBe(200);
    const memberships = (
      me.body as {
        memberships: {
          id: string;
          organisation: { id: string; orgType: string };
          roles: string[];
        }[];
      }
    ).memberships;
    expect(memberships).toEqual([
      expect.objectContaining({
        organisation: expect.objectContaining({
          id: organisationId,
          orgType: 'CUSTOMER',
        }) as object,
        roles: ['CUSTOMER_ADMIN'],
      }),
    ]);

    // Switching to it works, and the stored rows are the ones the sign-up needs.
    const switched = await t.api.post('/v1/me/active-membership', {
      token: user.token,
      body: { membershipId: memberships[0]?.id },
    });
    expect(switched.status).toBe(200);
    const rows = await t.owner(async (tx) => ({
      organisation: await tx.organisation.findUniqueOrThrow({ where: { id: organisationId } }),
      privates: await tx.organisationPrivate.count({ where: { organisationId } }),
      settings: await tx.customerSettings.count({ where: { organisationId } }),
      audit: await tx.auditLog.findMany({
        where: { entityId: organisationId },
        select: { action: true },
      }),
    }));
    expect(rows.organisation).toMatchObject({
      orgType: 'CUSTOMER',
      claimStatus: 'NOT_APPLICABLE',
      registeredAddress: {
        line1: ADDRESS.line1,
        line2: null,
        city: 'Gurugram',
        district: 'Gurugram',
        state_code: 'HR',
        pincode: '122050',
      },
    });
    expect(rows.privates).toBe(1);
    expect(rows.settings).toBe(1);
    expect(rows.audit).toEqual([{ action: 'organisation.create' }]);
  });

  it('creates an individual without a GSTIN or an address', async () => {
    const user = await newUser('individual');
    const response = await create(user.token, {
      customerSegment: 'INDIVIDUAL',
      legalName: 'Priya Sharma',
      displayName: 'Priya Sharma',
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      customerSegment: 'INDIVIDUAL',
      gstin: null,
      registeredAddress: null,
    });
  });

  it('refuses an organisation without a GSTIN, a bad GSTIN, unknown fields and a bad address, all at once', async () => {
    const user = await newUser();
    const response = await create(
      user.token,
      {
        customerSegment: 'INDUSTRY',
        legalName: '',
        displayName: 'X',
        organisationId: '00000000-0000-7000-8000-000000000000',
        registeredAddress: { ...ADDRESS, pincode: '12345' },
      },
      'an empty name, an unknown field and a short PIN code give 422',
    );
    expect(response.status).toBe(422);
    const errors = (response.body as { code: string; errors: { path: string; code: string }[] })
      .errors;
    expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
    expect(errors.map((e) => e.path).sort()).toEqual([
      'gstin',
      'legalName',
      'organisationId',
      'registeredAddress.pincode',
    ]);

    const lower = await create(
      user.token,
      {
        customerSegment: 'BUSINESS',
        legalName: 'A',
        displayName: 'A',
        gstin: '06aaaaa0000a1z5',
      },
      'a GSTIN in lower case gives 422',
    );
    expect(lower.status).toBe(422);
    const me = await t.api.get('/v1/me', { token: user.token });
    expect((me.body as { memberships: unknown[] }).memberships).toEqual([]);
  });

  it('refuses a GSTIN that another customer organisation already uses', async () => {
    const gstin = newGstin();
    const first = await newUser('first');
    const second = await newUser('second');
    const body = { customerSegment: 'BUSINESS', legalName: 'A', displayName: 'A', gstin };
    expect((await create(first.token, body)).status).toBe(201);
    const again = await create(second.token, body);
    expect(again.status).toBe(422);
    expect(again.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'gstin', code: 'GSTIN_TAKEN' }],
    });
  });

  it('refuses platform staff (RR-5) and anonymous callers', async () => {
    const { platform } = await t.fixtures();
    const staff = await t.signInWithMfa(platform.ops.email);
    const refused = await create(staff.accessToken, {
      customerSegment: 'INDIVIDUAL',
      legalName: 'Staff',
      displayName: 'Staff',
    });
    expect(refused.status).toBe(403);
    expect((refused.body as { code: string }).code).toBe('FORBIDDEN');

    const anonymous = await t.api.post('/v1/customer/organisations', {
      body: { customerSegment: 'INDIVIDUAL', legalName: 'A', displayName: 'A' },
    });
    expect(anonymous.status).toBe(401);
  });

  it('creates one organisation for a repeated Idempotency-Key, and refuses the key with another body', async () => {
    const user = await newUser('repeat');
    const key = randomUUID();
    const body = { customerSegment: 'INDIVIDUAL', legalName: 'Repeat', displayName: 'Repeat' };
    const send = (sent: object) =>
      t.api.post('/v1/customer/organisations', {
        token: user.token,
        body: sent,
        headers: { 'Idempotency-Key': key },
      });

    const first = await send(body);
    const again = await send(body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);

    const me = await t.api.get('/v1/me', { token: user.token });
    expect((me.body as { memberships: unknown[] }).memberships).toHaveLength(1);

    const other = await send({ ...body, legalName: 'Something else' });
    expect(other.status).toBe(422);
    expect((other.body as { code: string }).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('lets a member of another customer organisation start a new one', async () => {
    const { customer } = await t.fixtures();
    const session = await t.signIn(customer.requester.email);
    const response = await create(session.accessToken, {
      customerSegment: 'INDIVIDUAL',
      legalName: 'Side project',
      displayName: 'Side project',
    });
    expect(response.status).toBe(201);
  });
});
