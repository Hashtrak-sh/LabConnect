import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../src/app.config.js';
import { AppModule } from '../src/app.module.js';

describe('GET /v1/health', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports ok under the /v1 prefix', async () => {
    const response = await request(app.getHttpServer()).get('/v1/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('does not serve routes outside the /v1 prefix', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });
});
