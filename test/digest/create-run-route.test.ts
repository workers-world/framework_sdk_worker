import { describe, expect, it, vi } from 'vitest';
import {
    createDigestRunHandler,
    dailyCadence,
    type CreateDigestRunRouteOptions,
    type DigestDefinition,
    type DigestDeliverMeta,
    type DigestSection,
} from '../../src/digest/index.js';

interface Env {
    token: string;
}

function makeDef(sections: DigestSection<Env>[] = []): DigestDefinition<Env> {
    return {
        id: 'weekly_governance',
        cadence: dailyCadence,
        cron: '0 1 * * 5',
        subjectPrefix: '[deploy-tracker] 治理周报',
        sections,
    };
}

function okSection(): DigestSection<Env> {
    return {
        id: 'a',
        title: 'A',
        order: 1,
        collect: async () => ({ status: 'ok', lines: ['x'], highlightCount: 1 }),
    };
}

function makeHandler(overrides: Partial<CreateDigestRunRouteOptions<Env>>) {
    return createDigestRunHandler<Env>({
        definitions: [makeDef([okSection()])],
        claimDedup: async () => true,
        deliver: async () => ({ ok: true }),
        ...overrides,
    });
}

function makeCtx(body: unknown, env: Env = { token: 't' }) {
    const jsonCalls: Array<{ body: unknown; status?: number }> = [];
    const ctx = {
        req: { json: async () => body },
        json: (b: unknown, status?: number) => {
            jsonCalls.push({ body: b, status });
            return new Response(JSON.stringify(b), { status: status ?? 200 });
        },
        env,
    };
    return { ctx, jsonCalls };
}

describe('createDigestRunHandler', () => {
    it('returns 400 on invalid json / missing definitionId, 404 on unknown id', async () => {
        const handler = makeHandler({});

        const bad1 = await handler(makeCtx('not-json').ctx);
        expect(bad1.status).toBe(400);

        const bad2 = await handler(makeCtx({}).ctx);
        expect(bad2.status).toBe(400);

        const bad3 = await handler(makeCtx({ definitionId: 'nope' }).ctx);
        expect(bad3.status).toBe(404);
    });

    it('returns 200 ok:true with run result', async () => {
        const handler = makeHandler({});
        const { ctx, jsonCalls } = makeCtx({ definitionId: 'weekly_governance' });

        const res = await handler(ctx);

        expect(res.status).toBe(200);
        const body = jsonCalls[0]?.body as Record<string, unknown>;
        expect(body.ok).toBe(true);
        expect(body.sent).toBe(true);
        expect(body.periodKey).toMatch(/^\d{8}$/);
    });

    it('returns 502 ok:false on deliver_failed with error detail', async () => {
        const handler = makeHandler({
            deliver: async () => ({ ok: false, error: 'notify 500' }),
        });
        const { ctx, jsonCalls } = makeCtx({ definitionId: 'weekly_governance' });

        const res = await handler(ctx);

        expect(res.status).toBe(502);
        const body = jsonCalls[0]?.body as Record<string, unknown>;
        expect(body.ok).toBe(false);
        expect(body.sent).toBe(false);
        expect(body.skippedReason).toBe('deliver_failed');
        expect(body.error).toBe('notify 500');
    });

    it('returns 502 ok:false when deliver throws', async () => {
        const handler = makeHandler({
            deliver: async () => {
                throw new Error('boom');
            },
        });
        const { ctx, jsonCalls } = makeCtx({ definitionId: 'weekly_governance' });

        const res = await handler(ctx);

        expect(res.status).toBe(502);
        const body = jsonCalls[0]?.body as Record<string, unknown>;
        expect(body.ok).toBe(false);
        expect(body.skippedReason).toBe('deliver_failed');
        expect(body.error).toBe('boom');
    });

    it('releases dedup on deliver_failed but not on success; dedup skip stays 200', async () => {
        const releaseDedup = vi.fn(async (_env: Env, _dedupKey: string) => {});
        const claimDedup = vi.fn(async (_env: Env, _dedupKey: string) => true);
        const failHandler = makeHandler({
            claimDedup,
            releaseDedup,
            deliver: async () => ({ ok: false }),
        });
        const fail = await failHandler(makeCtx({ definitionId: 'weekly_governance' }).ctx);
        expect(fail.status).toBe(502);
        expect(releaseDedup).toHaveBeenCalledTimes(1);
        expect(releaseDedup.mock.calls[0]?.[1]).toBe(claimDedup.mock.calls[0]?.[1]);

        const okHandler = makeHandler({ claimDedup, releaseDedup });
        await okHandler(makeCtx({ definitionId: 'weekly_governance' }).ctx);
        expect(releaseDedup).toHaveBeenCalledTimes(1);

        const dedupHandler = makeHandler({ claimDedup: async () => false });
        const { ctx, jsonCalls } = makeCtx({ definitionId: 'weekly_governance' });
        const dedup = await dedupHandler(ctx);
        expect(dedup.status).toBe(200);
        expect(jsonCalls[0]?.body).toMatchObject({ ok: true, sent: false, skippedReason: 'dedup' });
    });

    it('force bypasses claimDedup, suffixes dedupKey and flags deliver meta', async () => {
        const claimDedup = vi.fn(async (_env: Env, _dedupKey: string) => false);
        const releaseDedup = vi.fn(async (_env: Env, _dedupKey: string) => {});
        const deliver = vi.fn(
            async (_env: Env, _mail: unknown, _dedupKey: string, _meta?: DigestDeliverMeta) => ({
                ok: true,
            }),
        );
        const handler = makeHandler({ claimDedup, releaseDedup, deliver });
        const { ctx, jsonCalls } = makeCtx({ definitionId: 'weekly_governance', force: true });

        const res = await handler(ctx);

        expect(res.status).toBe(200);
        expect(claimDedup).not.toHaveBeenCalled();
        expect(deliver.mock.calls[0]?.[2]).toMatch(/\|force\|\d+$/);
        expect(deliver.mock.calls[0]?.[3]).toMatchObject({ force: true });
        expect(releaseDedup).not.toHaveBeenCalled();
        expect(jsonCalls[0]?.body).toMatchObject({ ok: true, sent: true });
    });

    it('passes alertTo to resolveDeliver', async () => {
        const resolveDeliver = vi.fn(
            (base: CreateDigestRunRouteOptions<Env>['deliver'], _alertTo?: string) => base,
        );
        const handler = makeHandler({ resolveDeliver });
        await handler(
            makeCtx({ definitionId: 'weekly_governance', alertTo: 'ops@example.com' }).ctx,
        );
        expect(resolveDeliver).toHaveBeenCalledTimes(1);
        expect(resolveDeliver.mock.calls[0]?.[1]).toBe('ops@example.com');
    });

    it('pins periodKey into dedupKey, echoes it and passes jobId to deliver meta', async () => {
        const claimDedup = vi.fn(async (_env: Env, _dedupKey: string) => true);
        const deliver = vi.fn(
            async (_env: Env, _mail: unknown, _dedupKey: string, _meta?: DigestDeliverMeta) => ({
                ok: true,
            }),
        );
        const handler = makeHandler({ claimDedup, deliver });
        const { ctx, jsonCalls } = makeCtx({
            definitionId: 'weekly_governance',
            periodKey: '20260915',
            jobId: 'job-42',
        });

        const res = await handler(ctx);

        expect(res.status).toBe(200);
        expect(claimDedup).toHaveBeenCalledWith(
            { token: 't' },
            'digest|weekly_governance|20260915',
        );
        expect(deliver.mock.calls[0]?.[2]).toBe('digest|weekly_governance|20260915');
        expect(deliver.mock.calls[0]?.[3]).toMatchObject({ jobId: 'job-42' });
        expect(jsonCalls[0]?.body).toMatchObject({
            ok: true,
            sent: true,
            periodKey: '20260915',
        });
    });

    it('returns 400 for periodKey not matching the cadence (never silently dropped)', async () => {
        const claimDedup = vi.fn(async (_env: Env, _dedupKey: string) => true);
        const handler = makeHandler({ claimDedup });
        const { ctx } = makeCtx({ definitionId: 'weekly_governance', periodKey: '2026-13' });

        const res = await handler(ctx);

        expect(res.status).toBe(400);
        expect(claimDedup).not.toHaveBeenCalled();
    });
});
