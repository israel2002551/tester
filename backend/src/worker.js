import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { processOutboxBatch } from './services/outbox.js';
import { expireInventoryReservations } from './services/orders.js';

let stopping = false;
async function cycle() {
  if (stopping) return;
  const results = await processOutboxBatch(prisma, { limit: 50 });
  await expireInventoryReservations(prisma, { limit: 100 });
  const failed = results.filter((result) => !result.ok);
  if (results.length) console.log(JSON.stringify({ level: failed.length ? 'warn' : 'info', message: 'Outbox batch processed', processed: results.length, failed: failed.length }));
}

const timer = setInterval(() => cycle().catch((error) => console.error(JSON.stringify({ level: 'error', message: 'Outbox cycle failed', error: error.message }))), 5_000);
timer.unref();
console.log(JSON.stringify({ level: 'info', message: 'BUYSELL outbox worker started', environment: env.NODE_ENV }));
cycle().catch((error) => console.error(JSON.stringify({ level: 'error', message: 'Initial outbox cycle failed', error: error.message })));

async function shutdown() {
  stopping = true;
  clearInterval(timer);
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
