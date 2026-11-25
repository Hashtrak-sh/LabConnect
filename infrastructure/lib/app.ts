import * as cdk from 'aws-cdk-lib';
import { type InfraConfig, loadConfig } from './config.js';
import { stackName } from './names.js';
import { ComputeStack } from './stacks/compute-stack.js';
import { DataStack } from './stacks/data-stack.js';
import { DeliveryStack } from './stacks/delivery-stack.js';
import { EdgeStack } from './stacks/edge-stack.js';
import { MessagingStack } from './stacks/messaging-stack.js';
import { NetworkStack } from './stacks/network-stack.js';
import { ObservabilityStack } from './stacks/observability-stack.js';

export interface LabConnectStacks {
  config: InfraConfig;
  delivery: DeliveryStack;
  network: NetworkStack;
  data: DataStack;
  messaging: MessagingStack;
  edge: EdgeStack;
  compute: ComputeStack;
  observability: ObservabilityStack;
}

/**
 * Builds the stacks of one environment into `app`. Parameters come from the app's CDK
 * context. Only environments listed in `KNOWN_STAGES` exist; asking for any other (production
 * included) throws before anything is created.
 *
 * With no account the stacks are environment-agnostic, which is enough to synthesise and
 * test; `cdk deploy` supplies the account from the credentials in use (or `-c account=`).
 */
export function createLabConnectStacks(app: cdk.App): LabConnectStacks {
  const config = loadConfig((key) => app.node.tryGetContext(key) as unknown);
  const env: cdk.Environment = {
    region: config.region,
    ...(config.account === undefined ? {} : { account: config.account }),
  };
  const common = (part: string): cdk.StackProps => ({
    stackName: stackName(config, part),
    env,
    description: `LabConnect ${config.stage}: ${part}`,
    tags: { Project: 'LabConnect', Environment: config.stage, ManagedBy: 'cdk' },
  });

  const delivery = new DeliveryStack(app, 'Delivery', { ...common('delivery'), config });
  const network = new NetworkStack(app, 'Network', { ...common('network'), config });
  const data = new DataStack(app, 'Data', { ...common('data'), config, network });
  const messaging = new MessagingStack(app, 'Messaging', { ...common('messaging'), config, data });
  const edge = new EdgeStack(app, 'Edge', { ...common('edge'), config });
  const compute = new ComputeStack(app, 'Compute', {
    ...common('compute'),
    config,
    network,
    data,
    messaging,
    edge,
    delivery,
  });
  const observability = new ObservabilityStack(app, 'Observability', {
    ...common('observability'),
    config,
    data,
    messaging,
    compute,
  });
  return { config, delivery, network, data, messaging, edge, compute, observability };
}
