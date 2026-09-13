import type { AgentProvider, AgentProviderContext } from '../provider.js';
import type {
    AgentCreateInput,
    AgentCreateResult,
    AgentModelsListResult,
    AgentProviderId,
} from '../types.js';

function stubProvider(
    id: AgentProviderId,
    capabilities: AgentProvider['capabilities'],
    createError: string,
): AgentProvider {
    return {
        id,
        capabilities,
        async listModels(_ctx: AgentProviderContext): Promise<AgentModelsListResult> {
            return {
                ok: false,
                provider: id,
                error: `${id} listModels not implemented`,
            };
        },
        async createRun(
            _input: AgentCreateInput,
            _ctx: AgentProviderContext,
        ): Promise<AgentCreateResult> {
            return { ok: false, error: createError };
        },
    };
}

/** selfhosted：模型列表 Phase 3；执行由 sch1 selfhosted-executor 负责 */
export const selfHostedAgentProvider: AgentProvider = stubProvider(
    'selfhosted',
    { listModels: false, remoteRun: false, streaming: false, autoPr: true },
    'selfhosted execution uses sch1 selfhosted-executor, not AgentProvider.createRun',
);

export const smokeAgentProvider: AgentProvider = stubProvider(
    'smoke',
    { listModels: false, remoteRun: false, streaming: false, autoPr: false },
    'smoke tasks do not invoke remote agents',
);

export const copilotAgentProvider: AgentProvider = stubProvider(
    'copilot',
    { listModels: false, remoteRun: true, streaming: false, autoPr: true },
    'copilot provider not implemented',
);
