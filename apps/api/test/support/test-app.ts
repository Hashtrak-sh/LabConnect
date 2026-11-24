import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { configureApp } from '../../src/app.config.js';
import { AppModule } from '../../src/app.module.js';

/** The whole API in-process, configured like the real server (no listening port). */
export async function createTestApp(): Promise<INestApplication<Server>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<Server>>();
  configureApp(app);
  await app.init();
  return app;
}
