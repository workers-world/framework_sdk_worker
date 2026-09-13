/** Agent 执行 provider 权威 id（与 sch1 ExecutionProvider 对齐） */
export type AgentProviderId = 'cursor' | 'selfhosted' | 'smoke' | 'copilot';

export const AGENT_PROVIDER_IDS: readonly AgentProviderId[] = [
    'cursor',
    'selfhosted',
    'smoke',
    'copilot',
] as const;

export function isAgentProviderId(value: string): value is AgentProviderId {
    return (AGENT_PROVIDER_IDS as readonly string[]).includes(value);
}

export interface AgentModelEntry {
    /** provider 内 model id，如 composer-2.5 / auto */
    id: string;
    name?: string;
    provider: AgentProviderId;
}

export interface AgentModelsListResult {
    ok: boolean;
    provider: AgentProviderId;
    models?: AgentModelEntry[];
    error?: string;
    status?: number;
}

/** 持久化 composite：cursor:composer-2.5 */
export interface AgentModelRef {
    provider: AgentProviderId;
    modelId: string;
}

export interface AgentRunRef {
    provider: AgentProviderId;
    agentId: string;
    runId?: string;
}

export interface AgentCreateInput {
    provider?: AgentProviderId;
    repoUrl: string;
    promptText: string;
    /** composite 字符串或 AgentModelRef；裸 id 视为 cursor */
    model?: AgentModelRef | string;
    autoCreatePR?: boolean;
    name?: string;
}

export interface AgentCreateResult {
    ok: boolean;
    ref?: AgentRunRef;
    error?: string;
    status?: number;
}

export interface AgentRunResult {
    status: string;
    resultText?: string;
    prUrl?: string;
    error?: string;
    terminal?: boolean;
}

/** neutral 流事件（sch1 D1 / Admin 轨迹复用） */
export type AgentStreamEventType = 'status' | 'message' | 'tool_call' | 'result' | 'error' | 'meta';

export interface AgentStreamEvent {
    eventType: AgentStreamEventType;
    streamEventId?: string | null;
    payload: Record<string, unknown>;
}

export interface AgentStreamOptions {
    lastEventId?: string;
}
