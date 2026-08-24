/**
 * 平台日志 slim：供 Quality Analyze 喂给 Cursor，保留 fetch/summarize/decision 相关行。
 */
import type { WorkersPlatformLogEvent } from './platform-log.js';

export interface SlimPlatformLogLine {
    ts?: string;
    level?: string;
    service?: string;
    message: string;
}

const SLIM_KEYWORDS =
    /quality|summarize|summary|fetch|browser|because|dedup|title_only|article|chain|path|llm|notify|reject|usable_body|thin_snippet|nav_shell|product_landing|quality_capture|quality_incident/i;

const DEFAULT_MAX_EVENTS = 80;
const DEFAULT_MAX_CHARS = 24_000;

function eventMessage(event: WorkersPlatformLogEvent): string {
    const meta = event.$metadata;
    const parts = [
        typeof event.message === 'string' ? event.message : '',
        typeof meta?.message === 'string' ? meta.message : '',
    ].filter(Boolean);
    return parts.join(' ').trim();
}

function eventService(event: WorkersPlatformLogEvent): string | undefined {
    const meta = event.$metadata;
    if (typeof meta?.service === 'string') {
        return meta.service;
    }
    const workers = event.$workers;
    if (typeof workers?.scriptName === 'string') {
        return workers.scriptName;
    }
    return undefined;
}

function isRelevantLine(message: string): boolean {
    if (!message) {
        return false;
    }
    return SLIM_KEYWORDS.test(message);
}

/** 从平台 log events 提取 Analyze 用 excerpt（按相关性过滤 + 硬截断） */
export function slimPlatformLogsForAnalysis(
    events: WorkersPlatformLogEvent[],
    options?: { maxEvents?: number; maxChars?: number },
): SlimPlatformLogLine[] {
    const maxEvents = options?.maxEvents ?? DEFAULT_MAX_EVENTS;
    const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
    const lines: SlimPlatformLogLine[] = [];
    let charCount = 0;

    for (const event of events) {
        const message = eventMessage(event);
        if (!isRelevantLine(message)) {
            continue;
        }
        const line: SlimPlatformLogLine = {
            ts: event.timestamp ?? event.$metadata?.timestamp,
            level: event.level ?? event.$metadata?.level,
            service: eventService(event),
            message: message.slice(0, 2_000),
        };
        const lineChars = line.message.length + (line.service?.length ?? 0) + 32;
        if (charCount + lineChars > maxChars || lines.length >= maxEvents) {
            break;
        }
        lines.push(line);
        charCount += lineChars;
    }

    return lines;
}
