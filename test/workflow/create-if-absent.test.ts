import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowIfAbsent } from '../../src/workflow/create-if-absent.js';

describe('createWorkflowIfAbsent', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns created instance and calls object-form createBatch', async () => {
        const createBatch = vi.fn().mockResolvedValue({
            created: [{ id: 'qc-1' }],
            errors: [],
        });
        await expect(
            createWorkflowIfAbsent({ createBatch }, { id: 'qc-1', params: { a: 1 } }),
        ).resolves.toEqual({ id: 'qc-1' });
        expect(createBatch).toHaveBeenCalledWith({
            instances: [{ id: 'qc-1', params: { a: 1 } }],
        });
    });

    it('returns null when id already exists and warns with errors detail', async () => {
        const createBatch = vi.fn().mockResolvedValue({
            created: [],
            errors: [{ index: 0, id: 'qc-1', code: 'already_exists', message: 'exists' }],
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(
            createWorkflowIfAbsent({ createBatch }, { id: 'qc-1', params: {} }),
        ).resolves.toBeNull();
        // errors-only（含 already_exists）不再静默：warn 输出完整 code+message，便于区分失败与已存在
        expect(warn).toHaveBeenCalledOnce();
        const payload = String(warn.mock.calls[0]?.[0]);
        expect(payload).toContain('errors-only');
        expect(payload).toContain('already_exists');
        expect(payload).toContain('exists');
    });

    it('still returns null on genuine errors-only failure', async () => {
        const createBatch = vi.fn().mockResolvedValue({
            created: [],
            errors: [{ index: 0, id: 'qc-1', code: 7501, message: 'unknown error' }],
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(createWorkflowIfAbsent({ createBatch }, { id: 'qc-1' })).resolves.toBeNull();
        expect(warn).toHaveBeenCalledOnce();
        expect(String(warn.mock.calls[0]?.[0])).toContain('unknown error');
    });

    it('warns on partial success (created + errors)', async () => {
        const createBatch = vi.fn().mockResolvedValue({
            created: [{ id: 'ok-1' }],
            errors: [{ index: 0, id: 'dup', code: 1, message: 'dup' }],
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(createWorkflowIfAbsent({ createBatch }, { id: 'ok-1' })).resolves.toEqual({
            id: 'ok-1',
        });
        expect(warn).toHaveBeenCalledOnce();
        expect(String(warn.mock.calls[0]?.[0])).toContain('workflow.createBatch partial errors');
    });
});
