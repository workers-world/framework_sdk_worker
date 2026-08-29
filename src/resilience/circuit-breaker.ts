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
        console.log(
            `circuit open name=${name} failures=${state.failures} reason=consecutive_failures`,
        );
    }
}

/** KV 子集：跨 isolate 持久化熔断（llm-gateway 等）。未传 kv 时回退进程内 Map。 */
export type CircuitKv = {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

const KV_PREFIX = 'circuit:';
const KV_TTL_SEC = Math.ceil((RECOVERY_TIMEOUT_MS * 6) / 1000);

function kvKey(name: string): string {
    return `${KV_PREFIX}${name}`;
}

async function readKvState(kv: CircuitKv, name: string): Promise<CircuitState> {
    const raw = await kv.get(kvKey(name));
    if (!raw) {
        return createState();
    }
    try {
        const parsed = JSON.parse(raw) as Partial<CircuitState>;
        return {
            failures: typeof parsed.failures === 'number' ? parsed.failures : 0,
            lastFailureTime:
                typeof parsed.lastFailureTime === 'number' ? parsed.lastFailureTime : 0,
            open: parsed.open === true,
        };
    } catch {
        return createState();
    }
}

async function writeKvState(kv: CircuitKv, name: string, state: CircuitState): Promise<void> {
    await kv.put(kvKey(name), JSON.stringify(state), { expirationTtl: KV_TTL_SEC });
}

export async function isCircuitOpenKv(
    kv: CircuitKv | undefined,
    name = 'default',
    now = Date.now(),
): Promise<boolean> {
    if (!kv) {
        return isCircuitOpen(name);
    }
    const state = await readKvState(kv, name);
    if (!state.open) {
        return false;
    }
    if (now - state.lastFailureTime > RECOVERY_TIMEOUT_MS) {
        await writeKvState(kv, name, createState());
        console.log(`circuit half-open→closed name=${name} reason=recovery_timeout backend=kv`);
        return false;
    }
    return true;
}

export async function recordCircuitSuccessKv(
    kv: CircuitKv | undefined,
    name = 'default',
): Promise<void> {
    if (!kv) {
        recordCircuitSuccess(name);
        return;
    }
    const state = await readKvState(kv, name);
    if (state.open || state.failures > 0) {
        console.log(
            `circuit closed name=${name} failures=${state.failures} reason=probe_success backend=kv`,
        );
    }
    await writeKvState(kv, name, createState());
}

export async function recordCircuitFailureKv(
    kv: CircuitKv | undefined,
    name = 'default',
    now = Date.now(),
): Promise<void> {
    if (!kv) {
        recordCircuitFailure(name);
        return;
    }
    const state = await readKvState(kv, name);
    state.failures += 1;
    state.lastFailureTime = now;
    if (state.failures >= FAILURE_THRESHOLD && !state.open) {
        state.open = true;
        console.log(
            `circuit open name=${name} failures=${state.failures} reason=consecutive_failures backend=kv`,
        );
    }
    await writeKvState(kv, name, state);
}
