import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createAgentRun,
    getAgentProvider,
    listAgentModels,
    listRegisteredProviders,
    parseAgentModelRef,
} from '../../src/agent/index.js';

const API_KEY = 'cursor-key';

describe('agent registry', () => {
    it('registers default providers', () => {
        const ids = listRegisteredProviders();
        expect(ids).toContain('cursor');
        expect(ids).toContain('selfhosted');
        expect(getAgentProvider('cursor')?.capabilities.remoteRun).toBe(true);
    });

    it('listAgentModels delegates to cursor adapter', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({ models: [{ id: 'composer-2.5', name: 'Composer 2.5' }] }),
                        {
                            status: 200,
                        },
                    ),
            ),
        );
        const result = await listAgentModels('cursor', { secrets: { CURSOR_API_KEY: API_KEY } });
        expect(result.ok).toBe(true);
        expect(result.provider).toBe('cursor');
        expect(result.models?.[0]).toMatchObject({
            id: 'composer-2.5',
            provider: 'cursor',
        });
        vi.unstubAllGlobals();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('createAgentRun rejects selfhosted remote run', async () => {
        const result = await createAgentRun(
            {
                provider: 'selfhosted',
                repoUrl: 'https://github.com/o/r',
                promptText: 'x',
            },
            { secrets: {} },
        );
        expect(result.ok).toBe(false);
        expect(result.error).toContain('selfhosted');
    });

    it('parseAgentModelRef round-trip used by createAgentRun model field', () => {
        const ref = parseAgentModelRef('cursor:composer-2.5');
        expect(ref.modelId).toBe('composer-2.5');
    });
});
