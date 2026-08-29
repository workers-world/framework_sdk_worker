/**
 * 邮箱打扰策略：默认安静，仅实质变化 / 硬质量事故 / 持仓高先验才推邮件。
 * 上游：invest-rss / advisor / analysis-engine 发信前。
 * 下游：notify-worker 或 Dashboard。
 * 不变量：选材由本函数决定；LLM 不得覆盖 channel。
 */

export type InboxChannel = 'email' | 'dashboard';

export interface InboxInterruptInput {
    materialChange?: boolean;
    portfolioHit?: boolean;
    /** 有用度 1–5；未评分为 null/undefined */
    usefulnessPrior?: number | null;
    qualityIncidentHard?: boolean;
    importance?: number | null;
}

export interface InboxInterruptResult {
    interrupt: boolean;
    channel: InboxChannel;
    reason: string;
}

const USEFULNESS_EMAIL_MIN = 4;
const IMPORTANCE_EMAIL_MIN = 8;

export function shouldInterruptInbox(input: InboxInterruptInput): InboxInterruptResult {
    if (input.qualityIncidentHard) {
        return { interrupt: true, channel: 'email', reason: 'quality_incident' };
    }
    if (input.materialChange) {
        return { interrupt: true, channel: 'email', reason: 'material_change' };
    }
    if (input.portfolioHit && (input.usefulnessPrior ?? 0) >= USEFULNESS_EMAIL_MIN) {
        return { interrupt: true, channel: 'email', reason: 'portfolio_high_usefulness' };
    }
    if (input.portfolioHit && (input.importance ?? 0) >= IMPORTANCE_EMAIL_MIN) {
        return { interrupt: true, channel: 'email', reason: 'portfolio_high_importance' };
    }
    return { interrupt: false, channel: 'dashboard', reason: 'default_quiet' };
}
