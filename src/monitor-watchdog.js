export function createMonitorWatchdog(onTimeout, { timers = globalThis, timeoutMs = 15000 } = {}) {
  let timer;
  let stopped = false;
  let generation = 0;
  const ping = () => {
    if (stopped) return;
    timers.clearTimeout(timer);
    const current = ++generation;
    timer = timers.setTimeout(() => {
      if (stopped || current !== generation) return;
      stopped = true;
      onTimeout();
    }, timeoutMs);
    timer?.unref?.();
  };
  ping();
  return { ping, stop() { stopped = true; timers.clearTimeout(timer); } };
}
