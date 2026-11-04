/** Read-only, bounded projection of hash-bound visible session evidence. Never reads raw logs. */
import * as path from 'node:path';
import { readVerifiedFile } from './evaluation_files.js';
export const transcriptBudget = () => ({ remaining: 512 * 1024, readRemaining: 16 * 1024 * 1024 });
const fileLimit = 2 * 1024 * 1024, sideLimit = 128 * 1024;
const omissionKeys = new Set(['hidden_message', 'toolRequest', 'toolResponse', 'thinking', 'redactedThinking', 'image', 'document', 'systemNotification', 'error', 'actionRequired', 'toolConfirmationRequest', 'other_content']);
/** Portable descriptor reads reject observed links, special files and evidence drift.
 * The hash binds local bytes to the untrusted report, not to receipt authenticity. */
export function readVisibleTranscript(root, run, budget = transcriptBudget()) {
    const binding = run?.session_log;
    const unavailable = (reason) => ({ status: 'unavailable', reason, messages: [], omitted: {}, truncated: false });
    if (!binding || binding.status !== 'retained')
        return unavailable('Visible conversation unavailable: session capture missing or unavailable.');
    const safeRelative = (v) => typeof v === 'string' && !!v && !path.isAbsolute(v) && !v.includes('\\') && !v.includes('\0') && v.split('/').every(p => p !== '.' && p !== '..' && !!p);
    if (typeof root !== 'string' || !root || root.includes('\0') || root.split(/[\/\\]/).includes('..') || !safeRelative(run.directory) || !safeRelative(binding.path) || binding.path !== 'session-log.json' || !/^[a-f0-9]{64}$/.test(binding.sha256) || !Number.isSafeInteger(binding.bytes) || binding.bytes < 0)
        return unavailable('Visible conversation unavailable: invalid path/hash binding.');
    if (binding.bytes > fileLimit)
        return unavailable('Visible conversation unavailable: transcript exceeds file size limit (2 MiB); archive unchanged.');
    if (binding.bytes > budget.readRemaining)
        return unavailable('Visible conversation unavailable: report read limit reached; archive unchanged.');
    budget.readRemaining -= binding.bytes;
    try {
        const bytes = readVerifiedFile(path.join(path.resolve(root), run.directory, binding.path), { bytes: binding.bytes, sha256: binding.sha256, maxBytes: fileLimit });
        const source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!['goose-session-log-v1', 'goose-session-log-v2'].includes(source.protocol) || typeof binding.session_name !== 'string' || source.session_name !== binding.session_name || source.redacted !== false || !Array.isArray(source.messages) || source.messages.length > 4096)
            throw Error('projection');
        const out = { status: 'available', messages: [], omitted: {}, truncated: !['complete-visible-text', 'complete-visible-text-and-tools'].includes(source.completeness), path: run.directory + '/' + binding.path, sha256: binding.sha256 };
        for (const [key, n] of Object.entries(source.omitted ?? {}))
            if (omissionKeys.has(key) && Number.isSafeInteger(n) && Number(n) > 0)
                out.omitted[key] = Number(n);
        let remaining = Math.min(sideLimit, budget.remaining);
        for (const message of source.messages) {
            if (!message || !['user', 'assistant'].includes(message.role) || message.metadata?.userVisible === false || (message.annotations?.audience !== undefined && (!Array.isArray(message.annotations.audience) || !message.annotations.audience.includes('user')))) {
                out.omitted.hidden_message = (out.omitted.hidden_message ?? 0) + 1;
                continue;
            }
            if (!Array.isArray(message.text) || message.text.length > 4096 || message.text.some((s) => typeof s !== 'string'))
                throw Error('projection');
            const kind = message.kind;
            if (kind !== undefined && !['text', 'toolRequest', 'toolResponse'].includes(kind))
                throw Error('projection');
            const tool = kind === 'toolRequest' || kind === 'toolResponse';
            if (tool && (source.protocol !== 'goose-session-log-v2' || typeof message.tool_id !== 'string' || message.tool_id.length > 512 || !['success', 'error'].includes(message.status) || (message.tool_name !== undefined && (typeof message.tool_name !== 'string' || message.tool_name.length > 512))))
                throw Error('projection');
            const metadataSize = tool ? (message.tool_id.length + (message.tool_name?.length ?? 0)) : 0;
            if (metadataSize > remaining) {
                out.truncated = true;
                continue;
            }
            remaining -= metadataSize;
            budget.remaining -= metadataSize;
            const full = message.text.join('\n\n'), value = full.slice(0, remaining);
            if (value.length || tool)
                out.messages.push({ role: message.role, text: value, ...(kind ? { kind } : {}), ...(tool ? { tool_id: message.tool_id, status: message.status, ...(message.tool_name !== undefined ? { tool_name: message.tool_name } : {}) } : {}) });
            if (value.length < full.length)
                out.truncated = true;
            remaining -= value.length;
            budget.remaining -= value.length;
        }
        return out;
    }
    catch {
        return unavailable('Visible conversation unavailable: missing, unsafe, changed, hash-mismatched or unsupported transcript.');
    }
}
