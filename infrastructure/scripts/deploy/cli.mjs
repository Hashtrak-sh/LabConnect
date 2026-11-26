// Command line of the deploy scripts, used by .github/workflows/deploy-uat.yml. It reads the
// JSON an `aws` command printed from standard input, hands it to the pure functions of
// task-definition.mjs and results.mjs, and prints the answer on standard output.
// It shells out to nothing and uses only Node built-ins.
//
// Exit code: 0 the check passed; 1 the check failed (message on stderr); 2 bad usage or input.
//
//   task-definition-input --container <name> --tag <tag> [--repository <path>]   < describe-task-definition
//   run-task-arn                                                                 < run-task
//   migration-result                                                             < describe-tasks
//   rollout-result --service <name> --task-definition <arn>                      < describe-services
//   image-exists                                                                 < ecr batch-get-image
//   stack-outputs                                                                < cloudformation describe-stacks
//   health-url --base <url> [--service api|web]    (api, the default: /v1/health; web: /health)
//   health-check --status <code>                                                 < response body
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DeployCheckError } from './errors.mjs';
import {
  healthUrl,
  imageExists,
  judgeHealth,
  judgeMigrationTask,
  judgeRollout,
  judgeRunTask,
  readStackOutputs,
} from './results.mjs';
import { buildRegisterInput } from './task-definition.mjs';

class UsageError extends Error {}

/** Stack output name to the environment variable the workflow's later steps read. */
const STACK_OUTPUT_VARIABLES = {
  ClusterName: 'CLUSTER_NAME',
  MigrateTaskFamily: 'MIGRATE_FAMILY',
  PrivateSubnetIds: 'PRIVATE_SUBNET_IDS',
  MigrateSecurityGroupId: 'MIGRATE_SECURITY_GROUP_ID',
};

function readStdin() {
  return readFileSync(0, 'utf8');
}

function readJson() {
  try {
    return JSON.parse(readStdin());
  } catch {
    throw new UsageError('Standard input is not valid JSON.');
  }
}

function options(args, spec) {
  try {
    return parseArgs({ args, options: spec, allowPositionals: false, strict: true }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'Bad arguments.');
  }
}

function required(values, ...names) {
  for (const name of names) {
    if (typeof values[name] !== 'string' || values[name] === '') {
      throw new UsageError(`Missing --${name}.`);
    }
  }
}

/** Runs one command and returns what to print (without the final newline). */
function run(command, args) {
  switch (command) {
    case 'task-definition-input': {
      const v = options(args, {
        container: { type: 'string' },
        tag: { type: 'string' },
        repository: { type: 'string' },
      });
      required(v, 'container', 'tag');
      return JSON.stringify(
        buildRegisterInput(readJson(), {
          container: v.container,
          tag: v.tag,
          ...(v.repository === undefined ? {} : { repository: v.repository }),
        }),
      );
    }
    case 'run-task-arn':
      options(args, {});
      return judgeRunTask(readJson());
    case 'migration-result':
      options(args, {});
      return judgeMigrationTask(readJson());
    case 'rollout-result': {
      const v = options(args, {
        service: { type: 'string' },
        'task-definition': { type: 'string' },
      });
      required(v, 'service', 'task-definition');
      return judgeRollout(readJson(), { service: v.service, taskDefinition: v['task-definition'] });
    }
    case 'image-exists':
      options(args, {});
      return String(imageExists(readJson()));
    case 'stack-outputs': {
      options(args, {});
      const values = readStackOutputs(readJson(), Object.keys(STACK_OUTPUT_VARIABLES));
      return Object.entries(STACK_OUTPUT_VARIABLES)
        .map(([key, variable]) => `${variable}=${values[key]}`)
        .join('\n');
    }
    case 'health-url': {
      const v = options(args, { base: { type: 'string' }, service: { type: 'string' } });
      required(v, 'base');
      return healthUrl(v.base, v.service);
    }
    case 'health-check': {
      const v = options(args, { status: { type: 'string' } });
      required(v, 'status');
      return judgeHealth(Number(v.status), readStdin());
    }
    default:
      throw new UsageError(`Unknown command "${String(command)}".`);
  }
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    process.stdout.write(`${run(command, args)}\n`);
  } catch (error) {
    if (error instanceof DeployCheckError) {
      process.stderr.write(`FAILED: ${error.message}\n`);
      process.exitCode = 1;
    } else {
      process.stderr.write(`Usage error: ${error instanceof Error ? error.message : 'unknown'}\n`);
      process.exitCode = 2;
    }
  }
}

main();
