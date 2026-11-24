// Contract-test harness for apps/api (task P2-08). See docs/06-engineering/TESTING_STRATEGY.md §8.
export {
  ContractViolationError,
  contractRequest,
  expectProblemResponse,
  undocumentedRequest,
  type ContractRequestOptions,
  type ContractRequester,
} from './contract-request.js';
export {
  describeOperation,
  loadContract,
  type Contract,
  type ContractOperation,
} from './document.js';
export { clearExercised, readExercised } from './exercised.js';
export { mapRoutesToContract, registeredRoutes, type RegisteredRoute } from './routes.js';
export {
  validateProblem,
  validateRequest,
  validateResponse,
  type ExchangeRequest,
  type ExchangeResponse,
  type Violation,
} from './validate.js';
