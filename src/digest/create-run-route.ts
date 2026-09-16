/**
 * Hono 辅助：业务 Worker 暴露 POST /internal/digest/run。
 * 鉴权由调用方在挂载前注册 Bearer middleware。
 */

import { cadenceDateFromPeriodKey } from './cadences.js';
import { getDigestDefinitionById } from './registry.js';
import { runScheduledDigest, type ScheduledDigestRunOptions } from './run-scheduled-digest.js';
import type {
    DigestCapabilityDescriptor,
    DigestDefinition,
    DigestDeliverMeta,
    DigestRunRequestBody,
} from './types.js';

type JsonCtx = {
    req: { json(): Promise<unknown> };
    json(body: unknown, status?: number): Response;
    env: unknown;
};

export interface CreateDigestRunRouteOptions<TEnv> {
    definitions: DigestDefinition<TEnv>[];
    claimDedup: ScheduledDigestRunOptions<TEnv>['claimDedup'];
    deliver: ScheduledDigestRunOptions<TEnv>['deliver'];
    /** deliver 失败时回滚 dedup claim（透传 runScheduledDigest；force 路径未 claim，不回滚） */
    releaseDedup?: ScheduledDigestRunOptions<TEnv>['releaseDedup'];
    /** 覆盖 deliver 收件人（来自 sch2 job.alert_to）时注入 env 或闭包；默认忽略 alertTo */
    resolveDeliver?: (
        base: ScheduledDigestRunOptions<TEnv>['deliver'],
        alertTo: string | undefined,
    ) => ScheduledDigestRunOptions<TEnv>['deliver'];
}

export function createDigestRunHandler<TEnv>(options: CreateDigestRunRouteOptions<TEnv>) {
    return async (c: JsonCtx): Promise<Response> => {
        let body: DigestRunRequestBody;
        try {
            body = (await c.req.json()) as DigestRunRequestBody;
        } catch {
            return c.json({ ok: false, error: 'invalid json' }, 400);
        }
        if (!body?.definitionId || typeof body.definitionId !== 'string') {
            return c.json({ ok: false, error: 'definitionId required' }, 400);
        }

        const definition = getDigestDefinitionById(body.definitionId, options.definitions);
        if (!definition) {
            return c.json({ ok: false, error: `unknown definitionId: ${body.definitionId}` }, 404);
        }

        const deliver = options.resolveDeliver
            ? options.resolveDeliver(options.deliver, body.alertTo)
            : options.deliver;

        const force = body.force === true;
        const jobId =
            typeof body.jobId === 'string' && body.jobId.trim() ? body.jobId.trim() : undefined;
        let periodKeyOverride: string | undefined;
        if (typeof body.periodKey === 'string' && body.periodKey.trim()) {
            const key = body.periodKey.trim();
            if (!cadenceDateFromPeriodKey(definition.cadence, key)) {
                return c.json(
                    {
                        ok: false,
                        error: `invalid periodKey for cadence ${definition.cadence.id}: ${key}`,
                    },
                    400,
                );
            }
            periodKeyOverride = key;
        }

        const result = await runScheduledDigest({
            definition,
            env: c.env as TEnv,
            claimDedup: force ? async () => true : options.claimDedup,
            releaseDedup: force ? undefined : options.releaseDedup,
            periodKeyOverride,
            deliver: (env, mail, dedupKey, runMeta) => {
                const meta: DigestDeliverMeta = { ...(runMeta ?? {}) };
                if (jobId) {
                    meta.jobId = jobId;
                }
                if (force) {
                    meta.force = true;
                }
                return deliver(
                    env,
                    mail,
                    force ? `${dedupKey}|force|${Date.now()}` : dedupKey,
                    meta,
                );
            },
        });

        // deliver_failed 对调度方是可重试故障：返回 502 + ok:false（保留 sent/skippedReason/error 细节）；其余 skipped 仍 200
        const failed = result.skippedReason === 'deliver_failed';
        return c.json(
            {
                ok: !failed,
                sent: result.sent,
                skippedReason: result.skippedReason,
                periodKey: result.periodKey,
                highlightCount: result.highlightCount,
                sectionSummaries: result.sectionSummaries,
                error: result.error,
            },
            failed ? 502 : 200,
        );
    };
}

export function listDigestCapabilities<TEnv>(
    definitions: DigestDefinition<TEnv>[],
): DigestCapabilityDescriptor[] {
    return definitions.map((d) => ({
        definitionId: d.id,
        title: d.subjectPrefix,
        cadenceOptions: [d.cadence.id],
        defaultCron: d.cron,
        sectionIds: d.sections.map((s) => s.id),
    }));
}
