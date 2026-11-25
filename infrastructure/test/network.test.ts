import { describe, expect, it } from 'vitest';
import { resourcesOfType, synthesise } from './helpers.js';

interface Rule {
  CidrIp?: string;
  CidrIpv6?: string;
  FromPort?: number;
  ToPort?: number;
  IpProtocol?: string;
  SourceSecurityGroupId?: unknown;
  DestinationSecurityGroupId?: unknown;
}

const WORLD = ['0.0.0.0/0', '::/0'];
const isWorld = (rule: Rule): boolean =>
  WORLD.includes(rule.CidrIp ?? '') || WORLD.includes(rule.CidrIpv6 ?? '');

/** Every ingress and egress rule of every security group in a template, with the group's logical id. */
function rules(template: ReturnType<typeof synthesise>['templates']['network']) {
  const out: { group: string; direction: 'in' | 'out'; rule: Rule }[] = [];
  for (const [id, group] of resourcesOfType(template, 'AWS::EC2::SecurityGroup')) {
    for (const rule of (group.Properties.SecurityGroupIngress as Rule[] | undefined) ?? []) {
      out.push({ group: id, direction: 'in', rule });
    }
    for (const rule of (group.Properties.SecurityGroupEgress as Rule[] | undefined) ?? []) {
      out.push({ group: id, direction: 'out', rule });
    }
  }
  for (const [id, standalone] of resourcesOfType(template, 'AWS::EC2::SecurityGroupIngress')) {
    out.push({ group: id, direction: 'in', rule: standalone.Properties });
  }
  for (const [id, standalone] of resourcesOfType(template, 'AWS::EC2::SecurityGroupEgress')) {
    out.push({ group: id, direction: 'out', rule: standalone.Properties });
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
  ['with an allow-list', { ingressCidrs: '203.0.113.0/24,198.51.100.7/32' }],
])('security groups %s', (_label, context) => {
  const { templates } = synthesise(context);
  const all = rules(templates.network);

  it('allows no inbound traffic from the whole internet except to the load balancer on 443 and 80', () => {
    const open = all.filter(({ direction, rule }) => direction === 'in' && isWorld(rule));
    for (const { group, rule } of open) {
      expect(group, 'only the load balancer group is open').toMatch(/^AlbSg/);
      expect([80, 443]).toContain(rule.FromPort);
      expect(rule.FromPort).toBe(rule.ToPort);
    }
    // Port 80 is open only where a redirect to 443 answers it, so only with a domain.
    const ports = open.map(({ rule }) => rule.FromPort);
    if ('domainName' in context) expect(ports.sort()).toEqual([443, 80]);
    else expect(ports).toEqual([]);
  });

  it('never allows all ports or all protocols from anywhere', () => {
    for (const { direction, rule } of all) {
      if (direction === 'in') expect(rule.IpProtocol).not.toBe('-1');
      if (isWorld(rule)) expect(rule.IpProtocol).not.toBe('-1');
    }
  });

  it('lets tasks reach the internet on 443 only, and the database group nothing at all', () => {
    const worldEgress = all.filter(({ direction, rule }) => direction === 'out' && isWorld(rule));
    expect(worldEgress.length).toBeGreaterThan(0);
    for (const { rule } of worldEgress) {
      expect(rule.FromPort).toBe(443);
      expect(rule.ToPort).toBe(443);
    }
    const databaseEgress = all.filter(
      ({ group, direction, rule }) =>
        group.startsWith('DatabaseSg') &&
        direction === 'out' &&
        rule.CidrIp !== '255.255.255.255/32',
    );
    expect(databaseEgress).toEqual([]);
  });

  it('reaches the database from the API, worker and migration groups on 5432 only', () => {
    const intoDatabase = all.filter(
      ({ group, direction }) => direction === 'in' && /^(DatabaseSg|.*Database.*)/.test(group),
    );
    expect(intoDatabase.length).toBeGreaterThanOrEqual(3);
    for (const { rule } of intoDatabase) {
      expect(rule.FromPort).toBe(5432);
      expect(rule.ToPort).toBe(5432);
      expect(isWorld(rule)).toBe(false);
      expect(rule.SourceSecurityGroupId).toBeDefined();
    }
  });

  it('gives the worker no inbound rule at all', () => {
    const into = JSON.stringify(
      all.filter(({ direction, group }) => direction === 'in' && group.startsWith('WorkerSg')),
    );
    expect(into).toBe('[]');
  });
});

describe('network layout', () => {
  const { templates } = synthesise();

  it('keeps the database in isolated subnets with no route to the internet', () => {
    const json = JSON.stringify(templates.network.toJSON());
    expect(json).toContain('dataSubnet1');
    const routes = resourcesOfType(templates.network, 'AWS::EC2::Route');
    const dataRoutes = routes.filter(([id]) => id.startsWith('Vpcdata'));
    expect(dataRoutes).toEqual([]);
    const subnets = resourcesOfType(templates.network, 'AWS::EC2::Subnet');
    expect(subnets.length).toBe(6);
  });

  it('has the S3 gateway endpoint and the interface endpoints the docs name', () => {
    const endpoints = resourcesOfType(templates.network, 'AWS::EC2::VPCEndpoint').map(([, e]) =>
      JSON.stringify(e.Properties.ServiceName),
    );
    for (const service of ['s3', 'ecr.api', 'ecr.dkr', 'sqs', 'kms', 'secretsmanager', 'logs']) {
      expect(
        endpoints.some((name) => name.includes(`.${service}"`) || name.includes(`.${service}\\"`)),
        service,
      ).toBe(true);
    }
  });

  it('never gives a public IP to launched resources and restricts the default security group', () => {
    const subnets = resourcesOfType(templates.network, 'AWS::EC2::Subnet');
    for (const [, subnet] of subnets) expect(subnet.Properties.MapPublicIpOnLaunch).toBe(false);
    templates.network.resourceCountIs('Custom::VpcRestrictDefaultSG', 1);
  });

  it('logs rejected traffic', () => {
    templates.network.resourceCountIs('AWS::EC2::FlowLog', 1);
  });
});
