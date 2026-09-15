/**
 * Digest 编排：collect → compose → claimDedup → deliver。
 */

import { composeDigestMail } from './compose-mail.js';
import { buildDigestDedupKey } from './dedup-key.js';
import type {
    CollectedDigestSection,
    ComposedDigestMail,
    DigestDefinition,
    ScheduledDigestRunResult,
} from './types.js';

export interface ScheduledDigestRunOptions<TEnv> {
    definition: DigestDefinition<TEnv>;
    env: TEnv;
    now?: Date;
    /** 返回 true 表示本周期首次发送 */
    claimDedup: (env: TEnv, dedupKey: string) => Promise<boolean>;
    deliver: (
        env: TEnv,
        mail: ComposedDigestMail,
        dedupKey: string,
    ) => Promise<{ ok: boolean; skipped?: boolean; error?: string }>;
}

export async function runScheduledDigest<TEnv>(
    options: ScheduledDigestRunOptions<TEnv>,
): Promise<ScheduledDigestRunResult> {
    const { definition, env } = options;
    const now = options.now ?? new Date();
    const periodKey = definition.cadence.periodKey(now);
    const periodLabel = definition.cadence.periodLabel(now);

    const collected: CollectedDigestSection[] = [];
    const sorted = [...definition.sections].sort((a, b) => a.order - b.order);

    for (const section of sorted) {
        try {
            const result = await section.collect(env);
            collected.push({
                id: section.id,
                title: section.title,
                order: section.order,
                result,
            });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            collected.push({
                id: section.id,
                title: section.title,
                order: section.order,
                result: { status: 'error', message },
            });
        }
    }

    const mail = composeDigestMail(definition, collected, periodLabel);
    if (!mail) {
        return {
            sent: false,
            skippedReason: 'all_skip',
            periodKey,
            periodLabel,
            highlightCount: 0,
            sectionSummaries: collected.map((c) => ({
                id: c.id,
                title: c.title,
                status: c.result.status,
                reason: c.result.status === 'skip' ? c.result.reason : undefined,
                message: c.result.status === 'error' ? c.result.message : undefined,
                highlightCount:
                    c.result.status === 'ok'
                        ? (c.result.highlightCount ?? c.result.lines.length)
                        : undefined,
            })),
        };
    }

    const dedupKey = buildDigestDedupKey(definition.id, periodKey);
    const claimed = await options.claimDedup(env, dedupKey);
    if (!claimed) {
        return {
            sent: false,
            skippedReason: 'dedup',
            periodKey,
            periodLabel,
            highlightCount: mail.highlightCount,
            sectionSummaries: mail.sectionSummaries,
        };
    }

    const delivered = await options.deliver(env, mail, dedupKey);
    if (!delivered.ok) {
        return {
            sent: false,
            skippedReason: 'deliver_failed',
            periodKey,
            periodLabel,
            highlightCount: mail.highlightCount,
            sectionSummaries: mail.sectionSummaries,
            error: delivered.error,
        };
    }
    if (delivered.skipped) {
        return {
            sent: false,
            skippedReason: 'deliver_skipped',
            periodKey,
            periodLabel,
            highlightCount: mail.highlightCount,
            sectionSummaries: mail.sectionSummaries,
        };
    }

    return {
        sent: true,
        periodKey,
        periodLabel,
        highlightCount: mail.highlightCount,
        sectionSummaries: mail.sectionSummaries,
    };
}
