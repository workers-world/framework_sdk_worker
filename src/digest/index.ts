/**
 * framework_sdk_worker/digest — 定时多节摘要框架。
 *
 * 产品边界：批量/定时/异步汇总；即时通知仍由业务 Worker 直连 notify-worker。
 * 调度中枢：sch2；本模块提供 cadence、编排、邮件拼装与 capability 契约。
 */

export {
    cadenceDateFromPeriodKey,
    dailyCadence,
    getCadenceById,
    monthlyCadence,
    weeklyCadence,
} from './cadences.js';
export { composeDigestMail } from './compose-mail.js';
export {
    type CreateDigestRunRouteOptions,
    createDigestRunHandler,
    listDigestCapabilities,
} from './create-run-route.js';
export { buildDigestDedupKey } from './dedup-key.js';
export { getDigestDefinitionByCron, getDigestDefinitionById } from './registry.js';
export {
    runScheduledDigest,
    type ScheduledDigestRunOptions,
} from './run-scheduled-digest.js';
export type {
    CollectedDigestSection,
    ComposedDigestMail,
    DigestCadence,
    DigestCadenceId,
    DigestCapabilityDescriptor,
    DigestDefinition,
    DigestDeliverMeta,
    DigestRunRequestBody,
    DigestRunResponseBody,
    DigestSection,
    DigestSectionResult,
    ScheduledDigestRunResult,
} from './types.js';
