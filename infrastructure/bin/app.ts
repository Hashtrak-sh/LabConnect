import * as cdk from 'aws-cdk-lib';
import { createLabConnectStacks } from '../lib/app.js';

// `cdk synth -c stage=uat -c domainName=... ` (see infrastructure/README.md). `cdk.json` runs
// the compiled file: `pnpm --filter @labconnect/infrastructure build` first.
createLabConnectStacks(new cdk.App());
