/**
 * Clef-flash（System One / Jev 兼容）noul 决策：直调 Workers AI，不经 llm-gateway。
 * @see https://developers.cloudflare.com/workers-ai/models/clef-flash/
 */

export const CLEF_FLASH_MODEL = '@cf/cloudflare/clef-flash';
export const CLEF_NOUL_THRESHOLD_DEFAULT = 0.5;

export type ClefQuestionDef = {
    type: 'noul';
    instructions: string;
};

export type ClefAnswers = Record<string, { noul?: number; confidence?: number } | undefined>;

export type ClefRunResponse = {
    answers?: ClefAnswers;
};

export type ClefNoulParams = {
    state: string;
    questions: Record<string, ClefQuestionDef>;
    /** AI Gateway / Workers AI 观测 tags */
    tags?: string[];
};

export type ClefNoulResult = { ok: true; answers: ClefAnswers } | { ok: false; error: string };

/** 从 Clef answers 取 noul 概率 → boolean；缺字段返回 null */
export function clefNoulAnswer(
    answers: ClefAnswers | undefined,
    questionId: string,
    threshold: number = CLEF_NOUL_THRESHOLD_DEFAULT,
): boolean | null {
    const entry = answers?.[questionId];
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    const p = entry.noul;
    if (typeof p !== 'number' || !Number.isFinite(p)) {
        return null;
    }
    return p >= threshold;
}

/**
 * 直调 Clef-flash noul。AI 缺失或调用失败 → `{ ok:false }`，不抛裸异常。
 */
export async function runClefNoul(
    ai: Ai | undefined,
    params: ClefNoulParams,
): Promise<ClefNoulResult> {
    if (!ai) {
        return { ok: false, error: 'AI binding missing' };
    }
    const state = params.state.trim();
    if (!state) {
        return { ok: false, error: 'state 不能为空' };
    }
    const questionIds = Object.keys(params.questions);
    if (questionIds.length === 0) {
        return { ok: false, error: 'questions 不能为空' };
    }
    try {
        const raw = (await ai.run(
            CLEF_FLASH_MODEL as Parameters<Ai['run']>[0],
            {
                model: 'clef-flash',
                state,
                questions: params.questions,
            },
            params.tags?.length ? { tags: params.tags } : undefined,
        )) as ClefRunResponse;

        return { ok: true, answers: raw?.answers ?? {} };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg.slice(0, 400) };
    }
}
