import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOpsErrorIntake } from '../../src/intake/builders.js';
import {
    INTAKE_BLOCK_OBSERVABILITY_REF,
    isIntakePayloadEnvelope,
} from '../../src/intake/payload-envelope.js';
import { intakePublish, intakePublishFinalize } from '../../src/intake/publish.js';
import { intakePublishScope, resolveHopFromPublishScope } from '../../src/intake/publish-scope.js';
import {
    getActiveInvocationId,
    setActiveInvocationId,
} from '../../src/observability/worker-invocation-id.js';

describe('intakePublishFinalize', () => {
    afterEach(() => {
        setActiveInvocationId(undefined);
    });

    it('merges hop from context into ops.error event', () => {
        const event = buildOpsErrorIntake({
            producer: 'test',
            worker: 'test',
            reason: 'boom',
            error: 'err',
        });
        const finalized = intakePublishFinalize(event, {
            hop: { requestId: 'REQ-99' },
            channel: 'ops',
        });
        expect(isIntakePayloadEnvelope(finalized.payload)).toBe(true);
        if (!isIntakePayloadEnvelope(finalized.payload)) {
            return;
        }
        expect(finalized.payload.index.requestId).toBe('REQ-99');
        expect(
            finalized.payload.blocks.some((b) => b.type === INTAKE_BLOCK_OBSERVABILITY_REF),
        ).toBe(true);
    });

    it('reads active invocation id when hop omitted', () => {
        setActiveInvocationId('ACTIVE-1');
        const event = buildOpsErrorIntake({
            producer: 'test',
            worker: 'test',
            reason: 'boom',
            error: 'err',
        });
        const finalized = intakePublishFinalize(event, {});
        if (!isIntakePayloadEnvelope(finalized.payload)) {
            throw new Error('expected envelope');
        }
        expect(finalized.payload.index.requestId).toBe('ACTIVE-1');
    });
});

describe('intakePublish', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        setActiveInvocationId(undefined);
    });

    it('POSTs finalized event with requestId in body', async () => {
        const fetchSpy = vi.fn(
            async () => new Response(JSON.stringify({ ok: true, id: 1 }), { status: 200 }),
        );
        vi.stubGlobal('fetch', fetchSpy);

        const event = buildOpsErrorIntake({
            producer: 'test',
            worker: 'test',
            reason: 'boom',
            error: 'err',
        });
        const result = await intakePublish(
            { SCH_INTAKE_URL: 'https://example.com', SCH_INTAKE_TOKEN: 'tok' },
            event,
            { hop: { invocationId: 'INV-POST' } },
        );
        expect(result.ok).toBe(true);
        const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(String(init.body)) as {
            payload: { index: { requestId?: string } };
        };
        expect(body.payload.index.requestId).toBe('INV-POST');
    });
});

describe('intakePublishScope snapshot semantics', () => {
    afterEach(() => {
        setActiveInvocationId(undefined);
    });

    it('snapshots invocationId at entry; later global churn does not leak into scope hop', () => {
        // 回归：resolveHopFromPublishScope 曾在调用时回退全局 active id，
        // 并发请求互相覆盖导致 hop 错挂
        setActiveInvocationId('REQ-A');
        const inside = intakePublishScope.run({}, () => {
            // 模拟并发请求覆盖全局 active id
            setActiveInvocationId('REQ-B');
            return resolveHopFromPublishScope();
        });
        // 快照在入口固化 REQ-A，调用时的全局值 REQ-B 不参与解析
        expect(inside?.requestId).toBe('REQ-A');
        expect(inside?.invocationId).toBe('REQ-A');
        // run 退出恢复 prevActive
        expect(getActiveInvocationId()).toBe('REQ-A');
    });

    it('merges explicit hop after snapshot (explicit wins)', () => {
        setActiveInvocationId('REQ-A');
        const inside = intakePublishScope.run({ hop: { requestId: 'FROM-SCOPE' } }, () =>
            resolveHopFromPublishScope({ traceId: 'TR-1' }),
        );
        // 快照 = 旧三段合并的前两段（runtime 覆盖 scope.hop），显式参数最后合并
        expect(inside?.traceId).toBe('TR-1');
        expect(inside?.requestId).toBe('REQ-A');
    });
});
