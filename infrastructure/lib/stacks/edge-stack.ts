import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';
import { type InfraConfig, apiHost } from '../config.js';

export interface EdgeStackProps extends cdk.StackProps {
  config: InfraConfig;
}

/** Request limits per client address over five minutes. Starting values: tune with real traffic (OQ-132). */
export const RATE_LIMITS = {
  /** Everything. */
  all: 2000,
  /** Sign-in and token routes: the application also limits OTPs per address (API_CONVENTIONS section 7). */
  auth: 100,
  /** The unauthenticated payment-gateway callback (OQ-132: "rate limiting needed before go-live"). */
  webhooks: 300,
} as const;

/**
 * Edge: the TLS certificate and the web application firewall of the load balancer
 * (AWS_ENVIRONMENTS_AND_DEPLOYMENT.md sections 2 and 4, SECURITY_AND_PRIVACY.md section 1).
 * The firewall is attached to the load balancer in the compute stack, because the load
 * balancer is created there; doing it here would make the two stacks depend on each other.
 *
 * Not built here: CloudFront. It would need a firewall in us-east-1 and there is no web
 * application to put behind it yet (the web app is still a skeleton). See the "As built" section.
 */
export class EdgeStack extends cdk.Stack {
  readonly webAcl: wafv2.CfnWebACL;
  /** Only with a domain. */
  readonly certificate: acm.ICertificate | undefined;
  readonly hostedZone: route53.IHostedZone | undefined;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    const { config } = props;

    const host = apiHost(config);
    if (host !== undefined) {
      this.hostedZone =
        config.hostedZoneId !== undefined && config.hostedZoneName !== undefined
          ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
              hostedZoneId: config.hostedZoneId,
              zoneName: config.hostedZoneName,
            })
          : undefined;
      this.certificate = new acm.Certificate(this, 'ApiCertificate', {
        domainName: host,
        // With a hosted zone the validation record is created for you. Without one, the record
        // is shown in the ACM console and has to be added by hand before the stack finishes.
        validation:
          this.hostedZone === undefined
            ? acm.CertificateValidation.fromDns()
            : acm.CertificateValidation.fromDns(this.hostedZone),
      });
    }

    const metric = (name: string): wafv2.CfnWebACL.VisibilityConfigProperty => ({
      cloudWatchMetricsEnabled: true,
      metricName: name,
      // Sampled requests would keep request lines, query strings included (OQ-40).
      sampledRequestsEnabled: false,
    });
    const managed = (
      name: string,
      priority: number,
      overrides?: wafv2.CfnWebACL.RuleActionOverrideProperty[],
    ): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name,
          ...(overrides === undefined ? {} : { ruleActionOverrides: overrides }),
        },
      },
      visibilityConfig: metric(name),
    });
    const rateRule = (
      name: string,
      priority: number,
      limit: number,
      pathPrefix?: string,
    ): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      action: { block: {} },
      statement: {
        rateBasedStatement: {
          limit,
          aggregateKeyType: 'IP',
          evaluationWindowSec: 300,
          ...(pathPrefix === undefined
            ? {}
            : {
                scopeDownStatement: {
                  byteMatchStatement: {
                    searchString: pathPrefix,
                    fieldToMatch: { uriPath: {} },
                    positionalConstraint: 'STARTS_WITH',
                    textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
                  },
                },
              }),
        },
      },
      visibilityConfig: metric(name),
    });

    this.webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: `${config.prefix}-api`,
      description: 'LabConnect API: managed rules and rate limits',
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: metric(`${config.prefix}-api`),
      rules: [
        // Specific, tighter limits first so they are the ones that answer.
        rateRule('RateLimitWebhooks', 1, RATE_LIMITS.webhooks, '/v1/webhooks/'),
        rateRule('RateLimitAuth', 2, RATE_LIMITS.auth, '/v1/auth/'),
        rateRule('RateLimitAll', 3, RATE_LIMITS.all),
        // The webhook endpoint takes bodies up to 256 KiB (OQ-132); the rule that refuses
        // bodies over 8 KiB would block them, so it only counts.
        managed('AWSManagedRulesCommonRuleSet', 10, [
          { name: 'SizeRestrictions_BODY', actionToUse: { count: {} } },
        ]),
        managed('AWSManagedRulesKnownBadInputsRuleSet', 11),
        managed('AWSManagedRulesAmazonIpReputationList', 12),
      ],
    });
    // The firewall's own request log is not switched on: it would record query strings, which
    // carry the device location of public search (OQ-40). Switch it on only with a redaction.
  }
}
