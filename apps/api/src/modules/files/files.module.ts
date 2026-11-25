import { Module, type Provider } from '@nestjs/common';
import {
  AuditService,
  type Clock,
  createS3StorageFromEnv,
  FileService,
  type FilesConfig,
  LazyObjectStorage,
  type ObjectStorage,
  OutboxService,
  readFilesConfig,
} from '@labconnect/core';
import { CLOCK } from '../platform/platform.providers.js';
import { PlatformModule } from '../platform/platform.module.js';

/** The object store (S3). Built at first use, so the API boots without AWS configuration. */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
/** `() => FilesConfig`, read at first use (`FILES_BUCKET` and the prefixes). */
export const FILES_CONFIG = Symbol('FILES_CONFIG');

export const filesProviders: Provider[] = [
  {
    provide: OBJECT_STORAGE,
    useFactory: (clock: Clock): ObjectStorage =>
      new LazyObjectStorage(() => createS3StorageFromEnv(clock)),
    inject: [CLOCK],
  },
  { provide: FILES_CONFIG, useFactory: (): (() => FilesConfig) => () => readFilesConfig() },
  {
    provide: FileService,
    useFactory: (
      clock: Clock,
      audit: AuditService,
      outbox: OutboxService,
      storage: ObjectStorage,
      config: () => FilesConfig,
    ) => new FileService({ clock, audit, outbox, storage, config }),
    inject: [CLOCK, AuditService, OutboxService, OBJECT_STORAGE, FILES_CONFIG],
  },
];

/**
 * Files (P3-06): upload URLs, scan state and download URLs, as `FileService` from
 * `@labconnect/core`. This module has no controllers on purpose: the endpoints that ask for
 * an upload or a download belong to the modules that own the thing a file is attached to,
 * because they must decide first whether the caller may (TENANT_ISOLATION.md rule 8), with
 * the guards of task P3-04. Those modules import this one and call `FileService` inside their
 * own transaction, then presign after it commits.
 */
@Module({
  imports: [PlatformModule],
  providers: filesProviders,
  exports: [FileService, OBJECT_STORAGE, FILES_CONFIG],
})
export class FilesModule {}
