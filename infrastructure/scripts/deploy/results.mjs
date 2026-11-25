// Decisions of `deploy-uat.yml` over the JSON the AWS CLI prints. Each function reads parsed
// JSON, returns a short summary on success and throws a DeployCheckError on anything it does
// not positively recognise as success. No AWS call, no file access, no shell.
import { DeployCheckError } from './errors.mjs';

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function failuresOf(output, what) {
  if (!isObject(output)) throw new DeployCheckError(`${what}: the AWS answer is not an object.`);
  const failures = output.failures;
  if (failures !== undefined && !Array.isArray(failures)) {
    throw new DeployCheckError(`${what}: "failures" is not a list.`);
  }
  if (failures !== undefined && failures.length > 0) {
    // Only the reason code, which names no secret: never the whole entry.
    const reasons = failures.map((f) => (typeof f?.reason === 'string' ? f.reason : 'unknown'));
    throw new DeployCheckError(`${what}: AWS reported failures: ${reasons.join(', ')}.`);
  }
}

/** `run-task` output: exactly one task and no failure. Returns the task's ARN. */
export function judgeRunTask(output) {
  failuresOf(output, 'run-task');
  const tasks = output.tasks;
  if (!Array.isArray(tasks) || tasks.length !== 1) {
    throw new DeployCheckError('run-task: expected exactly one started task.');
  }
  const arn = tasks[0]?.taskArn;
  if (typeof arn !== 'string' || arn === '') {
    throw new DeployCheckError('run-task: the started task has no ARN.');
  }
  return arn;
}

/**
 * `describe-tasks` output of the migration task after it stopped. It succeeded only if the task
 * is STOPPED, stopped because its essential container exited, there is exactly one container,
 * and that container's exit code is the number 0.
 */
export function judgeMigrationTask(output) {
  failuresOf(output, 'describe-tasks');
  const tasks = output.tasks;
  if (!Array.isArray(tasks) || tasks.length !== 1) {
    throw new DeployCheckError('describe-tasks: expected exactly one task.');
  }
  const task = tasks[0];
  if (task?.lastStatus !== 'STOPPED') {
    throw new DeployCheckError(
      `The migration task is not stopped (status ${String(task?.lastStatus)}).`,
    );
  }
  const containers = task.containers;
  if (!Array.isArray(containers) || containers.length !== 1) {
    throw new DeployCheckError('The migration task must have exactly one container.');
  }
  const container = containers[0];
  if (task.stopCode !== 'EssentialContainerExited') {
    const reason = typeof task.stoppedReason === 'string' ? ` (${task.stoppedReason})` : '';
    throw new DeployCheckError(
      `The migration task did not stop because its container exited: stop code ${String(task.stopCode)}${reason}.`,
    );
  }
  if (container?.exitCode === undefined || container.exitCode === null) {
    const reason = typeof container?.reason === 'string' ? ` (${container.reason})` : '';
    throw new DeployCheckError(`The migration container reported no exit code${reason}.`);
  }
  if (container.exitCode !== 0) {
    throw new DeployCheckError(
      `The migration container exited with code ${String(container.exitCode)}. Its output is in the migrate log group.`,
    );
  }
  return `migration task finished with exit code 0 (container ${String(container.name)})`;
}

/**
 * `describe-services` output after `aws ecs wait services-stable`. "Stable" is not enough: with
 * the deployment circuit breaker and rollback, a service that failed to start the new version
 * is stable again on the OLD one. So the new task definition must be the PRIMARY deployment,
 * its rollout must be COMPLETED, nothing else may still be rolling, and the counts must match.
 */
export function judgeRollout(output, expected) {
  failuresOf(output, 'describe-services');
  const services = output.services;
  if (!Array.isArray(services) || services.length !== 1) {
    throw new DeployCheckError('describe-services: expected exactly one service.');
  }
  const service = services[0];
  const name = `service ${expected.service}`;
  if (service?.serviceName !== expected.service) {
    throw new DeployCheckError(`describe-services: the answer is not for ${name}.`);
  }
  if (service.status !== 'ACTIVE') {
    throw new DeployCheckError(`The ${name} is not ACTIVE (status ${String(service.status)}).`);
  }
  const deployments = service.deployments;
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new DeployCheckError(`The ${name} has no deployments.`);
  }
  const primary = deployments.filter((d) => d?.status === 'PRIMARY');
  if (primary.length !== 1) {
    throw new DeployCheckError(`The ${name} must have exactly one PRIMARY deployment.`);
  }
  const [current] = primary;
  if (current.taskDefinition !== expected.taskDefinition) {
    throw new DeployCheckError(
      `The primary deployment of ${name} does not run the new task definition: it was rolled back or never switched.`,
    );
  }
  if (current.rolloutState !== 'COMPLETED') {
    const reason =
      typeof current.rolloutStateReason === 'string' ? ` (${current.rolloutStateReason})` : '';
    throw new DeployCheckError(
      `The rollout of ${name} is ${String(current.rolloutState)}, not COMPLETED${reason}.`,
    );
  }
  if (deployments.length !== 1) {
    throw new DeployCheckError(`The ${name} still has more than one deployment.`);
  }
  if (!Number.isInteger(service.desiredCount) || service.desiredCount < 1) {
    throw new DeployCheckError(`The ${name} has no desired tasks: nothing is running to verify.`);
  }
  if (service.runningCount !== service.desiredCount || (service.pendingCount ?? 0) !== 0) {
    throw new DeployCheckError(
      `The ${name} runs ${String(service.runningCount)} of ${String(service.desiredCount)} desired tasks (${String(service.pendingCount)} pending).`,
    );
  }
  if (current.runningCount !== current.desiredCount) {
    throw new DeployCheckError(`The new deployment of ${name} does not run all its desired tasks.`);
  }
  return `${name} runs ${String(service.runningCount)} task(s) of the new task definition, rollout COMPLETED`;
}

/**
 * `ecr batch-get-image` output for one tag: true if the image exists, false if ECR says there
 * is no such image, an error for any other answer (so a permission or API problem is not
 * mistaken for "not there yet").
 */
export function imageExists(output) {
  if (!isObject(output))
    throw new DeployCheckError('batch-get-image: the AWS answer is not an object.');
  const images = Array.isArray(output.images) ? output.images : [];
  const failures = Array.isArray(output.failures) ? output.failures : [];
  if (images.length === 1 && failures.length === 0) return true;
  if (images.length === 0 && failures.length === 1) {
    if (failures[0]?.failureCode === 'ImageNotFound') return false;
    throw new DeployCheckError(
      `batch-get-image: unexpected failure code ${String(failures[0]?.failureCode)}.`,
    );
  }
  throw new DeployCheckError('batch-get-image: unexpected answer.');
}

// Stack outputs become environment variables of later steps, so only these characters pass:
// no whitespace, quote, `$`, newline or other character a shell or the env file could act on.
const OUTPUT_VALUE = /^[A-Za-z0-9_.,:/-]{1,2000}$/;

/** `describe-stacks` output: the named outputs of the one stack, each checked. */
export function readStackOutputs(output, keys) {
  if (!isObject(output) || !Array.isArray(output.Stacks) || output.Stacks.length !== 1) {
    throw new DeployCheckError('describe-stacks: expected exactly one stack.');
  }
  const outputs = output.Stacks[0]?.Outputs;
  if (!Array.isArray(outputs)) throw new DeployCheckError('The stack has no outputs.');
  const result = {};
  for (const key of keys) {
    const found = outputs.filter((o) => o?.OutputKey === key);
    if (found.length !== 1) throw new DeployCheckError(`The stack has no single output "${key}".`);
    const value = found[0].OutputValue;
    if (typeof value !== 'string' || !OUTPUT_VALUE.test(value)) {
      throw new DeployCheckError(
        `The stack output "${key}" is empty or has unexpected characters.`,
      );
    }
    result[key] = value;
  }
  return result;
}

/** `<base>/v1/health` from the configured base URL, which must be a plain http(s) origin. */
export function healthUrl(base) {
  if (typeof base !== 'string' || !/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/?$/.test(base.trim())) {
    throw new DeployCheckError(
      'UAT_API_BASE_URL must be an http or https origin such as https://api.uat.example (no path, query or credentials).',
    );
  }
  return `${base.trim().replace(/\/$/, '')}/v1/health`;
}

/** The liveness answer is `{"status":"ok"}` with status 200 (health.service.ts, contract HealthStatus). */
export function judgeHealth(status, body) {
  if (status !== 200)
    throw new DeployCheckError(`The health check answered ${String(status)}, not 200.`);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new DeployCheckError('The health check body is not JSON.');
  }
  if (!isObject(parsed) || Object.keys(parsed).length !== 1 || parsed.status !== 'ok') {
    throw new DeployCheckError('The health check body is not {"status":"ok"}.');
  }
  return 'health check answered 200 {"status":"ok"}';
}
