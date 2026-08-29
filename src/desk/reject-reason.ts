/**
 * 资金草稿驳回原因：Java / desk 确认闸门的结构化反馈。
 * 上游：人工否决草稿。
 * 下游：hard 风控规则与 golden fixture。
 * 不变量：只有本枚举可写入 reject_reason；自由文本放 comment。
 */

export const DRAFT_REJECT_REASONS = [
    'wrong_side',
    'wrong_size',
    'too_early',
    'not_in_mandate',
    'duplicate',
    'data_bad',
] as const;

export type DraftRejectReason = (typeof DRAFT_REJECT_REASONS)[number];

export function isDraftRejectReason(value: unknown): value is DraftRejectReason {
    return typeof value === 'string' && (DRAFT_REJECT_REASONS as readonly string[]).includes(value);
}
