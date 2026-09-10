import { resolveSecret, type SecretLike } from '../secrets/resolve.js';
import type { IntakeEvent, SubmitIntakeResult } from './types.js';

const INTAKE_FETCH_TIMEOUT_MS = 15_000;

export interface IntakeEnv {
    /** Service Binding → sch1 */
    SVC_SCH1?: Fetcher;
    /** 公网 intake URL（无 binding 时）；应含 /sch1/intake 或仅 origin */
    SCH_INTAKE_URL?: string;
    SCH_INTAKE_TOKEN?: SecretLike;
}

export interface SubmitIntakeOptions {
    ctx?: Pick<ExecutionContext, 'waitUntil'>;
}

function stripTrailingSlashes(value: string): string {
    let end = value.length;
    while (end > 0 && value[end - 1] === '/') {
        end -= 1;
    }
    return value.slice(0, end);
}

function normalizeIntakeUrl(base: string): string {
    const trimmed = stripTrailingSlashes(base.trim());
    if (trimmed.endsWith('/sch1/intake')) {
        return trimmed;
    }
    if (trimmed.endsWith('/sch1')) {
        return `${trimmed}/intake`;
    }
    return `${trimmed}/sch1/intake`;
}

/** 入站前校验；返回 null 表示通过 */
export function validateIntakeEvent(event: IntakeEvent): string | null {
    if (event.schemaVersion !== 1) {
        return 'schemaVersion must be 1';
    }
    if (!event.kind?.trim()) {
        return 'kind required';
    }
    if (!event.dedupKey?.trim()) {
        return 'dedupKey required';
    }
    if (!event.source?.producer?.trim()) {
        return 'source.producer required';
    }
    if (!event.title?.trim()) {
        return 'title required';
    }
    if (!event.summary?.trim()) {
        return 'summary required';
    }
    if (!event.occurredAt?.trim()) {
        return 'occurredAt required';
    }
    if (!event.payload || typeof event.payload !== 'object') {
        return 'payload required';
    }
    return null;
}

async function postIntake(env: IntakeEnv, event: IntakeEvent): Promise<SubmitIntakeResult> {
    const validationError = validateIntakeEvent(event);
    if (validationError) {
        return { ok: false, error: validationError };
    }

    const token = await resolveSecret(env.SCH_INTAKE_TOKEN);
    if (!token && !env.SVC_SCH1) {
        return { ok: false, error: 'SCH_INTAKE_TOKEN or SVC_SCH1 not configured' };
    }

    let url = 'http://sch1/sch1/intake';
    if (env.SCH_INTAKE_URL?.trim()) {
        url = normalizeIntakeUrl(env.SCH_INTAKE_URL);
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INTAKE_FETCH_TIMEOUT_MS);

    try {
        const init: RequestInit = {
            method: 'POST',
            headers,
            body: JSON.stringify(event),
            signal: controller.signal,
        };
        const resp = env.SVC_SCH1 ? await env.SVC_SCH1.fetch(url, init) : await fetch(url, init);
        const text = (await resp.text()).trim();
        let data: { ok?: boolean; duplicate?: boolean; id?: number; error?: string } = {};
        if (text) {
            try {
                data = JSON.parse(text) as typeof data;
            } catch {
                return {
                    ok: false,
                    status: resp.status,
                    error: `invalid JSON response: ${text.slice(0, 200)}`,
                };
            }
        }
        if (!resp.ok) {
            return {
                ok: false,
                status: resp.status,
                error: data.error ?? (text.slice(0, 200) || `HTTP ${resp.status}`),
            };
        }
        return {
            ok: data.ok !== false,
            duplicate: data.duplicate,
            id: data.id,
            error: data.error,
            status: resp.status,
        };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
    } finally {
        clearTimeout(timer);
    }
}

/** 提交 Intake 事件；失败只返回结果，不抛（调用方自行 warn） */
export async function submitIntakeEvent(
    env: IntakeEnv,
    event: IntakeEvent,
    _options?: SubmitIntakeOptions,
): Promise<SubmitIntakeResult> {
    return postIntake(env, event);
}

/** 热路径 fire-and-forget */
export function submitIntakeEventAsync(
    env: IntakeEnv,
    event: IntakeEvent,
    ctx?: Pick<ExecutionContext, 'waitUntil'>,
): void {
    const promise = submitIntakeEvent(env, event).then((result) => {
        if (!result.ok) {
            console.warn(
                `[intake] submit failed kind=${event.kind} dedupKey=${event.dedupKey} error=${result.error ?? 'unknown'}`,
            );
        }
    });
    if (ctx?.waitUntil) {
        ctx.waitUntil(promise);
        return;
    }
    void promise;
}
