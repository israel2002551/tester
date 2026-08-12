export async function audit(tx, req, { action, targetType, targetId, before, after }) {
  return tx.auditLog.create({
    data: {
      actorId: req.user?.id || null,
      action,
      targetType,
      targetId,
      before,
      after,
      requestId: req.id,
      ipAddress: req.ip,
      userAgent: req.get?.('user-agent') || null,
    },
  });
}

export async function outbox(tx, topic, aggregateId, payload) {
  return tx.outboxEvent.create({ data: { topic, aggregateId, payload } });
}
