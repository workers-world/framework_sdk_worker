import { sanitizeForLog } from '../ops-error';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}

/**
 * 简易日志：对参数中的纯对象做敏感字段脱敏（复用 ops-error/sanitizeForLog），
 * Error / Date / 类实例等非纯对象原样透传。
 * 规范入口是 ops-error 的 createOpsLogger（脱敏 + 告警）；本 logger 供轻量场景。
 */
export function createLogger(workerName: string): Logger {
    const prefix = `[${workerName}]`;
    const sanitizeArgs = (args: unknown[]): unknown[] =>
        args.map((arg) =>
            arg != null &&
            typeof arg === 'object' &&
            !Array.isArray(arg) &&
            (Object.getPrototypeOf(arg) === Object.prototype || Object.getPrototypeOf(arg) === null)
                ? sanitizeForLog(arg as Record<string, unknown>)
                : arg,
        );
    return {
        debug: (...args) => console.debug(prefix, ...sanitizeArgs(args)),
        info: (...args) => console.log(prefix, ...sanitizeArgs(args)),
        warn: (...args) => console.warn(prefix, ...sanitizeArgs(args)),
        error: (...args) => console.error(prefix, ...sanitizeArgs(args)),
    };
}
