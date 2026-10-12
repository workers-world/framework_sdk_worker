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

    it('returns null when id already exists (empty created)', async () => {
        const createBatch = vi.fn().mockResolvedValue({
            created: [],
            errors: [{ index: 0, id: 'qc-1', code: 'already_exists', message: 'exists' }],
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(
            createWorkflowIfAbsent({ createBatch }, { id: 'qc-1', params: {} }),
        ).resolves.toBeNull();
        expect(warn).not.toHaveBeenCalled();
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
