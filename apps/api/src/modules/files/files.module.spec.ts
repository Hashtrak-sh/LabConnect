import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  FileService,
  FixedClock,
  InMemoryObjectStorage,
  type FilesConfig,
  type ObjectStorage,
} from '@labconnect/core';
import { describe, expect, it } from 'vitest';
import { CLOCK } from '../platform/platform.providers.js';
import { FILES_CONFIG, FilesModule, OBJECT_STORAGE } from './files.module.js';

describe('FilesModule', () => {
  it('boots with no AWS or bucket configuration and fails only at first use', async () => {
    const previous = process.env.FILES_BUCKET;
    delete process.env.FILES_BUCKET;
    try {
      const moduleRef = await Test.createTestingModule({ imports: [FilesModule] }).compile();
      expect(moduleRef.get(FileService)).toBeInstanceOf(FileService);
      expect(moduleRef.get<ObjectStorage>(OBJECT_STORAGE)).toBeDefined();
      expect(() => moduleRef.get<() => FilesConfig>(FILES_CONFIG)()).toThrow(
        'FILES_BUCKET is not set.',
      );
      await moduleRef.close();
    } finally {
      if (previous !== undefined) process.env.FILES_BUCKET = previous;
    }
  });

  it('lets a test replace the storage and the config', async () => {
    const clock = new FixedClock('2026-11-25T10:00:00Z');
    const storage = new InMemoryObjectStorage(clock);
    const config: FilesConfig = {
      bucket: 'test-bucket',
      quarantinePrefix: 'quarantine',
      cleanPrefix: 'clean',
    };
    const moduleRef = await Test.createTestingModule({ imports: [FilesModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storage)
      .overrideProvider(FILES_CONFIG)
      .useValue(() => config)
      .compile();
    expect(moduleRef.get(OBJECT_STORAGE)).toBe(storage);
    await moduleRef.close();
  });
});
