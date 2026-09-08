import { buildOpsErrorIntake, type IntakeEnv, submitIntakeEventAsync } from '../intake/index.js';
import type { OpsErrorEnv } from './report.js';
import { reportOpsErrorAsync } from './report.js';
import { type LogFields, sanitizeForLog } from './sanitize.js';

export type OpsLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface OpsLoggerOptions {
    env?: OpsErrorEnv & IntakeEnv;
    ctx?: Pick<ExecutionContext, 'waitUntil'>;
}

export interface OpsLogger {
    debug: (event: string, fields?: LogFields) => void;
    info: (event: string, fields?: LogFields) => void;
    warn: (event: string, fields?: LogFields) => void;
    error: (event: string, fields?: LogFields) => void;
}

function writeLog(
    workerName: string,
    level: OpsLogLevel,
    event: string,
    fields: LogFields = {},
): void {
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        worker: workerName,
        event,
        ...sanitizeForLog(fields),
    });
    if (level === 'error') {
        console.error(line);
    } else if (level === 'warn') {
        console.warn(line);
    } else {
        console.log(line);
    }
}

/** 告警邮件 error 字段截断上限：调用方把大段原文塞进 error/message 时封顶泄漏面 */
const OPS_ERROR_MESSAGE_MAX = 800;

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…(截断)` : text;
}

function extractErrorMessage(fields: LogFields, event: string): string {
    const fromFields = fields.error ?? fields.message;
    if (typeof fromFields === 'string' && fromFields.trim()) {
        return truncate(fromFields.trim(), OPS_ERROR_MESSAGE_MAX);
    }
    return event;
}

/** 结构化 JSON 日志；error 级可选即时运维邮件 */
export function createOpsLogger(workerName: string, options: OpsLoggerOptions = {}): OpsLogger {
    const { env, ctx } = options;

    const log = (level: OpsLogLevel, event: string, fields: LogFields = {}) => {
        writeLog(workerName, level, event, fields);
        if (level !== 'error' || !env) {
            return;
        }
        const { error: _errorField, message: _messageField, ...context } = fields;
        reportOpsErrorAsync(
            env,
            {
                worker: workerName,
                reason: event,
                error: extractErrorMessage(fields, event),
                context,
            },
            ctx,
        );
        if (fields.intake === true) {
            const intakeEvent = buildOpsErrorIntake({
                producer: workerName,
                worker: workerName,
                reason: event,
                error: extractErrorMessage(fields, event),
                context,
            });
            submitIntakeEventAsync(env, intakeEvent, ctx);
        }
    };

    return {
        debug: (event, fields) => log('debug', event, fields),
        info: (event, fields) => log('info', event, fields),
        warn: (event, fields) => log('warn', event, fields),
        error: (event, fields) => log('error', event, fields),
    };
}
