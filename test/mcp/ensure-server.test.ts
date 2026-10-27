import { describe, expect, it, vi } from 'vitest';
import { ensureMcpServer } from '../../src/mcp/ensure-server.js';
import type { McpHost } from '../../src/mcp/types.js';

const BINDING = {} as DurableObjectNamespace;

function makeHost(
    servers: Array<{ name?: string; serverName?: string }>,
    add?: McpHost['addMcpServer'],
): McpHost {
    return {
        addMcpServer: add ?? vi.fn(async () => ({ id: '1', state: 'ready' })),
        mcp: {
            getAITools: () => ({}),
            listServers: () => servers,
        },
    };
}

describe('ensureMcpServer', () => {
    it('returns false without binding', async () => {
        const host = makeHost([]);
        await expect(ensureMcpServer(host, 'desk', undefined)).resolves.toBe(false);
        expect(host.addMcpServer).not.toHaveBeenCalled();
    });

    it('skips add when server already listed by name', async () => {
        const host = makeHost([{ name: 'desk' }]);
        await expect(ensureMcpServer(host, 'desk', BINDING)).resolves.toBe(true);
        expect(host.addMcpServer).not.toHaveBeenCalled();
    });

    it('treats alsoMatch substring as ready', async () => {
        const host = makeHost([{ serverName: 'desk-mcp-production' }]);
        await expect(ensureMcpServer(host, 'desk', BINDING, 'desk-mcp')).resolves.toBe(true);
        expect(host.addMcpServer).not.toHaveBeenCalled();
    });

    it('adds server when not listed', async () => {
        const add = vi.fn(async () => ({ id: 'n', state: 'ready' }));
        const host = makeHost([{ name: 'other' }], add);
        await expect(ensureMcpServer(host, 'desk', BINDING)).resolves.toBe(true);
        expect(add).toHaveBeenCalledWith('desk', BINDING);
    });

    it('treats missing listServers as empty and adds', async () => {
        const add = vi.fn(async () => ({ id: 'n', state: 'ready' }));
        const host: McpHost = {
            addMcpServer: add,
            mcp: { getAITools: () => ({}) },
        };
        await expect(ensureMcpServer(host, 'desk', BINDING)).resolves.toBe(true);
        expect(add).toHaveBeenCalled();
    });

    it('returns false and warns on throw', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const host = makeHost([]);
        host.addMcpServer = async () => {
            throw new Error('do unavailable');
        };
        await expect(ensureMcpServer(host, 'desk', BINDING)).resolves.toBe(false);
        expect(warn.mock.calls[0]?.[0]).toContain('do unavailable');
        host.addMcpServer = async () => {
            throw 'raw';
        };
        await expect(ensureMcpServer(host, 'desk', BINDING)).resolves.toBe(false);
        warn.mockRestore();
    });
});
