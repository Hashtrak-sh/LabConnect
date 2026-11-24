import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

// Standalone application: no HTTP server. With no consumers or timers registered
// yet, the process starts and exits. The outbox relay, queue consumers and the
// timer processor arrive in Phase 3 (P3-01, P3-02).
const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();
