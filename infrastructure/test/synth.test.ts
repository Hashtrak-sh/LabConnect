import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { WITH_DOMAIN, resourcesOfType, single, synthesise } from './helpers.js';

describe('synthesis', () => {
  it('synthesises for uat without a domain or an account', () => {
    const { stacks, templates } = synthesise();
    expect(stacks.config.stage).toBe('uat');
    for (const template of Object.values(templates)) {
      expect(Object.keys(template.toJSON().Resources as object).length).toBeGreaterThan(0);
    }
    // No certificate, no DNS record, no hosted zone lookup: the default load balancer name is used.
    templates.edge.resourceCountIs('AWS::CertificateManager::Certificate', 0);
    templates.compute.resourceCountIs('AWS::Route53::RecordSet', 0);
    templates.compute.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      Protocol: 'HTTP',
      DefaultActions: [Match.objectLike({ Type: 'forward' })],
    });
    templates.compute.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 1);
  });

  it('synthesises for uat with a domain', () => {
    const { templates } = synthesise(WITH_DOMAIN);
    templates.edge.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'api.uat.labconnect.example',
      ValidationMethod: 'DNS',
    });
    templates.compute.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'api.uat.labconnect.example.',
      Type: 'A',
    });
    templates.compute.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      Protocol: 'HTTPS',
      SslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
    });
    // Port 80 only redirects.
    templates.compute.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      DefaultActions: [
        Match.objectLike({
          Type: 'redirect',
          RedirectConfig: Match.objectLike({
            Protocol: 'HTTPS',
            Port: '443',
            StatusCode: 'HTTP_301',
          }),
        }),
      ],
    });
  });

  it('puts the web origin into CORS and the allowed origins when there is a domain', () => {
    const { templates } = synthesise(WITH_DOMAIN);
    templates.data.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: [
          Match.objectLike({
            AllowedOrigins: ['https://uat.labconnect.example'],
            AllowedMethods: ['PUT'],
          }),
        ],
      },
    });
  });

  it('writes no CORS rule without a web origin, and never a wildcard origin', () => {
    const { templates } = synthesise();
    const bucket = single(templates.data, 'AWS::S3::Bucket');
    expect(bucket.Properties.CorsConfiguration).toBeUndefined();
    const withDomain = JSON.stringify(synthesise(WITH_DOMAIN).templates.data.toJSON());
    expect(withDomain).not.toContain('"AllowedOrigins":["*"]');
  });

  it('refuses plain-HTTP exposure without an allow-list: no ingress at all', () => {
    const { templates } = synthesise();
    const alb = resourcesOfType(templates.network, 'AWS::EC2::SecurityGroup').find(([id]) =>
      id.startsWith('AlbSg'),
    );
    expect(alb?.[1].Properties.SecurityGroupIngress).toBeUndefined();
  });

  it('opens the plain-HTTP listener only to the listed client ranges', () => {
    const { templates } = synthesise({ ingressCidrs: '203.0.113.0/24' });
    templates.network.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: [
        Match.objectLike({ CidrIp: '203.0.113.0/24', FromPort: 80, ToPort: 80 }),
      ],
    });
  });

  it('can add OpenSearch with basic authentication and keeps it off by default', () => {
    expect(synthesise().templates.data.findResources('AWS::OpenSearchService::Domain')).toEqual({});
    const { templates } = synthesise({ enableOpenSearch: 'true' });
    templates.data.hasResourceProperties('AWS::OpenSearchService::Domain', {
      EncryptionAtRestOptions: Match.objectLike({ Enabled: true }),
      NodeToNodeEncryptionOptions: { Enabled: true },
      DomainEndpointOptions: Match.objectLike({ EnforceHTTPS: true }),
      AdvancedSecurityOptions: Match.objectLike({ Enabled: true }),
      VPCOptions: Match.objectLike({ SubnetIds: Match.anyValue() }),
    });
  });

  it('puts every deployable piece into a named stack of the uat environment', () => {
    const { stacks } = synthesise();
    const names = [
      stacks.delivery,
      stacks.network,
      stacks.data,
      stacks.messaging,
      stacks.edge,
      stacks.compute,
      stacks.observability,
    ].map((stack) => stack.stackName);
    expect(names).toEqual([
      'LabConnect-uat-delivery',
      'LabConnect-uat-network',
      'LabConnect-uat-data',
      'LabConnect-uat-messaging',
      'LabConnect-uat-edge',
      'LabConnect-uat-compute',
      'LabConnect-uat-observability',
    ]);
    // The data and delivery stacks cannot be deleted by accident.
    expect(stacks.data.terminationProtection).toBe(true);
    expect(stacks.delivery.terminationProtection).toBe(true);
  });

  it('names no real payment gateway anywhere', () => {
    const text = JSON.stringify(synthesise().all).toLowerCase();
    expect(text).not.toContain('icici');
    expect(text).not.toContain('razorpay');
    expect(text).not.toContain('payu');
  });
});
