/** 初始 kind 常量（权威注册表在 sch1/rules/intake-kinds.json） */

export const INTAKE_KIND_OPS_ERROR = 'ops.error';
export const INTAKE_KIND_QUALITY_CLUSTER = 'quality.cluster';
export const INTAKE_KIND_QUALITY_LOG_DIGEST = 'quality.log_digest';

export const KNOWN_INTAKE_KINDS = [
    INTAKE_KIND_OPS_ERROR,
    INTAKE_KIND_QUALITY_CLUSTER,
    INTAKE_KIND_QUALITY_LOG_DIGEST,
] as const;

export type KnownIntakeKind = (typeof KNOWN_INTAKE_KINDS)[number];
