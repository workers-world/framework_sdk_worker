export interface NotifyEnv {
    NOTIFY?: Fetcher;
    NOTIFY_AUTH_TOKEN?: string;
}

export interface AiEnv {
    AI: Ai;
    AI_GATEWAY_ID?: string;
    AIG_AUTH_TOKEN?: string;
    AIG_BYOK_ALIAS?: string;
    DEFAULT_MODEL?: string;
}

export interface GoldPriceEnv {
    GOLD_PRICE_BUCKET: R2Bucket;
}

export interface AuthTokenEnv {
    AUTH_TOKEN?: string;
    NOTIFY_AUTH_TOKEN?: string;
    ADMIN_TOKEN?: string;
    SYNC_BEARER_TOKEN?: string;
}
