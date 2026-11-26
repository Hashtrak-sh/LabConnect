import * as cdk from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';
import { createLabConnectStacks } from '../lib/app.js';
import { DEFAULT_REGION, assertStage, loadConfig } from '../lib/config.js';

const config = (context: Record<string, unknown>) => loadConfig((key) => context[key]);

describe('stage', () => {
  it('defaults to uat', () => {
    expect(assertStage(undefined)).toBe('uat');
    expect(config({}).stage).toBe('uat');
  });

  it.each(['production', 'prod'])('refuses %s with a clear error', (stage) => {
    expect(() => assertStage(stage)).toThrow(/production stage is not defined/);
    expect(() => assertStage(stage)).toThrow(/human-approved/);
  });

  it('refuses an unknown stage', () => {
    expect(() => assertStage('staging')).toThrow(/Unknown stage "staging"/);
  });

  it('refuses production when the whole app is built, before any stack exists', () => {
    const app = new cdk.App({ context: { stage: 'production' } });
    expect(() => createLabConnectStacks(app)).toThrow(/production stage is not defined/);
    expect(app.node.children).toHaveLength(0);
  });
});

describe('parameters', () => {
  it('needs no account, domain or e-mail address', () => {
    const c = config({});
    expect(c.account).toBeUndefined();
    expect(c.domainName).toBeUndefined();
    expect(c.alarmEmail).toBeUndefined();
    expect(c.region).toBe(DEFAULT_REGION);
    expect(DEFAULT_REGION).toBe('ap-south-1');
  });

  it('uses a reserved placeholder sender while no domain is given', () => {
    expect(config({}).sesFromAddress).toContain('labconnect.invalid');
    expect(config({ domainName: 'uat.labconnect.example' }).sesFromAddress).toContain(
      'no-reply@uat.labconnect.example',
    );
  });

  it.each([
    [{ domainName: 'not a domain' }, /domainName/],
    [{ hostedZoneId: 'Z1' }, /needs "domainName"/],
    [{ domainName: 'a.example.org', hostedZoneId: 'Z1' }, /hostedZoneName/],
    [{ account: '123' }, /12-digit/],
    [{ region: 'mars' }, /region/],
    [{ alarmEmail: 'nope' }, /alarmEmail/],
    [{ ingressCidrs: '0.0.0.0/0' }, /narrower/],
    [{ ingressCidrs: 'banana' }, /CIDR/],
    [{ logRetentionDays: '31' }, /logRetentionDays/],
    [{ enableOpenSearch: 'yes' }, /true or false/],
    [{ demoOtpCode: '12345' }, /six digits/],
    [{ demoOtpCode: '1234567' }, /six digits/],
    [{ demoOtpCode: 'abcdef' }, /six digits/],
    [{ demoOtpCode: '444 44' }, /six digits/],
  ])('rejects %j', (context, message) => {
    expect(() => config(context)).toThrow(message);
  });

  it('takes image tags per service, falling back to one tag', () => {
    expect(config({ imageTag: 'abc' })).toMatchObject({
      apiImageTag: 'abc',
      workerImageTag: 'abc',
      migrateImageTag: 'abc',
      webImageTag: 'abc',
    });
    expect(config({ imageTag: 'abc', webImageTag: 'def' }).webImageTag).toBe('def');
    expect(config({ imageTag: 'abc', workerImageTag: 'def' }).workerImageTag).toBe('def');
  });
});
