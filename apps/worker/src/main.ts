import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

// Standalone application: no HTTP server. With WORKER_DATABASE_URL set, the platform jobs
// (outbox relay, audit sealing, nightly audit verification) keep the process running, and
// shutdown hooks stop them cleanly on SIGTERM. Without it, the process starts and exits.
// Queue consumers and the timer processor arrive with P3-02 and Phase 5.
const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();
