import { beforeEach, describe, expect, it, vi } from 'vitest';

// 动态 import 的 publish.js mock 成 reject：验证 fire-and-forget promise 链被 catch 兜底，
// 不产生 unhandled rejection（对齐 writeMaintenanceLogAsync 写法）
vi.mock('../../src/intake/publish.js', () => ({
    intakePublish: vi.fn(async () => {
        throw new Error('publish chain boom');
    }),
}));

import { submitIntakeEventAsync } from '../../src/intake/submit.js';
import type { IntakeEvent } from '../../src/intake/types.js';

const baseEvent: IntakeEvent = {
    schemaVersion: 1,
    kind: 'ops.error',
    dedupKey: 'ops.error:test:reason:abc:2026-09-08',
    source: { producer: 'test-worker' },
    title: 'title',
    summary: 'summary',
    occurredAt: '2026-09-08T00:00:00.000Z',
    payload: { worker: 'test-worker' },
};

describe('submitIntakeEventAsync fire-and-forget catch', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('catches chain rejection via waitUntil promise instead of unhandled rejection', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const waitUntil = vi.fn();
        submitIntakeEventAsync({}, baseEvent, { waitUntil });
        await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
        // catch 输出：首参标记 + 原始错误对象
        const warned = warn.mock.calls.map((c) => c.map((a) => String(a)).join(' ')).join(' | ');
        expect(warned).toContain('intake');
        expect(warned).toContain('publish chain boom');
    });

    it('catches chain rejection on void path without throwing', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(() => submitIntakeEventAsync({}, baseEvent)).not.toThrow();
        // 给微任务一个 flush 机会
        await new Promise((resolve) => setTimeout(resolve, 0));
        const warned = warn.mock.calls.map((c) => c.map((a) => String(a)).join(' ')).join(' | ');
        expect(warned).toContain('publish chain boom');
    });
});
