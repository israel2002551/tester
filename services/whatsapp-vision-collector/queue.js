/**
 * A small keyed async queue. Jobs for one key always run in order, while jobs
 * for different keys can use the configured concurrency. This is important for
 * WhatsApp albums: a seller's image messages and a later price must be combined
 * in receive order, but another seller should not have to wait for that work.
 */
export class KeyedTaskQueue {
  constructor({ name = 'queue', concurrency = 1, onError = null } = {}) {
    this.name = name;
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.onError = onError;
    this.pendingByKey = new Map();
    this.activeKeys = new Set();
    this.active = 0;
  }

  get pending() {
    let total = 0;
    for (const jobs of this.pendingByKey.values()) total += jobs.length;
    return total;
  }

  get snapshot() {
    return {
      name: this.name,
      pending: this.pending,
      active: this.active,
      concurrency: this.concurrency,
    };
  }

  enqueue(key, task) {
    if (typeof task !== 'function') throw new TypeError(`${this.name} task must be a function.`);
    const queueKey = String(key || '__default__');
    return new Promise((resolve, reject) => {
      const jobs = this.pendingByKey.get(queueKey) || [];
      jobs.push({ task, resolve, reject });
      this.pendingByKey.set(queueKey, jobs);
      this.drain();
    });
  }

  drain() {
    while (this.active < this.concurrency) {
      const next = [...this.pendingByKey.entries()].find(([key, jobs]) => jobs.length > 0 && !this.activeKeys.has(key));
      if (!next) return;
      const [key, jobs] = next;
      const job = jobs.shift();
      if (jobs.length === 0) this.pendingByKey.delete(key);
      this.run(key, job);
    }
  }

  async run(key, job) {
    this.active += 1;
    this.activeKeys.add(key);
    try {
      job.resolve(await job.task());
    } catch (error) {
      try {
        this.onError?.(error, key);
      } catch {
        // Reporting a queue error must never prevent the next job from running.
      }
      job.reject(error);
    } finally {
      this.active -= 1;
      this.activeKeys.delete(key);
      this.drain();
    }
  }
}
