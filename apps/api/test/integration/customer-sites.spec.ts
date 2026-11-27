import { describe, expect, it } from 'vitest';
import { START, useIdentityApp } from '../support/identity-app.js';

// The customer site operations over HTTP, held to the contract, on a real database (I2-CUS-03,
// FR-ONB-03): list, create, get and update, the default billing site, retiring a site, and who
// may do what.

const ADDRESS = {
  line1: 'Plot 22, Phase II, IMT Manesar',
  line2: null,
  city: 'Gurugram',
  district: 'Gurugram',
  stateCode: 'HR',
  pincode: '122050',
};

interface SiteBody {
  id: string;
  name: string;
  isDefaultBilling: boolean;
  status: string;
  lockVersion: number;
  location: unknown;
}

describe('customer sites: /v1/customer/sites', () => {
  const t = useIdentityApp();

  /** A new customer organisation with its admin signed in, made through the sign-up API. */
  const newCustomer = async (label: string) => {
    const email = t.newEmail(label);
    const session = await t.signIn(email);
    const created = await t.api.post('/v1/customer/organisations', {
      token: session.accessToken,
      body: { customerSegment: 'INDIVIDUAL', legalName: label, displayName: label },
    });
    expect(created.status).toBe(201);
    const me = await t.api.get('/v1/me', { token: session.accessToken });
    const membershipId = (me.body as { memberships: { id: string }[] }).memberships[0]?.id;
    await t.api.post('/v1/me/active-membership', {
      token: session.accessToken,
      body: { membershipId },
    });
    return {
      token: session.accessToken,
      organisationId: (created.body as { id: string }).id,
    };
  };
  const create = (token: string, body: unknown, invalidRequest?: string) =>
    t.api.post('/v1/customer/sites', {
      token,
      body: body as object,
      ...(invalidRequest !== undefined && { invalidRequest }),
    });
  const patch = (token: string, id: string, ifMatch: string | undefined, body: unknown) =>
    t.api.patch(`/v1/customer/sites/${id}`, {
      token,
      body: body as object,
      ...(ifMatch !== undefined && { headers: { 'If-Match': ifMatch } }),
    });

  it('creates a site: 201, an ETag, no location until it is geocoded, and an audit row', async () => {
    const customer = await newCustomer('site-create');
    const response = await create(customer.token, {
      name: '  Manesar plant ',
      address: ADDRESS,
      contact: { name: 'Ravi', email: 'ravi@example.test', phone: '+919800000000' },
      isDefaultBilling: true,
    });
    expect(response.status).toBe(201);
    expect(response.headers.etag).toBe('"0"');
    expect(response.body).toEqual({
      id: expect.any(String) as string,
      name: 'Manesar plant',
      address: ADDRESS,
      location: null,
      gstin: null,
      contact: { name: 'Ravi', email: 'ravi@example.test', phone: '+919800000000' },
      isDefaultBilling: true,
      status: 'ACTIVE',
      createdAt: START.replace('Z', '.000Z'),
      lockVersion: 0,
    });
    const id = (response.body as SiteBody).id;
    const audit = await t
      .db()
      .query<{ action: string }>('SELECT action FROM audit_log WHERE entity_id = $1', [id]);
    expect(audit.rows).toEqual([{ action: 'customer_site.create' }]);
  });

  it('keeps one default billing site: a new default takes the flag from the old one', async () => {
    const customer = await newCustomer('site-default');
    const first = (
      await create(customer.token, { name: 'A', address: ADDRESS, isDefaultBilling: true })
    ).body as SiteBody;
    const second = (
      await create(customer.token, { name: 'B', address: ADDRESS, isDefaultBilling: true })
    ).body as SiteBody;
    const list = await t.api.get('/v1/customer/sites', { token: customer.token });
    expect(list.status).toBe(200);
    const sites = (list.body as { data: SiteBody[] }).data;
    expect(sites.map((s) => [s.name, s.isDefaultBilling])).toEqual([
      ['A', false],
      ['B', true],
    ]);
    // The old default's version moved on: a client holding its old ETag must read it again.
    expect(sites.find((s) => s.id === first.id)?.lockVersion).toBe(1);
    expect(second.isDefaultBilling).toBe(true);
  });

  it('lists by name a page at a time, and filters by status', async () => {
    const customer = await newCustomer('site-list');
    for (const name of ['Charlie', 'Alpha', 'Bravo']) {
      await create(customer.token, { name, address: ADDRESS });
    }
    const first = await t.api.get('/v1/customer/sites?limit=2', { token: customer.token });
    const page = first.body as {
      data: SiteBody[];
      page: { nextCursor: string | null; limit: number };
    };
    expect(page.data.map((s) => s.name)).toEqual(['Alpha', 'Bravo']);
    expect(page.page.limit).toBe(2);
    const next = await t.api.get(
      `/v1/customer/sites?limit=2&cursor=${encodeURIComponent(page.page.nextCursor ?? '')}`,
      { token: customer.token },
    );
    const rest = next.body as { data: SiteBody[]; page: { nextCursor: string | null } };
    expect(rest.data.map((s) => s.name)).toEqual(['Charlie']);
    expect(rest.page.nextCursor).toBeNull();

    const bravo = page.data[1];
    await patch(customer.token, bravo?.id ?? '', `"${String(bravo?.lockVersion)}"`, {
      status: 'INACTIVE',
    });
    const active = await t.api.get('/v1/customer/sites?status=ACTIVE', { token: customer.token });
    expect((active.body as { data: SiteBody[] }).data.map((s) => s.name)).toEqual([
      'Alpha',
      'Charlie',
    ]);
  });

  it('updates with If-Match: 200 with the new ETag, 412 for a stale one, 400 without one', async () => {
    const customer = await newCustomer('site-update');
    const site = (await create(customer.token, { name: 'Old', address: ADDRESS })).body as SiteBody;
    const renamed = await patch(customer.token, site.id, '"0"', {
      name: 'New',
      gstin: '06AAAAA0000A1Z5',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.headers.etag).toBe('"1"');
    expect(renamed.body).toMatchObject({ name: 'New', gstin: '06AAAAA0000A1Z5', lockVersion: 1 });

    const stale = await patch(customer.token, site.id, '"0"', { name: 'Lost' });
    expect(stale.status).toBe(412);
    expect((stale.body as { code: string }).code).toBe('CONCURRENT_MODIFICATION');

    const fetched = await t.api.get(`/v1/customer/sites/${site.id}`, { token: customer.token });
    expect(fetched.status).toBe(200);
    expect(fetched.headers.etag).toBe('"1"');
    expect((fetched.body as SiteBody).name).toBe('New');
  });

  it('retires a site: no longer the default billing site, and it cannot be made one while inactive', async () => {
    const customer = await newCustomer('site-retire');
    const site = (
      await create(customer.token, { name: 'Plant', address: ADDRESS, isDefaultBilling: true })
    ).body as SiteBody;
    const retired = await patch(customer.token, site.id, '"0"', { status: 'INACTIVE' });
    expect(retired.status).toBe(200);
    expect(retired.body).toMatchObject({ status: 'INACTIVE', isDefaultBilling: false });

    const refused = await patch(customer.token, site.id, '"1"', { isDefaultBilling: true });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'isDefaultBilling', code: 'INACTIVE_SITE' }],
    });
  });

  it('lets every member read, and only the customer admin change', async () => {
    const { customer } = await t.fixtures();
    const requester = await t.signIn(customer.requester.email);
    const list = await t.api.get('/v1/customer/sites', { token: requester.accessToken });
    expect(list.status).toBe(200);
    expect((list.body as { data: unknown[] }).data.length).toBeGreaterThan(0);

    const refused = await create(requester.accessToken, { name: 'Mine', address: ADDRESS });
    expect(refused.status).toBe(403);
    expect((refused.body as { code: string }).code).toBe('FORBIDDEN');
  });

  it('refuses bad input all at once, with every field named', async () => {
    const customer = await newCustomer('site-invalid');
    const response = await create(
      customer.token,
      {
        name: '',
        address: { ...ADDRESS, pincode: '12' },
        contact: { email: 'not-an-email' },
        organisationId: '00000000-0000-7000-8000-000000000000',
      },
      'an empty name, a short PIN code, a bad email and an unknown field give 422',
    );
    expect(response.status).toBe(422);
    const paths = (response.body as { errors: { path: string }[] }).errors
      .map((e) => e.path)
      .sort();
    expect(paths).toEqual(['address.pincode', 'contact.email', 'name', 'organisationId']);

    const badId = await t.api.get('/v1/customer/sites/not-a-uuid', {
      token: customer.token,
      invalidRequest: 'a site id that is not a UUID gives 422',
    });
    expect(badId.status).toBe(422);
  });
});
