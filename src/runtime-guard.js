// Lifecycle-safe timers, circuit breakers, and host-isolating execution guards.

export class ManagedTimers {
  constructor(host = globalThis) {
    this.host = host;
    this.intervals = new Set();
    this.timeouts = new Set();
    this.disposed = false;
  }

  setInterval(fn, ms) {
    if (this.disposed) return null;
    const set = typeof this.host?.setInterval === "function" ? this.host.setInterval.bind(this.host) : setInterval;
    const id = set(fn, ms);
    this.intervals.add(id);
    return id;
  }

  setTimeout(fn, ms) {
    if (this.disposed) return null;
    const set = typeof this.host?.setTimeout === "function" ? this.host.setTimeout.bind(this.host) : setTimeout;
    let id = null;
    id = set(() => {
      this.timeouts.delete(id);
      fn();
    }, ms);
    this.timeouts.add(id);
    return id;
  }

  clear(id) {
    if (id == null) return;
    const clrInt = typeof this.host?.clearInterval === "function" ? this.host.clearInterval.bind(this.host) : clearInterval;
    const clrOut = typeof this.host?.clearTimeout === "function" ? this.host.clearTimeout.bind(this.host) : clearTimeout;
    if (this.intervals.has(id)) {
      this.intervals.delete(id);
      clrInt(id);
    }
    if (this.timeouts.has(id)) {
      this.timeouts.delete(id);
      clrOut(id);
    }
  }

  dispose() {
    this.disposed = true;
    const clrInt = typeof this.host?.clearInterval === "function" ? this.host.clearInterval.bind(this.host) : clearInterval;
    const clrOut = typeof this.host?.clearTimeout === "function" ? this.host.clearTimeout.bind(this.host) : clearTimeout;
    for (const id of this.intervals) {
      try { clrInt(id); } catch { /* already gone */ }
    }
    for (const id of this.timeouts) {
      try { clrOut(id); } catch { /* already gone */ }
    }
    this.intervals.clear();
    this.timeouts.clear();
  }

  get size() {
    return this.intervals.size + this.timeouts.size;
  }
}

export class CircuitBreaker {
  constructor({ threshold = 3, cooldownMs = 60000 } = {}) {
    this.threshold = Math.max(1, Number(threshold) || 3);
    this.cooldownMs = Math.max(1000, Number(cooldownMs) || 60000);
    this.failures = 0;
    this.openUntil = 0;
    this.lastError = "";
  }

  canRun(now = Date.now()) {
    return !this.openUntil || now >= this.openUntil;
  }

  recordSuccess() {
    this.failures = 0;
    this.openUntil = 0;
    this.lastError = "";
  }

  recordFailure(error, now = Date.now()) {
    this.failures += 1;
    this.lastError = error?.message || String(error || "");
    if (this.failures >= this.threshold) {
      this.openUntil = now + this.cooldownMs;
    }
  }

  reset() {
    this.recordSuccess();
  }

  snapshot(now = Date.now()) {
    const state = !this.openUntil ? "closed" : now < this.openUntil ? "open" : "half-open";
    return {
      state,
      failures: this.failures,
      openUntil: this.openUntil,
      lastError: this.lastError,
    };
  }
}

export async function safeRun(label, fn, { breaker = null, now = Date.now(), onError = null } = {}) {
  if (breaker && !breaker.canRun(now)) {
    return { ok: false, skipped: true, value: undefined, error: null };
  }
  try {
    const value = await fn();
    breaker?.recordSuccess();
    return { ok: true, skipped: false, value, error: null };
  } catch (error) {
    breaker?.recordFailure(error, now);
    if (typeof onError === "function") {
      try { onError(error, breaker?.snapshot(now) || null); } catch { /* never escalate handler errors */ }
    } else {
      console.error(`[agent-deck] ${label}`, error);
    }
    return { ok: false, skipped: false, value: undefined, error };
  }
}

export function bindConnectedInterval(el, prop, tick, ms, host = globalThis) {
  const prev = el?.[prop];
  if (prev != null) {
    try { (host.clearInterval || clearInterval)(prev); } catch { /* ignore */ }
  }
  const set = typeof host?.setInterval === "function" ? host.setInterval.bind(host) : setInterval;
  const clr = typeof host?.clearInterval === "function" ? host.clearInterval.bind(host) : clearInterval;
  const id = set(() => {
    if (el && el.isConnected === false) {
      clr(id);
      if (el[prop] === id) el[prop] = null;
      return;
    }
    tick();
  }, ms);
  if (el) el[prop] = id;
  return id;
}
