/**
 * Clef-flash（System One / Jev 兼容）决策：直调 Workers AI，不经 llm-gateway。
 * @see https://developers.cloudflare.com/workers-ai/models/clef-flash/
 */

export const CLEF_FLASH_MODEL = '@cf/cloudflare/clef-flash';
export const CLEF_NOUL_THRESHOLD_DEFAULT = 0.5;

export type ClefNoulQuestionDef = {
    type: 'noul';
    instructions: string;
    criteria?: { true?: string; false?: string };
};

export type ClefChoiceQuestionDef = {
    type: 'choice';
    instructions: string;
    criteria: Record<string, string>;
};

export type ClefScoreQuestionDef = {
    type: 'score';
    instructions: string;
    /** 有序档位说明；索引即分值（0..n-1） */
    criteria: string[];
};

export type ClefQuestionDef = ClefNoulQuestionDef | ClefChoiceQuestionDef | ClefScoreQuestionDef;

export type ClefAnswerEntry = {
    type?: string;
    noul?: number;
    choice?: string;
    score?: number;
    confidence?: number;
    probabilities?: Record<string, number>;
    legend?: Record<string, string>;
};

export type ClefAnswers = Record<string, ClefAnswerEntry | undefined>;

export type ClefRunResponse = {
    answers?: ClefAnswers;
    model?: string;
};

export type ClefEvaluateParams = {
    state: string;
    questions: Record<string, ClefQuestionDef>;
    /** 覆盖默认 `@cf/cloudflare/clef-flash` */
    model?: string;
    /** AI Gateway / Workers AI 观测 tags */
    tags?: string[];
};

/** @deprecated 用 {@link ClefEvaluateParams}；仅 noul 问题仍兼容 */
export type ClefNoulParams = {
    state: string;
    questions: Record<string, ClefNoulQuestionDef>;
    tags?: string[];
    model?: string;
};

export type ClefEvaluateResult =
    | { ok: true; answers: ClefAnswers; model: string }
    | { ok: false; error: string };

/** @deprecated 同 {@link ClefEvaluateResult} */
export type ClefNoulResult = ClefEvaluateResult;

function resolveClefModelId(model?: string): string {
    const trimmed = model?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : CLEF_FLASH_MODEL;
}

/** Workers AI System One 入参里的短模型名（body.model） */
function clefBodyModelName(bindingModel: string): string {
    if (bindingModel === CLEF_FLASH_MODEL || bindingModel.endsWith('/clef-flash')) {
        return 'clef-flash';
    }
    const slash = bindingModel.lastIndexOf('/');
    return slash >= 0 ? bindingModel.slice(slash + 1) : bindingModel;
}

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

/** 从 Clef answers 取 choice；缺字段返回 null */
export function clefChoiceAnswer(
    answers: ClefAnswers | undefined,
    questionId: string,
): string | null {
    const entry = answers?.[questionId];
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    const choice = entry.choice;
    if (typeof choice !== 'string' || !choice.trim()) {
        return null;
    }
    return choice.trim();
}

/** 从 Clef answers 取 score；缺字段返回 null */
export function clefScoreAnswer(
    answers: ClefAnswers | undefined,
    questionId: string,
): number | null {
    const entry = answers?.[questionId];
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    const score = entry.score;
    if (typeof score !== 'number' || !Number.isFinite(score)) {
        return null;
    }
    return score;
}

/**
 * 直调 Clef（noul / choice / score 一次多问）。
 * AI 缺失或调用失败 → `{ ok:false }`，不抛裸异常。
 */
export async function runClefEvaluate(
    ai: Ai | undefined,
    params: ClefEvaluateParams,
): Promise<ClefEvaluateResult> {
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
    const bindingModel = resolveClefModelId(params.model);
    try {
        const raw = (await ai.run(
            bindingModel as Parameters<Ai['run']>[0],
            {
                model: clefBodyModelName(bindingModel),
                state,
                questions: params.questions,
            },
            params.tags?.length ? { tags: params.tags } : undefined,
        )) as ClefRunResponse;

        return {
            ok: true,
            answers: raw?.answers ?? {},
            model: typeof raw?.model === 'string' && raw.model.trim() ? raw.model : bindingModel,
        };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg.slice(0, 400) };
    }
}

/**
 * 直调 Clef-flash noul（薄封装 {@link runClefEvaluate}）。
 * email-rule / deploy-tracker 既有调用面保持不变。
 */
export async function runClefNoul(
    ai: Ai | undefined,
    params: ClefNoulParams,
): Promise<ClefNoulResult> {
    return runClefEvaluate(ai, params);
}
