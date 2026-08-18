import { linkifyPlainTextEmail } from '../email/linkify-plain-text.js';
import { getEnvMode } from '../env/validate.js';
import { type NotifyResult, sendNotify } from '../notify/client.js';
import type { SecretLike } from '../secrets/resolve.js';
import { shanghaiIsoString } from '../time/shanghai.js';
import { buildOpsDedupKey } from './normalize.js';
import { type LogFields, sanitizeForLog } from './sanitize.js';

export interface OpsErrorPayload {
    worker: string;
    reason: string;
    error: string;
    context?: LogFields;
    dedupKey?: string;
    /** 覆盖 env.OPS_ALERT_TO */
    to?: string;
}

export interface OpsErrorEnv {
    SVC_NOTIFY?: Fetcher;
    NOTIFY_AUTH_TOKEN?: SecretLike;
    OPS_ALERT_TO?: string;
    ENVIRONMENT?: string;
    ENV?: string;
}

function resolveAlertTo(env: OpsErrorEnv, override?: string): string | undefined {
    return override?.trim() || env.OPS_ALERT_TO?.trim() || undefined;
}

function formatContextLines(context: LogFields): string[] {
    return Object.entries(context).map(([key, value]) => {
        const rendered =
            value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
        return `${key}: ${rendered}`;
    });
}

function buildOpsEmailBody(payload: OpsErrorPayload, context: LogFields): string {
    const lines = [
        `Worker: ${payload.worker}`,
        `Reason: ${payload.reason}`,
        `Time: ${shanghaiIsoString()}`,
        `Error: ${payload.error}`,
        '',
        ...formatContextLines(context),
    ].filter((line, index) => line !== '' || index < 5);
    return lines.join('\n');
}

/** 运维 error 即时邮件告警（不进 digest 窗口） */
export async function reportOpsError(
    env: OpsErrorEnv,
    payload: OpsErrorPayload,
): Promise<NotifyResult> {
    const to = resolveAlertTo(env, payload.to);
    if (!to) {
        if (getEnvMode(env as Record<string, unknown>) === 'dev') {
            console.warn(
                `[ops-error] OPS_ALERT_TO not configured, skip alert worker=${payload.worker} reason=${payload.reason}`,
            );
            return { ok: true, skipped: true, reason: 'ops_alert_to_missing' };
        }
        return { ok: false, error: 'OPS_ALERT_TO not configured' };
    }

    const context = sanitizeForLog(payload.context ?? {});
    const subject = `[ops:${payload.worker}] ${payload.reason}`.slice(0, 200);
    const body = buildOpsEmailBody(payload, context);
    const html = linkifyPlainTextEmail(body);
    const dedupKey =
        payload.dedupKey?.trim() || buildOpsDedupKey(payload.worker, payload.reason, payload.error);

    try {
        return await sendNotify(env.SVC_NOTIFY, env.NOTIFY_AUTH_TOKEN, {
            subject,
            body,
            html,
            to,
            dedupKey,
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
            `[ops-error] notify failed worker=${payload.worker} reason=${payload.reason} error=${msg}`,
        );
        return { ok: false, error: msg };
    }
}

/** 热路径 fire-and-forget：有 ctx 时用 waitUntil */
export function reportOpsErrorAsync(
    env: OpsErrorEnv,
    payload: OpsErrorPayload,
    ctx?: Pick<ExecutionContext, 'waitUntil'>,
): void {
    const promise = reportOpsError(env, payload);
    if (ctx?.waitUntil) {
        ctx.waitUntil(promise);
        return;
    }
    void promise;
}
