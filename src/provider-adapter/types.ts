/**
 * Provider 适配层（ports & adapters）— 不是 Agent 生命周期。
 * 流程只依赖本接口；新后端注册适配器即可，流水线少改。
 */

/** 本仓审查 / Cloud Agent usage 已用 id；字符串开放以便后续接入 */
export type ProviderAdapterId = 'workers_ai_gateway' | 'opencode_go' | 'cursor' | (string & {});

export interface ProviderAdapterCapabilities {
    bindModel: boolean;
    usage: boolean;
    billing: boolean;
    quota: boolean;
}

/** 对齐 Langfuse usage_details / OTel gen_ai.usage.* */
export interface TokenBuckets {
    tokens_input: number;
    tokens_output: number;
    tokens_reasoning: number;
    tokens_cache_read: number;
    tokens_cache_write: number;
}

export interface UsageSnapshot extends TokenBuckets {
    /** message 内 cost 累加（若有）；瀑布第二档用 */
    message_cost_usd: number;
    correlationId: string;
}

/**
 * 账单 SoT。
 * - `ai_gateway`：网关/发票入账
 * - `provider_reported`：响应内 cost（旧名 `message_fallback` 可读兼容）
 * - `rate_card`：价目 × tokens（估计）
 * - `none`：无可用源
 */
export type CostSource =
    | 'ai_gateway'
    | 'provider_reported'
    | 'message_fallback'
    | 'rate_card'
    | 'none';

export interface BillingSnapshot {
    costUsd: number;
    source: CostSource;
}

export interface QuotaWindow {
    status: string;
    percent: number;
    resetsAt?: string;
}

export interface QuotaSnapshot {
    rolling?: QuotaWindow;
    weekly?: QuotaWindow;
    monthly?: QuotaWindow;
}

export interface BindableSession {
    setModel(model: unknown): Promise<void>;
}

export interface BindModelDeps {
    modelId: string;
    runId: string;
    owner: string;
    repo: string;
    pr: number;
    /**
     * Workers AI / createAI 可调用工厂。
     * SDK 不依赖 agents；由宿主传入。
     */
    ai?: (
        modelId: string,
        opts: { reasoningEffort?: string; metadata?: Record<string, string> },
    ) => unknown;
}

export interface UsageQuery {
    messages: readonly unknown[];
    operationId?: string;
    sinceMs?: number;
    /** Cursor 等：远端 agent/run */
    agentId?: string;
    runId?: string;
    apiKey?: unknown;
    fetchImpl?: typeof fetch;
}

export interface BillingQuery {
    usage: UsageSnapshot;
    runId: string;
    startedAtMs: number;
    modelId?: string;
    accountId?: string;
    apiToken?: string;
    gatewayId?: string;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    log?: (event: string, detail?: Record<string, unknown>) => void;
}

export interface QuotaQuery {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    baseUrl?: string;
}

export interface ProviderAdapter {
    readonly id: ProviderAdapterId;
    readonly capabilities: ProviderAdapterCapabilities;
    bindModel?(session: BindableSession, deps: BindModelDeps): Promise<void>;
    resolveUsage(q: UsageQuery): Promise<UsageSnapshot>;
    resolveBilling(q: BillingQuery): Promise<BillingSnapshot>;
    snapshotQuota?(q: QuotaQuery): Promise<QuotaSnapshot>;
}
