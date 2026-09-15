/**
 * Hono 辅助：业务 Worker 暴露 POST /internal/digest/run。
 * 鉴权由调用方在挂载前注册 Bearer middleware。
 */

import { getDigestDefinitionById } from './registry.js';
import { runScheduledDigest, type ScheduledDigestRunOptions } from './run-scheduled-digest.js';
import type {
    DigestCapabilityDescriptor,
    DigestDefinition,
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
        const claimDedup = force ? async () => true : options.claimDedup;
        const deliverMaybeUnique = force
            ? async (env: TEnv, mail: Parameters<typeof deliver>[1], dedupKey: string) =>
                  deliver(env, mail, `${dedupKey}|force|${Date.now()}`)
            : deliver;

        const result = await runScheduledDigest({
            definition,
            env: c.env as TEnv,
            claimDedup,
            deliver: deliverMaybeUnique,
        });

        return c.json({
            ok: true,
            sent: result.sent,
            skippedReason: result.skippedReason,
            periodKey: result.periodKey,
            highlightCount: result.highlightCount,
            sectionSummaries: result.sectionSummaries,
            error: result.error,
        });
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
