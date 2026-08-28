import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    type InboxInterruptInput,
    shouldInterruptInbox,
} from '../../src/evaluation/interrupt-inbox.js';

interface GoldenCase {
    name: string;
    input: InboxInterruptInput;
    channel: 'email' | 'dashboard';
    reason: string;
}

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/interrupt-inbox.json');
const golden = JSON.parse(readFileSync(fixturePath, 'utf8')) as GoldenCase[];

describe('shouldInterruptInbox golden', () => {
    it.each(golden)('$name', (row) => {
        expect(shouldInterruptInbox(row.input)).toEqual({
            interrupt: row.channel === 'email',
            channel: row.channel,
            reason: row.reason,
        });
    });
});
