export const MAX_SEQ = 999_999;

export const PREFIX_MAX_LEN = 16;
export const PREFIX_PATTERN = /^[A-Za-z0-9_]+$/;

export class SequenceOverflowError extends Error {
    readonly prefix: string;
    readonly bizDate: string;
    readonly seq: number;

    constructor(prefix: string, bizDate: string, seq: number) {
        super(`ID 序号溢出: prefix=${prefix}, bizDate=${bizDate}, seq=${seq}`);
        this.name = 'SequenceOverflowError';
        this.prefix = prefix;
        this.bizDate = bizDate;
        this.seq = seq;
    }
}

export class InvalidPrefixError extends Error {
    constructor(prefix: string) {
        super(`prefix 非法: ${prefix}`);
        this.name = 'InvalidPrefixError';
    }
}

export function validatePrefix(prefix: string): string {
    const trimmed = prefix.trim();
    if (!trimmed) {
        throw new InvalidPrefixError(prefix);
    }
    if (trimmed.length > PREFIX_MAX_LEN) {
        throw new InvalidPrefixError(prefix);
    }
    if (!PREFIX_PATTERN.test(trimmed)) {
        throw new InvalidPrefixError(prefix);
    }
    return trimmed;
}
