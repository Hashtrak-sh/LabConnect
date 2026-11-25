import base from '@labconnect/config/eslint';

export default [
  ...base,
  {
    // packages/core takes every instant from an injected Clock (ADR-020, TESTING_STRATEGY.md
    // section 6). Only SystemClock reads the system clock, and it says so with a disable comment.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Use the injected Clock instead of new Date().',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Use the injected Clock instead of Date.now().',
        },
      ],
    },
  },
];
