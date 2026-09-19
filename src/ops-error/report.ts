import { linkifyPlainTextEmail } from '../email/linkify-plain-text.js';
import { getEnvMode } from '../env';
import type { IntakeEnv } from '../intake.js';
import { type NotifyResult, sendNotify } from '../notify/client.js';
import type { SecretLike } from '../secrets/resolve.js';
import { shanghaiIsoString } from '../time.js';
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
    /**
     * 默认旁路 submitIntakeEvent(kind=ops.error)。显式 false 关闭。
     * 缺 SVC_SCH1 / SCH_INTAKE_TOKEN 时 intake 静默 warn，邮件仍发。
     */
    intake?: boolean;
    /** 可选：写入 intake payload.requestId */
    requestId?: string;
}

export interface OpsErrorEnv extends IntakeEnv {
    SVC_NOTIFY?: Fetcher;
    NOTIFY_AUTH_TOKEN?: SecretLike;
    OPS_ALERT_TO?: string;
    ENVIRONMENT?: string;
    ENV?: string;
}

function resolveAlertTo(env: OpsErrorEnv, override?: string): string | undefined {
    return override?.trim() || env.OPS_ALERT_TO?.trim() || undefined;
}

/** 告警邮件单行截断上限：context 值可能携带大段原文（已脱敏但仍需封顶） */
const OPS_CONTEXT_LINE_MAX = 500;

/** 告警邮件 error 字段截断上限（与 ops-error/logger.ts 的 OPS_ERROR_MESSAGE_MAX 对齐） */
const OPS_ERROR_MESSAGE_MAX = 800;

function truncateLine(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…(截断)` : text;
}

function formatContextLines(context: LogFields): string[] {
    return Object.entries(context).map(([key, value]) => {
        const rendered =
            value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
        return truncateLine(`${key}: ${rendered}`, OPS_CONTEXT_LINE_MAX);
    });
}

function buildOpsEmailBody(payload: OpsErrorPayload, context: LogFields): string {
    const lines = [
        `Worker: ${payload.worker}`,
        `Reason: ${payload.reason}`,
        `Time: ${shanghaiIsoString()}`,
        `Error: ${truncateLine(payload.error, OPS_ERROR_MESSAGE_MAX)}`,
        '',
        ...formatContextLines(context),
    ].filter((line, index) => line !== '' || index < 5);
    return lines.join('\n');
}

/**
 * 动态 import intake，避免 builders ↔ report 经 ops-error.js 桶循环初始化。
 * fail-open：intake 失败不抛、不影响邮件结果。
 */
function submitOpsErrorIntake(
    env: OpsErrorEnv,
    payload: OpsErrorPayload,
    ctx?: Pick<ExecutionContext, 'waitUntil'>,
): void {
    if (payload.intake === false) {
        return;
    }
    const promise = import('../intake.js')
        .then(({ buildOpsErrorIntake, submitIntakeEventAsync }) => {
            const { intake: _intake, to: _to, dedupKey, ...rest } = payload;
            const event = buildOpsErrorIntake({
                producer: payload.worker,
                worker: payload.worker,
                reason: payload.reason,
                error: payload.error,
                context: rest.context,
                requestId: payload.requestId,
                ...(dedupKey?.trim() ? { dedupKey: dedupKey.trim() } : {}),
            });
            submitIntakeEventAsync(env, event, ctx);
        })
        .catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[ops-error] intake submit failed worker=${payload.worker}: ${msg}`);
        });
    if (ctx?.waitUntil) {
        ctx.waitUntil(promise);
        return;
    }
    void promise;
}

/** 运维 error 即时邮件告警（不进 digest 窗口）；可选双写 sch1 Intake */
export async function reportOpsError(
    env: OpsErrorEnv,
    payload: OpsErrorPayload,
): Promise<NotifyResult> {
    submitOpsErrorIntake(env, payload);

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

/** 热路径 fire-and-forget：有 ctx 时用 waitUntil；intake 默认开，仅 false 关闭 */
export function reportOpsErrorAsync(
    env: OpsErrorEnv,
    payload: OpsErrorPayload,
    ctx?: Pick<ExecutionContext, 'waitUntil'>,
): void {
    // intake 先挂 waitUntil，再挂邮件 promise（reportOpsError 内也会触 intake，故此处只走邮件路径时需传 ctx）
    submitOpsErrorIntake(env, payload, ctx);
    const mailPayload: OpsErrorPayload = { ...payload, intake: false };
    const promise = reportOpsError(env, mailPayload);
    if (ctx?.waitUntil) {
        ctx.waitUntil(promise);
        return;
    }
    void promise;
}
