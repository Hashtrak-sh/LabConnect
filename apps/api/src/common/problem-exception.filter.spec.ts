import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BookingError } from '@labconnect/core';
import { ERROR_CODE_LIST } from '@labconnect/shared';
import { describe, expect, it } from 'vitest';
import { DomainError } from './domain-error.js';
import { toProblem } from './problem-exception.filter.js';

describe('DomainError', () => {
  it('takes its status from the shared catalogue', () => {
    expect(new DomainError('SLOT_UNAVAILABLE').status).toBe(409);
    expect(new DomainError('RATE_LIMITED').status).toBe(429);
  });
});

describe('toProblem', () => {
  it('maps an error of packages/core like a DomainError', () => {
    const error = new BookingError('INVALID_STATE_TRANSITION', {
      detail: 'T-03 cannot leave PAID.',
      meta: { currentState: 'PAID' },
    });
    expect(toProblem(error, 'r2')).toEqual({
      type: 'https://labconnect/errors/invalid-state-transition',
      title: 'Invalid state transition',
      status: error.status,
      code: 'INVALID_STATE_TRANSITION',
      detail: 'T-03 cannot leave PAID.',
      requestId: 'r2',
      meta: { currentState: 'PAID' },
    });
  });

  it('maps a DomainError', () => {
    const problem = toProblem(new DomainError('NOT_FOUND', { detail: 'No such booking.' }), 'r1');
    expect(problem).toEqual({
      type: 'https://labconnect/errors/not-found',
      title: 'Not found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'No such booking.',
      requestId: 'r1',
    });
  });

  it('uses a title and type for every catalogue code', () => {
    for (const code of ERROR_CODE_LIST) {
      const problem = toProblem(new DomainError(code), 'r');
      expect(problem.code).toBe(code);
      expect(problem.title.length).toBeGreaterThan(0);
      expect(problem.type).toMatch(/^https:\/\/labconnect\/errors\/[a-z-]+$/);
    }
  });

  it('maps framework exceptions by status', () => {
    expect(toProblem(new NotFoundException('Cannot GET /x'), 'r')).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      detail: 'The requested resource was not found.',
    });
    expect(toProblem(new BadRequestException('x'), 'r')).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Bad request',
    });
  });

  it('maps a body-parser style error by its status', () => {
    const error = Object.assign(new Error('Unexpected token'), {
      status: 413,
      statusCode: 413,
      expose: true,
    });
    const problem = toProblem(error, 'r');
    expect(problem.status).toBe(413);
    expect(JSON.stringify(problem)).not.toContain('Unexpected token');
  });

  it('turns unknown errors into a generic 500', () => {
    for (const thrown of [
      new Error('secret'),
      'secret',
      { status: 400, message: 'secret' },
      null,
    ]) {
      const problem = toProblem(thrown, 'r');
      expect(problem).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', requestId: 'r' });
      expect(JSON.stringify(problem)).not.toContain('secret');
    }
  });
});
