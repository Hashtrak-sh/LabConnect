import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { RATE_LIMITS } from '../lib/stacks/edge-stack.js';
import { resourcesOfType, single, synthesise } from './helpers.js';

const { templates } = synthesise();

describe('services', () => {
  it('runs the API and the worker in private subnets without public addresses', () => {
    const services = resourcesOfType(templates.compute, 'AWS::ECS::Service');
    expect(services).toHaveLength(2);
    for (const [, service] of services) {
      const awsvpc = service.Properties.NetworkConfiguration as {
        AwsvpcConfiguration: { AssignPublicIp: string };
      };
      expect(awsvpc.AwsvpcConfiguration.AssignPublicIp).toBe('DISABLED');
      expect(service.Properties.LaunchType).toBe('FARGATE');
      // A failed deployment rolls back by itself (CI_CD.md).
      expect(service.Properties.DeploymentConfiguration).toMatchObject({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      });
      expect(service.Properties.EnableExecuteCommand).toBe(false);
    }
  });

  it('gives each task a different task role and execution role, with fixed names', () => {
    const tasks = resourcesOfType(templates.compute, 'AWS::ECS::TaskDefinition');
    expect(tasks).toHaveLength(3);
    const roles = tasks.flatMap(([, t]) => [
      JSON.stringify(t.Properties.TaskRoleArn),
      JSON.stringify(t.Properties.ExecutionRoleArn),
    ]);
    expect(new Set(roles).size).toBe(6);
  });

  it('puts the load balancer in the public subnets, drops invalid headers and checks /v1/health', () => {
    templates.compute.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
      LoadBalancerAttributes: Match.arrayWith([
        { Key: 'routing.http.drop_invalid_header_fields.enabled', Value: 'true' },
      ]),
    });
    templates.compute.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/v1/health',
      Port: 3001,
      TargetType: 'ip',
    });
  });

  it('writes no access logs: the request line would record query strings (OQ-40)', () => {
    const alb = single(templates.compute, 'AWS::ElasticLoadBalancingV2::LoadBalancer');
    expect(JSON.stringify(alb.Properties.LoadBalancerAttributes)).not.toContain(
      'access_logs.s3.enabled","Value":"true',
    );
  });

  it('attaches the firewall to the load balancer', () => {
    templates.compute.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
  });
});

describe('firewall', () => {
  const acl = single(templates.edge, 'AWS::WAFv2::WebACL');
  const rules = (acl.Properties.Rules ?? []) as {
    Name: string;
    Priority: number;
    Action?: unknown;
    Statement: Record<string, Record<string, unknown>>;
    VisibilityConfig: { SampledRequestsEnabled: boolean };
  }[];

  it('is regional, allows by default and has managed rules', () => {
    expect(acl.Properties.Scope).toBe('REGIONAL');
    expect(acl.Properties.DefaultAction).toEqual({ Allow: {} });
    for (const name of [
      'AWSManagedRulesCommonRuleSet',
      'AWSManagedRulesKnownBadInputsRuleSet',
      'AWSManagedRulesAmazonIpReputationList',
    ]) {
      expect(
        rules.some((r) => r.Statement.ManagedRuleGroupStatement?.Name === name),
        name,
      ).toBe(true);
    }
  });

  it('rate limits the webhook path, the sign-in path and everything else per address', () => {
    const rate = (name: string) =>
      rules.find((r) => r.Name === name)?.Statement.RateBasedStatement as
        { Limit: number; AggregateKeyType: string; ScopeDownStatement?: unknown } | undefined;
    expect(rate('RateLimitWebhooks')?.Limit).toBe(RATE_LIMITS.webhooks);
    expect(JSON.stringify(rate('RateLimitWebhooks')?.ScopeDownStatement)).toContain(
      '/v1/webhooks/',
    );
    expect(rate('RateLimitAuth')?.Limit).toBe(RATE_LIMITS.auth);
    expect(JSON.stringify(rate('RateLimitAuth')?.ScopeDownStatement)).toContain('/v1/auth/');
    expect(rate('RateLimitAll')?.Limit).toBe(RATE_LIMITS.all);
    for (const name of ['RateLimitWebhooks', 'RateLimitAuth', 'RateLimitAll']) {
      expect(rate(name)?.AggregateKeyType).toBe('IP');
      expect(rules.find((r) => r.Name === name)?.Action).toEqual({ Block: {} });
    }
    // The more specific limits come first.
    const priorityOf = (name: string) => rules.find((r) => r.Name === name)?.Priority ?? 0;
    expect(priorityOf('RateLimitWebhooks')).toBeLessThan(priorityOf('RateLimitAll'));
  });

  it('lets webhook bodies past the 8 KiB rule (OQ-132: up to 256 KiB), counting instead of blocking', () => {
    const common = rules.find((r) => r.Name === 'AWSManagedRulesCommonRuleSet');
    expect(JSON.stringify(common?.Statement)).toContain('SizeRestrictions_BODY');
    expect(JSON.stringify(common?.Statement)).toContain('"Count"');
  });

  it('keeps no sampled requests and no request log (they would hold query strings, OQ-40)', () => {
    for (const rule of rules) expect(rule.VisibilityConfig.SampledRequestsEnabled).toBe(false);
    templates.edge.resourceCountIs('AWS::WAFv2::LoggingConfiguration', 0);
  });
});
