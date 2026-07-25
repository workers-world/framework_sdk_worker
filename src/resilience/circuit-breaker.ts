const FAILURE_THRESHOLD = 3;
const RECOVERY_TIMEOUT_MS = 60_000;

interface CircuitState {
  failures: number;
  lastFailureTime: number;
  open: boolean;
}

function createState(): CircuitState {
  return { failures: 0, lastFailureTime: 0, open: false };
}

const states = new Map<string, CircuitState>();

function getState(name: string): CircuitState {
  let s = states.get(name);
  if (!s) {
    s = createState();
    states.set(name, s);
  }
  return s;
}

export function isCircuitOpen(name = 'default'): boolean {
  const state = getState(name);
  if (!state.open) {
    return false;
  }
  if (Date.now() - state.lastFailureTime > RECOVERY_TIMEOUT_MS) {
    state.open = false;
    state.failures = 0;
    console.log(`circuit half-open→closed name=${name} reason=recovery_timeout`);
    return false;
  }
  return true;
}

export function recordCircuitSuccess(name = 'default'): void {
  const state = getState(name);
  if (state.open || state.failures > 0) {
    console.log(`circuit closed name=${name} failures=${state.failures} reason=probe_success`);
  }
  state.failures = 0;
  state.open = false;
}

export function recordCircuitFailure(name = 'default'): void {
  const state = getState(name);
  state.failures++;
  state.lastFailureTime = Date.now();
  if (state.failures >= FAILURE_THRESHOLD && !state.open) {
    state.open = true;
    console.log(`circuit open name=${name} failures=${state.failures} reason=consecutive_failures`);
  }
}
