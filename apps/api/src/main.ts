import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureApp } from './app.config.js';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule);
configureApp(app);
await app.listen(process.env.PORT ?? 3001);
