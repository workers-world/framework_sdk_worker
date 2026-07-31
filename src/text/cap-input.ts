/**
 * 输入硬截断：大 payload 进 Worker 前立刻 cap，避免 JSON.parse / 正则烧 CPU。
 * 不追加省略号（与业务侧 truncateText 区分）；max < 0 时按 0 处理。
 */

/** 截断字符串到最多 max 个 UTF-16 code unit；max ≤ 0 返回空串。 */
export function capInput(value: string, max: number): string {
    if (max <= 0) return '';
    if (value.length <= max) return value;
    return value.slice(0, max);
}
