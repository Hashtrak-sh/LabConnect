import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WITH_DOMAIN, resourcesOfType, synthesise } from './helpers.js';

/**
 * The web service (apps/web behind the same load balancer as the API): its task definition,
 * how visitors reach it, how it reaches the API, and what the API's security group admits.
 */

interface Container {
  Name: string;
  Environment?: { Name: string; Value: unknown }[];
  Secrets?: unknown[];
  PortMappings?: { ContainerPort: number }[];
  HealthCheck?: { Command: string[]; StartPeriod: number };
  Image: unknown;
  User?: string;
  Command?: string[];
}

const taskOf = (context: Record<string, unknown>, family: string) => {
  const { templates } = synthesise(context);
  const found = resourcesOfType(templates.compute, 'AWS::ECS::TaskDefinition').find(
    ([, task]) => task.Properties.Family === family,
  );
  expect(found, family).toBeDefined();
  return found?.[1].Properties as {
    Cpu: string;
    Memory: string;
    ContainerDefinitions: Container[];
  };
};

describe('the web task definition', () => {
  const task = taskOf({}, 'labconnect-uat-web');
  const [container] = task.ContainerDefinitions;
  const env = new Map((container?.Environment ?? []).map((e) => [e.Name, e.Value]));

  it('has one container on port 3000 and no secret', () => {
    expect(task.ContainerDefinitions).toHaveLength(1);
    expect(container?.PortMappings).toEqual([{ ContainerPort: 3000, Protocol: 'tcp' }]);
    expect(container?.Secrets).toBeUndefined();
  });

  it('is told where the API is: its private name with the /v1 prefix, never the load balancer', () => {
    expect(env.get('API_BASE_URL')).toBe('http://api.labconnect-uat.internal:3001/v1');
    expect(env.get('PORT')).toBe('3000');
    expect(env.get('NODE_ENV')).toBe('production');
    // Nothing secret in the environment: these three, and the web app's own public origin
    // (WEB_BASE_URL, pinned against the API's allowed origin in runtime-env.test.ts). The API is
    // reached by its private name, never through the load balancer.
    expect([...env.keys()].sort()).toEqual(['API_BASE_URL', 'NODE_ENV', 'PORT', 'WEB_BASE_URL']);
    expect(JSON.stringify(env.get('API_BASE_URL'))).not.toMatch(/amazonaws|https:\/\/|GetAtt/);
  });

  it('is checked from inside at /health with Node (the slim image has no curl) and given time to start', () => {
    const command = (container?.HealthCheck?.Command ?? []).join(' ');
    expect(command).toContain('127.0.0.1:3000/health');
    expect(command).toContain('fetch');
    expect(container?.HealthCheck?.StartPeriod).toBeGreaterThanOrEqual(30);
  });

  it('is sized by context parameters, like the API', () => {
    expect(task.Cpu).toBe('512');
    expect(task.Memory).toBe('1024');
    const big = taskOf({ webCpu: '1024', webMemoryMiB: '2048' }, 'labconnect-uat-web');
    expect(big.Cpu).toBe('1024');
    expect(big.Memory).toBe('2048');
  });

  it('pulls the web repository image, by the tag given for it', () => {
    const image = JSON.stringify(container?.Image);
    expect(image).toContain('webRepository');
    expect(image).not.toContain('apiRepository');
    const tagged = taskOf({ webImageTag: 'abc123' }, 'labconnect-uat-web');
    expect(JSON.stringify(tagged.ContainerDefinitions[0]?.Image)).toContain('abc123');
    expect(JSON.stringify(container?.Image)).toContain('bootstrap');
  });
});

describe('the web service', () => {
  const { templates } = synthesise();
  const services = resourcesOfType(templates.compute, 'AWS::ECS::Service');
  const web = services.find(([, s]) => s.Properties.ServiceName === 'labconnect-uat-web')?.[1];
  const api = services.find(([, s]) => s.Properties.ServiceName === 'labconnect-uat-api')?.[1];

  it('exists with no public IP, a circuit breaker with rollback and a health-check grace period', () => {
    expect(web).toBeDefined();
    const awsvpc = web?.Properties.NetworkConfiguration as {
      AwsvpcConfiguration: { AssignPublicIp: string; SecurityGroups: unknown[] };
    };
    expect(awsvpc.AwsvpcConfiguration.AssignPublicIp).toBe('DISABLED');
    expect(web?.Properties.DeploymentConfiguration).toMatchObject({
      DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      MinimumHealthyPercent: 100,
    });
    expect(web?.Properties.HealthCheckGracePeriodSeconds).toBeGreaterThanOrEqual(30);
    expect(web?.Properties.EnableExecuteCommand).toBe(false);
    expect(JSON.stringify(awsvpc.AwsvpcConfiguration.SecurityGroups)).toContain('WebSg');
  });

  it('takes its desired count from a context parameter (default 1; 0 is allowed for the first deploy)', () => {
    expect(web?.Properties.DesiredCount).toBe(1);
    const zero = resourcesOfType(
      synthesise({ webDesiredCount: '0' }).templates.compute,
      'AWS::ECS::Service',
    ).find(([, s]) => s.Properties.ServiceName === 'labconnect-uat-web')?.[1];
    expect(zero?.Properties.DesiredCount).toBe(0);
  });

  it('registers the API, and only the API, in a private DNS namespace', () => {
    templates.compute.resourceCountIs('AWS::ServiceDiscovery::PrivateDnsNamespace', 1);
    templates.compute.resourceCountIs('AWS::ServiceDiscovery::PublicDnsNamespace', 0);
    templates.compute.hasResourceProperties('AWS::ServiceDiscovery::PrivateDnsNamespace', {
      Name: 'labconnect-uat.internal',
    });
    const registered = services.filter(([, s]) => s.Properties.ServiceRegistries !== undefined);
    expect(registered).toHaveLength(1);
    expect(registered[0]?.[1]).toBe(api);
    const entries = resourcesOfType(templates.compute, 'AWS::ServiceDiscovery::Service');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.[1].Properties).toMatchObject({
      Name: 'api',
      DnsConfig: { DnsRecords: [{ Type: 'A' }] },
    });
  });
});

type Json = Record<string, unknown>;
interface Rule {
  Priority: number;
  ListenerArn: unknown;
  Conditions: {
    Field: string;
    PathPatternConfig?: { Values: string[] };
    HostHeaderConfig?: { Values: string[] };
  }[];
  Actions: { Type: string; TargetGroupArn?: unknown }[];
}

/** Which target group (by logical id prefix) a forward action points to. */
const targetOf = (action: { TargetGroupArn?: unknown } | undefined): string => {
  const ref = (action?.TargetGroupArn as { Ref?: string } | undefined)?.Ref ?? '';
  return ref.startsWith('WebTargets') ? 'web' : ref.startsWith('ApiTargets') ? 'api' : ref;
};

function routing(context: Record<string, unknown>) {
  const { templates } = synthesise(context);
  const listeners = resourcesOfType(templates.compute, 'AWS::ElasticLoadBalancingV2::Listener').map(
    ([id, l]) => ({ id, ...(l.Properties as Json) }),
  ) as { id: string; Port: number; Protocol: string; DefaultActions: Json[] }[];
  const rules = resourcesOfType(templates.compute, 'AWS::ElasticLoadBalancingV2::ListenerRule').map(
    ([, r]) => r.Properties as unknown as Rule,
  );
  return { listeners, rules, templates };
}

describe('routing without a domain: one HTTP listener, /v1/ to the API, the rest to web', () => {
  const { listeners, rules } = routing({});

  it('has one listener, plain HTTP on port 80, whose default is the web app', () => {
    expect(listeners).toHaveLength(1);
    expect(listeners[0]).toMatchObject({ Port: 80, Protocol: 'HTTP' });
    const [action] = listeners[0]?.DefaultActions as { Type: string; TargetGroupArn?: unknown }[];
    expect(action?.Type).toBe('forward');
    expect(targetOf(action)).toBe('web');
  });

  it('sends exactly the paths under /v1/ to the API', () => {
    expect(rules).toHaveLength(1);
    const [rule] = rules;
    expect(rule?.Conditions).toHaveLength(1);
    expect(rule?.Conditions[0]?.Field).toBe('path-pattern');
    expect(rule?.Conditions[0]?.PathPatternConfig?.Values).toEqual(['/v1/*']);
    expect(rule?.Actions).toHaveLength(1);
    expect(targetOf(rule?.Actions[0])).toBe('api');
    expect(rule?.Priority).toBe(10);
  });

  it('never routes /v1/ to web, and never routes a non-/v1/ path to the API', () => {
    for (const rule of rules) {
      const toWeb = rule.Actions.some((a) => targetOf(a) === 'web');
      const paths = rule.Conditions.flatMap((c) => c.PathPatternConfig?.Values ?? []);
      expect(toWeb && paths.some((p) => p.startsWith('/v1')), 'a /v1 rule that points to web').toBe(
        false,
      );
      if (rule.Actions.some((a) => targetOf(a) === 'api')) {
        for (const path of paths) expect(path.startsWith('/v1/')).toBe(true);
      }
    }
  });
});

describe('routing with a domain: web on the base domain, the API on api.<domain>', () => {
  const { listeners, rules, templates } = routing(WITH_DOMAIN);
  const https = listeners.find((l) => l.Port === 443);
  const http = listeners.find((l) => l.Port === 80);

  it('serves HTTPS with the web app as the default and redirects port 80', () => {
    expect(listeners).toHaveLength(2);
    expect(https).toMatchObject({
      Protocol: 'HTTPS',
      SslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
    });
    expect(targetOf(https?.DefaultActions[0] as { TargetGroupArn?: unknown })).toBe('web');
    expect(http?.DefaultActions[0]).toMatchObject({
      Type: 'redirect',
      RedirectConfig: { Protocol: 'HTTPS', Port: '443', StatusCode: 'HTTP_301' },
    });
  });

  it('sends the host api.<domain> to the API, on the HTTPS listener only', () => {
    expect(rules).toHaveLength(1);
    const [rule] = rules;
    expect(rule?.Conditions).toHaveLength(1);
    expect(rule?.Conditions[0]?.Field).toBe('host-header');
    expect(rule?.Conditions[0]?.HostHeaderConfig?.Values).toEqual(['api.uat.labconnect.example']);
    expect(targetOf(rule?.Actions[0])).toBe('api');
    expect(JSON.stringify(rule?.ListenerArn)).toContain(https?.id ?? 'missing');
    // The base domain is not an API host.
    expect(JSON.stringify(rule?.Conditions)).not.toContain('"uat.labconnect.example"');
  });

  it('has one certificate for both names and aliases for both', () => {
    templates.edge.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'uat.labconnect.example',
      SubjectAlternativeNames: ['api.uat.labconnect.example'],
    });
    const records = resourcesOfType(templates.compute, 'AWS::Route53::RecordSet').map(
      ([, r]) => r.Properties.Name,
    );
    expect(records.sort()).toEqual(['api.uat.labconnect.example.', 'uat.labconnect.example.']);
  });

  it('without a hosted zone creates no record and leaves the certificate to be validated by hand', () => {
    const manual = synthesise({
      domainName: 'uat.labconnect.example',
      account: '111111111111',
    }).templates;
    manual.compute.resourceCountIs('AWS::Route53::RecordSet', 0);
    manual.edge.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'uat.labconnect.example',
      SubjectAlternativeNames: ['api.uat.labconnect.example'],
      ValidationMethod: 'DNS',
    });
  });

  it('keeps one firewall association whatever the layout', () => {
    templates.compute.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
    routing({}).templates.compute.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
  });

  it('keeps the API origin allowed to refresh sessions equal to the web origin', () => {
    const api = taskOf(WITH_DOMAIN, 'labconnect-uat-api');
    const origin = api.ContainerDefinitions[0]?.Environment?.find(
      (e) => e.Name === 'AUTH_ALLOWED_ORIGINS',
    );
    expect(origin?.Value).toBe('https://uat.labconnect.example');
  });
});

describe('the firewall rules mean what they say with the web app behind the same load balancer', () => {
  const { templates } = synthesise();
  const acl = resourcesOfType(templates.edge, 'AWS::WAFv2::WebACL')[0]?.[1].Properties as {
    Rules: { Name: string; Statement: { RateBasedStatement?: { ScopeDownStatement?: unknown } } }[];
  };
  const scope = (name: string) =>
    JSON.stringify(
      acl.Rules.find((r) => r.Name === name)?.Statement.RateBasedStatement?.ScopeDownStatement,
    );

  it('still limits the API paths only (/v1/auth/ and /v1/webhooks/ match what the API serves in both layouts)', () => {
    expect(scope('RateLimitAuth')).toContain('/v1/auth/');
    expect(scope('RateLimitWebhooks')).toContain('/v1/webhooks/');
    // The limit on everything has no scope-down: web pages count against it too (OQ-243).
    expect(scope('RateLimitAll')).toBeUndefined();
  });
});

describe('the Dockerfile web target and the compute stack agree', () => {
  const dockerfile = readFileSync(
    fileURLToPath(new URL('../../Dockerfile', import.meta.url)),
    'utf8',
  );
  it('listens on the port the task, the health check and the security group use', () => {
    const part = dockerfile
      .split(/^FROM /m)
      .find((p) => /\bAS web\s*$/m.test(p.split('\n')[0] ?? ''));
    expect(part).toBeDefined();
    expect(part).toMatch(/EXPOSE 3000/);
    expect(part).toMatch(/PORT=3000/);
  });
});
