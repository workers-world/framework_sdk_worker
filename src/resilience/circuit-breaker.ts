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
        // 半开态：放行探针请求。成功走 recordCircuitSuccess 关闭；失败走 recordCircuitFailure
        // 立即重开并重置恢复窗口。并发场景下可能放行多个探针（isolate 内无锁），可接受。
        console.log(`circuit half-open name=${name} reason=recovery_timeout`);
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
    if (state.open && Date.now() - state.lastFailureTime > RECOVERY_TIMEOUT_MS) {
        // 半开态探针失败：立即重新熔断，而不是重新累计 3 次
        state.lastFailureTime = Date.now();
        console.log(`circuit open name=${name} reason=probe_failed`);
        return;
    }
    state.failures++;
    state.lastFailureTime = Date.now();
    if (state.failures >= FAILURE_THRESHOLD && !state.open) {
        state.open = true;
        console.log(
            `circuit open name=${name} failures=${state.failures} reason=consecutive_failures`,
        );
    }
}

/**
 * KV 子集：跨 isolate 持久化熔断（llm-gateway 等）。未传 kv 时回退进程内 Map。
 * 一致性假设：KV 读有秒级陈旧窗口、读改写非原子——失败计数在高并发下可能少计，
 * 本模块是 best-effort 熔断。内存版阈值按 isolate 独立计算（多 isolate ≈ 阈值×N）。
 */
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
    let state: CircuitState;
    try {
        state = await readKvState(kv, name);
    } catch (e: unknown) {
        // best-effort：KV 读失败（限速/配额）视为未熔断，不阻断请求
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`circuit state read failed name=${name} error=${msg} (treated as closed)`);
        return false;
    }
    if (!state.open) {
        return false;
    }
    if (now - state.lastFailureTime > RECOVERY_TIMEOUT_MS) {
        // 半开态（不回写 KV：转换由 lastFailureTime 派生，幂等）。探针成功/失败见
        // recordCircuitSuccessKv / recordCircuitFailureKv。
        // 注意：KV 读有陈旧窗口（秒级），跨 isolate 状态可能短暂滞后。
        console.log(`circuit half-open name=${name} reason=recovery_timeout backend=kv`);
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
    try {
        const state = await readKvState(kv, name);
        if (state.open || state.failures > 0) {
            console.log(
                `circuit closed name=${name} failures=${state.failures} reason=probe_success backend=kv`,
            );
        }
        await writeKvState(kv, name, createState());
    } catch (e: unknown) {
        // best-effort：熔断状态记账失败不向调用方传播——否则 AI 调用成功后
        // 一次 KV 限速写失败会把整个成功请求变成 5xx
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`circuit success record failed name=${name} error=${msg} (non-fatal)`);
    }
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
    try {
        const state = await readKvState(kv, name);
        if (state.open && now - state.lastFailureTime > RECOVERY_TIMEOUT_MS) {
            // 半开态探针失败：立即重新熔断并重置恢复窗口
            state.lastFailureTime = now;
            console.log(`circuit open name=${name} reason=probe_failed backend=kv`);
            await writeKvState(kv, name, state);
            return;
        }
        state.failures += 1;
        state.lastFailureTime = now;
        if (state.failures >= FAILURE_THRESHOLD && !state.open) {
            state.open = true;
            console.log(
                `circuit open name=${name} failures=${state.failures} reason=consecutive_failures backend=kv`,
            );
        }
        await writeKvState(kv, name, state);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`circuit failure record failed name=${name} error=${msg} (non-fatal)`);
    }
}
