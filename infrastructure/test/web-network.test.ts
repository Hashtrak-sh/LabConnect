import { describe, expect, it } from 'vitest';
import { resourcesOfType, synthesise } from './helpers.js';

/** Security group rules of the web service: who may reach whom, in both layouts. */

interface Rule {
  CidrIp?: string;
  CidrIpv6?: string;
  FromPort?: number;
  ToPort?: number;
  IpProtocol?: string;
  GroupId?: unknown;
  SourceSecurityGroupId?: unknown;
  DestinationSecurityGroupId?: unknown;
}

const WORLD = ['0.0.0.0/0', '::/0'];
const isWorld = (rule: Rule): boolean =>
  WORLD.includes(rule.CidrIp ?? '') || WORLD.includes(rule.CidrIpv6 ?? '');

/** The logical id a `Ref` or `Fn::GetAtt` points to (groups are named by their logical id). */
const refOf = (value: unknown): string => {
  const ref = (value as { Ref?: string; 'Fn::GetAtt'?: string[] } | undefined) ?? {};
  return ref.Ref ?? ref['Fn::GetAtt']?.[0] ?? JSON.stringify(value);
};

/** Every ingress and egress rule of the network stack, whether inline or a separate resource, with its group. */
function rulesOf(template: ReturnType<typeof synthesise>['templates']['network']) {
  const out: { group: string; direction: 'in' | 'out'; rule: Rule }[] = [];
  for (const [id, group] of resourcesOfType(template, 'AWS::EC2::SecurityGroup')) {
    for (const rule of (group.Properties.SecurityGroupIngress as Rule[] | undefined) ?? []) {
      out.push({ group: id, direction: 'in', rule });
    }
    for (const rule of (group.Properties.SecurityGroupEgress as Rule[] | undefined) ?? []) {
      out.push({ group: id, direction: 'out', rule });
    }
  }
  for (const [, ingress] of resourcesOfType(template, 'AWS::EC2::SecurityGroupIngress')) {
    const rule = ingress.Properties as Rule;
    out.push({ group: refOf(rule.GroupId), direction: 'in', rule });
  }
  for (const [, egress] of resourcesOfType(template, 'AWS::EC2::SecurityGroupEgress')) {
    const rule = egress.Properties as Rule;
    out.push({ group: refOf(rule.GroupId), direction: 'out', rule });
  }
  return out;
}

describe.each([
  ['without a domain', {}],
  [
    'with a domain',
    {
      domainName: 'uat.labconnect.example',
      hostedZoneId: 'Z1',
      hostedZoneName: 'labconnect.example',
    },
  ],
])('security groups of the web service %s', (_label, context) => {
  const all = rulesOf(synthesise(context).templates.network);
  const into = (groupPrefix: string, port: number) =>
    all.filter(
      ({ group, direction, rule }) =>
        direction === 'in' && group.startsWith(groupPrefix) && rule.FromPort === port,
    );

  it('lets the API port be reached from the load balancer group and the web group, and from nothing else', () => {
    const rules = into('ApiSg', 3001);
    const sources = rules.map(({ rule }) => refOf(rule.SourceSecurityGroupId)).sort();
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatch(/^AlbSg/);
    expect(sources[1]).toMatch(/^WebSg/);
    for (const { rule } of rules) {
      expect(rule.CidrIp).toBeUndefined();
      expect(rule.CidrIpv6).toBeUndefined();
      expect(rule.ToPort).toBe(3001);
    }
  });

  it('lets the web port be reached from the load balancer group only', () => {
    const rules = into('WebSg', 3000);
    expect(rules).toHaveLength(1);
    expect(refOf(rules[0]?.rule.SourceSecurityGroupId)).toMatch(/^AlbSg/);
    expect(all.filter(({ rule }) => rule.FromPort === 3000 && isWorld(rule))).toEqual([]);
  });

  it('lets the web tasks send to the API port and to the AWS endpoints on 443 only: no database, no other port', () => {
    const out = all.filter(
      ({ group, direction }) => direction === 'out' && group.startsWith('WebSg'),
    );
    expect(out.map(({ rule }) => rule.FromPort).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      443, 3001,
    ]);
    const toApi = out.find(({ rule }) => rule.FromPort === 3001);
    expect(refOf(toApi?.rule.DestinationSecurityGroupId)).toMatch(/^ApiSg/);
    const dbRules = all.filter(
      ({ direction, rule }) =>
        direction === 'in' &&
        rule.FromPort === 5432 &&
        refOf(rule.SourceSecurityGroupId).startsWith('WebSg'),
    );
    expect(dbRules).toEqual([]);
  });

  it('lets the load balancer send to the web port and the API port only', () => {
    const ports = all
      .filter(({ group, direction }) => direction === 'out' && group.startsWith('AlbSg'))
      .map(({ rule }) => rule.FromPort)
      .sort();
    expect(ports).toEqual([3000, 3001]);
  });

  it('gives the web group no inbound rule from a CIDR at all', () => {
    const cidr = all.filter(
      ({ group, direction, rule }) =>
        direction === 'in' &&
        group.startsWith('WebSg') &&
        (rule.CidrIp !== undefined || rule.CidrIpv6 !== undefined),
    );
    expect(cidr).toEqual([]);
  });
});
