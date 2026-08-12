export async function serializable(db, work, { attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await db.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      lastError = error;
      if (error?.code !== 'P2034' || attempt === attempts - 1) throw error;
    }
  }
  throw lastError;
}

export async function advisoryLock(tx, namespace, id) {
  if (typeof tx.$queryRaw !== 'function') return;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${namespace}:${id}`}, 0))`;
}
