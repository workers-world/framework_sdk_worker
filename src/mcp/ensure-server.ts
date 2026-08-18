import type {McpHost} from './types.js';

/**
 * 确保已连接 MCP server DO（幂等）。
 * 失败返回 false（不抛错），由调用方降级。
 * alsoMatch：listServers 返回名含该子串也视为已就绪（兼容 SDK 命名变体）。
 */
export async function ensureMcpServer(
    agent: McpHost,
    serverName: string,
    binding: DurableObjectNamespace | undefined,
    alsoMatch?: string,
): Promise<boolean> {
    if (!binding) {
        return false;
    }
    try {
        const servers = agent.mcp.listServers?.() ?? [];
        const ready = servers.some((s) => {
            const name = s.name ?? s.serverName ?? '';
            return name === serverName || (alsoMatch ? name.includes(alsoMatch) : false);
        });
        if (!ready) {
            await agent.addMcpServer(serverName, binding);
        }
        return true;
    } catch (e: unknown) {
        console.warn(`ensureMcpServer: ${e instanceof Error ? e.message : String(e)}`);
        return false;
    }
}
