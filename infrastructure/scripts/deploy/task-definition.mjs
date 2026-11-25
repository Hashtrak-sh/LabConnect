// Builds the input of `aws ecs register-task-definition` for a new revision of a task definition
// family: the current revision (the output of `aws ecs describe-task-definition`) with the image
// of ONE container changed to another tag of the same repository, and nothing else changed.
// Pure functions over parsed JSON; no AWS call, no file access (CI_CD.md, "As built (P3-12)").

import { DeployCheckError } from './errors.mjs';

/**
 * Fields that `describe-task-definition` returns and `register-task-definition` refuses
 * (they describe a registered revision, they are not part of its definition). Everything
 * else is passed through untouched, so a field this list does not know stays as it is: if
 * AWS ever adds a read-only one, registration fails loudly instead of the script dropping
 * a setting silently.
 */
export const READ_ONLY_FIELDS = [
  'taskDefinitionArn',
  'revision',
  'status',
  'requiresAttributes',
  'compatibilities',
  'registeredAt',
  'registeredBy',
  'deregisteredAt',
];

// Docker's rule for a tag: up to 128 of letters, digits, underscore, period and dash, not
// starting with a period or dash.
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/**
 * `<registry>/<repository>:<tag>` with the tag replaced. The registry and repository part is
 * kept character for character. An image that is pinned by digest, or has no tag, is refused.
 */
export function replaceImageTag(image, tag) {
  if (typeof image !== 'string' || image === '') {
    throw new DeployCheckError('The container has no image.');
  }
  if (typeof tag !== 'string' || !TAG.test(tag)) {
    throw new DeployCheckError('The new image tag is not a valid Docker tag.');
  }
  if (image.includes('@')) {
    throw new DeployCheckError('The container image is pinned by digest, not by tag.');
  }
  const slash = image.lastIndexOf('/');
  const colon = image.indexOf(':', slash + 1);
  if (colon === -1) throw new DeployCheckError('The container image has no tag.');
  return `${image.slice(0, colon)}:${tag}`;
}

/** The repository path of an image: `labconnect/api` for `<registry>/labconnect/api:<tag>`. */
export function repositoryOf(image) {
  const withoutTag = image.slice(
    0,
    image.indexOf(':', image.lastIndexOf('/') + 1) === -1
      ? image.length
      : image.indexOf(':', image.lastIndexOf('/') + 1),
  );
  const firstSlash = withoutTag.indexOf('/');
  return firstSlash === -1 ? withoutTag : withoutTag.slice(firstSlash + 1);
}

/**
 * @param {unknown} described  parsed output of `aws ecs describe-task-definition` (an object with `taskDefinition`)
 * @param {{ container: string, tag: string, repository?: string }} options
 *   `repository`, when given, is the repository path the container's image must already be in.
 * @returns the object to give to `register-task-definition --cli-input-json`
 */
export function buildRegisterInput(described, options) {
  const definition = described?.taskDefinition;
  if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) {
    throw new DeployCheckError('The input has no "taskDefinition" object.');
  }
  if (!Array.isArray(definition.containerDefinitions)) {
    throw new DeployCheckError('The task definition has no container definitions.');
  }
  const matches = definition.containerDefinitions.filter((c) => c?.name === options.container);
  if (matches.length === 0) {
    throw new DeployCheckError(
      `The task definition has no container named "${options.container}".`,
    );
  }
  if (matches.length > 1) {
    throw new DeployCheckError(
      `The task definition has several containers named "${options.container}".`,
    );
  }
  if (options.repository !== undefined && repositoryOf(matches[0].image) !== options.repository) {
    throw new DeployCheckError(
      `The image of container "${options.container}" is not in repository "${options.repository}".`,
    );
  }
  const newImage = replaceImageTag(matches[0].image, options.tag);

  const input = {};
  for (const [key, value] of Object.entries(definition)) {
    if (!READ_ONLY_FIELDS.includes(key)) input[key] = structuredClone(value);
  }
  input.containerDefinitions = input.containerDefinitions.map((container) =>
    container.name === options.container ? { ...container, image: newImage } : container,
  );
  return input;
}
