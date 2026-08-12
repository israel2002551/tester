import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';

const server = createApp().listen(env.PORT, () => {
  console.log(JSON.stringify({ level: 'info', message: 'BUYSELL API listening', port: env.PORT, environment: env.NODE_ENV }));
});

async function shutdown(signal) {
  console.log(JSON.stringify({ level: 'info', message: 'BUYSELL API shutting down', signal }));
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

