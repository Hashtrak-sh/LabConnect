import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { logRetention } from '../retention.js';
import type { Construct } from 'constructs';
import type { InfraConfig } from '../config.js';
import { API_PORT, WEB_PORT } from '../names.js';

export interface NetworkStackProps extends cdk.StackProps {
  config: InfraConfig;
}

/**
 * Network (AWS_ENVIRONMENTS_AND_DEPLOYMENT.md section 2): public subnets for the load
 * balancer and the NAT gateway, private subnets for the tasks, isolated subnets (no route to
 * the internet) for the database. Gateway endpoint for S3 and interface endpoints for ECR,
 * SQS, KMS, Secrets Manager and CloudWatch Logs keep that traffic off the NAT gateway.
 *
 * All security groups and their rules live here, so that no other stack edits them.
 */
export class NetworkStack extends cdk.Stack {
  readonly vpc: ec2.Vpc;
  readonly albSecurityGroup: ec2.SecurityGroup;
  readonly apiSecurityGroup: ec2.SecurityGroup;
  readonly webSecurityGroup: ec2.SecurityGroup;
  readonly workerSecurityGroup: ec2.SecurityGroup;
  readonly migrateSecurityGroup: ec2.SecurityGroup;
  readonly databaseSecurityGroup: ec2.SecurityGroup;
  readonly searchSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const { config } = props;

    const flowLogGroup = new logs.LogGroup(this, 'FlowLogs', {
      logGroupName: `/labconnect/${config.stage}/vpc-flow`,
      retention: logRetention(config),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.20.0.0/16'),
      maxAzs: config.azCount,
      natGateways: config.natGateways,
      restrictDefaultSecurityGroup: true,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
          mapPublicIpOnLaunch: false,
        },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      flowLogs: {
        all: {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup),
          trafficType: ec2.FlowLogTrafficType.REJECT,
        },
      },
    });

    // ---- security groups. None allows 0.0.0.0/0 inbound except the load balancer.
    this.albSecurityGroup = this.group('Alb', 'Load balancer: the only public entry');
    this.apiSecurityGroup = this.group('Api', 'API tasks');
    this.webSecurityGroup = this.group(
      'Web',
      'Web tasks (Next.js server): from the load balancer only',
    );
    this.workerSecurityGroup = this.group('Worker', 'Worker tasks: no inbound at all');
    this.migrateSecurityGroup = this.group('Migrate', 'One-off migration and seed task');
    this.databaseSecurityGroup = this.group('Database', 'RDS: reachable from the tasks only');
    this.searchSecurityGroup = this.group('Search', 'OpenSearch (optional): from the tasks only');

    if (config.domainName !== undefined) {
      this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
      this.albSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(80),
        'HTTP, answered with a redirect to HTTPS',
      );
    }
    // Without a domain there is no certificate, so the listener is plain HTTP and is open to the
    // listed addresses only. With a domain the same list narrows nothing: it adds nothing either.
    for (const cidr of config.ingressCidrs) {
      this.albSecurityGroup.addIngressRule(
        ec2.Peer.ipv4(cidr),
        ec2.Port.tcp(config.domainName === undefined ? 80 : 443),
        'Allowed client range',
      );
    }
    this.albSecurityGroup.addEgressRule(
      this.apiSecurityGroup,
      ec2.Port.tcp(API_PORT),
      'To the API tasks',
    );
    this.apiSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(API_PORT),
      'From the load balancer',
    );

    // The web server. Visitors reach it through the load balancer; it reaches the API directly,
    // inside the VPC, by the API's private name (compute stack, Cloud Map), never through the
    // load balancer. The API admits the web group on its port and nothing else new.
    this.albSecurityGroup.addEgressRule(
      this.webSecurityGroup,
      ec2.Port.tcp(WEB_PORT),
      'To the web tasks',
    );
    this.webSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(WEB_PORT),
      'From the load balancer',
    );
    this.webSecurityGroup.addEgressRule(
      this.apiSecurityGroup,
      ec2.Port.tcp(API_PORT),
      'To the API tasks (server-side calls)',
    );
    this.apiSecurityGroup.addIngressRule(
      this.webSecurityGroup,
      ec2.Port.tcp(API_PORT),
      'From the web tasks (server-side calls)',
    );
    // The web task starts by pulling its image and writing logs through the endpoints below, which
    // are reached on 443. It calls nothing on the internet itself. (The VPC resolver that answers
    // for the API's private name is not filtered by security groups.)
    this.webSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'web: HTTPS to the AWS endpoints (image pull, logs)',
    );

    for (const [name, group] of [
      ['API', this.apiSecurityGroup],
      ['worker', this.workerSecurityGroup],
      ['migration', this.migrateSecurityGroup],
    ] as const) {
      // AWS APIs (SES, STS and the rest) are reached through the NAT gateway on 443; S3, SQS,
      // KMS, ECR, Secrets Manager and Logs go through the endpoints below.
      group.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), `${name}: HTTPS to AWS`);
      group.addEgressRule(this.databaseSecurityGroup, ec2.Port.tcp(5432), `${name}: PostgreSQL`);
      this.databaseSecurityGroup.addIngressRule(
        group,
        ec2.Port.tcp(5432),
        `PostgreSQL from ${name}`,
      );
      this.searchSecurityGroup.addIngressRule(group, ec2.Port.tcp(443), `OpenSearch from ${name}`);
    }

    // ---- endpoints
    this.vpc.addGatewayEndpoint('S3', { service: ec2.GatewayVpcEndpointAwsService.S3 });
    const endpointGroup = this.group('Endpoints', 'Interface endpoints: HTTPS from inside the VPC');
    endpointGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'HTTPS from the VPC',
    );
    const interfaceServices: Record<string, ec2.InterfaceVpcEndpointAwsService> = {
      EcrApi: ec2.InterfaceVpcEndpointAwsService.ECR,
      EcrDocker: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      Sqs: ec2.InterfaceVpcEndpointAwsService.SQS,
      Kms: ec2.InterfaceVpcEndpointAwsService.KMS,
      SecretsManager: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      CloudWatchLogs: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    };
    for (const [name, service] of Object.entries(interfaceServices)) {
      this.vpc.addInterfaceEndpoint(name, {
        service,
        securityGroups: [endpointGroup],
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        privateDnsEnabled: true,
      });
    }
    // Interface endpoints are reached on 443; the task groups already allow 443 outbound.
  }

  private group(id: string, description: string): ec2.SecurityGroup {
    return new ec2.SecurityGroup(this, `${id}Sg`, {
      vpc: this.vpc,
      description,
      // Every outbound rule is written out above, none is implied.
      allowAllOutbound: false,
    });
  }
}
