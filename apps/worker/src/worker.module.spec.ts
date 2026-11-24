import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { WorkerModule } from './worker.module.js';

describe('WorkerModule', () => {
  it('boots as a standalone application context', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    expect(moduleRef.get(WorkerModule)).toBeInstanceOf(WorkerModule);
    await moduleRef.close();
  });
});
