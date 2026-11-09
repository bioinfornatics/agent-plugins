import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
export const READER_LIMITS = { calls: 64, sliceBytes: 8192, deliveredBytes: 262144, requestBytes: 16384 };
const TOOL_SCAN_LIMIT = 200000;
const CONVERSATION_BYTES = 64 * 1024 * 1024;
const tools = [
    { name: "list_manifest", description: "List immutable neutral evidence bindings and priorities", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "read_artifact", description: "Read a bounded UTF-8 slice by neutral artifact ID and byte offset/length", inputSchema: { type: "object", properties: { path: { type: "string", pattern: "^artifact-[1-9][0-9]*$" }, offset: { type: "integer", minimum: 0 }, length: { type: "integer", minimum: 1, maximum: 8192 } }, required: ["path", "offset", "length"], additionalProperties: false } },
    { name: "list_tool_events", description: "Index actual conversation toolRequest/toolResponse blocks; untrusted JSON, exact IDs only, explicit scan/pagination/truncation status. Locators are not byte offsets.", inputSchema: { type: "object", properties: { path: { type: "string", pattern: "^artifact-[1-9][0-9]*$" }, cursor: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 }, exactTool: { type: "string", minLength: 1, maxLength: 256 } }, required: ["path", "cursor", "limit"], additionalProperties: false } },
];
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function eventId(event) { return typeof event.id === "string" && event.id.length > 0 ? event.id : undefined; }
function requestValue(event) {
    const call = event.block.toolCall;
    return object(call) && call.status === "success" && object(call.value) ? call.value : undefined;
}
/** Scan only actual content blocks, never recursive prose/wrapper code. A capped
 * scan cannot establish uniqueness: a duplicate may exist beyond the frontier. */
function indexToolEvents(data) {
    const index = { scan: "complete", scanned: 0, events: [], requests: new Map(), responses: new Map() };
    const conversation = object(data) ? data.conversation : undefined;
    let messages;
    if (object(data) && Array.isArray(data.messages)) {
        index.envelope = "messages";
        messages = data.messages;
    }
    else if (Array.isArray(conversation)) {
        index.envelope = "conversation";
        messages = conversation;
    }
    else if (object(conversation) && Array.isArray(conversation.messages)) {
        index.envelope = "conversation.messages";
        messages = conversation.messages;
    }
    if (!messages) {
        index.scan = "unsupported";
        return index;
    }
    for (let message = 0; message < messages.length; message++) {
        if (index.scanned >= TOOL_SCAN_LIMIT) {
            index.scan = "capped";
            break;
        }
        index.scanned++;
        const value = messages[message];
        if (!object(value) || typeof value.role !== "string" || !(typeof value.content === "string" || Array.isArray(value.content))) {
            index.scan = "unsupported";
            continue;
        }
        if (!Array.isArray(value.content))
            continue;
        for (let block = 0; block < value.content.length; block++) {
            if (index.scanned >= TOOL_SCAN_LIMIT) {
                index.scan = "capped";
                break;
            }
            index.scanned++;
            const content = value.content[block];
            if (!object(content) || typeof content.type !== "string") {
                index.scan = "unsupported";
                continue;
            }
            if (content.type !== "toolRequest" && content.type !== "toolResponse")
                continue;
            const event = { type: content.type, locator: { message, block }, id: content.id, block: content };
            index.events.push(event);
            const payload = content.type === "toolRequest" ? content.toolCall : content.toolResult;
            // Malformed requests cannot establish exact-tool absence, and malformed
            // responses cannot establish successful access even when IDs are unique.
            if (!object(payload) || !(payload.status === "error" && typeof payload.error === "string"
                || payload.status === "success" && object(payload.value) && (content.type === "toolRequest" ? typeof payload.value.name === "string" && payload.value.name.length > 0 : Array.isArray(payload.value.content))))
                index.scan = "unsupported";
            const id = eventId(event), ids = event.type === "toolRequest" ? index.requests : index.responses;
            if (id !== undefined) {
                const entries = ids.get(id) ?? [];
                entries.push(event);
                ids.set(id, entries);
            }
        }
        if (index.scan === "capped")
            break;
    }
    return index;
}
/** JSON snippets are data, not citations. Truncated JSON is explicitly marked;
 * never claim byte offsets in the original escaped source from decoded blocks. */
function boundedJson(value) {
    if (value === undefined)
        return { json: null, truncated: false };
    let json;
    try {
        json = JSON.stringify(value);
    }
    catch {
        return { json: null, truncated: true };
    }
    const bytes = Buffer.from(json);
    return { json: bytes.length <= 512 ? json : new TextDecoder().decode(bytes.subarray(0, 512)), truncated: bytes.length > 512 };
}
function describeToolEvent(event, index) {
    const id = eventId(event), requests = id === undefined ? [] : index.requests.get(id) ?? [], responses = id === undefined ? [] : index.responses.get(id) ?? [];
    const match = id === undefined ? "missing-id" : index.scan !== "complete" ? "unverified"
        : requests.length > 1 || responses.length > 1 ? "ambiguous"
            : requests.length === 0 ? "orphan-response" : responses.length === 0 ? "missing-response" : "matched";
    const request = event.type === "toolRequest" ? event : match === "matched" ? requests[0] : undefined;
    const call = request && requestValue(request);
    const response = event.type === "toolResponse" ? event : match === "matched" ? responses[0] : undefined;
    const result = response?.block.toolResult;
    const requestPayload = request?.block.toolCall;
    return { type: event.type, locator: event.locator, id: boundedJson(event.id), match,
        ...(match === "matched" ? { matchedLocator: (event.type === "toolRequest" ? responses[0] : requests[0])?.locator } : {}),
        ...(object(requestPayload) ? { requestStatus: boundedJson(requestPayload.status), ...(requestPayload.status === "error" ? { requestError: boundedJson(requestPayload.error) } : {}) } : {}),
        ...(call ? { toolName: boundedJson(call.name), arguments: boundedJson(call.arguments) } : {}),
        ...(object(result) ? { responseStatus: boundedJson(result.status), responseContent: boundedJson(result.status === "success" ? result.value : result.error) } : {}) };
}
function toolEventPage(index, entry, cursor, limit, exactTool) {
    const events = exactTool === undefined ? index.events : index.events.filter(event => {
        const id = eventId(event), requests = id === undefined ? [] : index.requests.get(id) ?? [];
        // Never assign a response a tool identity through ambiguous or partial matching.
        const request = event.type === "toolRequest" ? event : index.scan === "complete" && requests.length === 1 && index.responses.get(id ?? "")?.length === 1 ? requests[0] : undefined;
        return request !== undefined && requestValue(request)?.name === exactTool;
    });
    if (cursor > events.length)
        throw new Error("Invalid event cursor");
    const page = { path: entry.path, sha256: entry.sha256, scan: index.scan, envelope: index.envelope ?? null, scanned: index.scanned,
        totalEvents: index.events.length, matchingEvents: events.length, cursor, nextCursor: null,
        pagination: "end", events: [] };
    for (let position = cursor; position < events.length && page.events.length < limit; position++) {
        const event = events[position];
        if (!event)
            break;
        page.events.push(describeToolEvent(event, index));
        page.nextCursor = position + 1;
        page.pagination = "byte-limited";
        if (Buffer.byteLength(JSON.stringify(page)) > READER_LIMITS.sliceBytes) {
            page.events.pop();
            page.nextCursor = position;
            break;
        }
    }
    const next = cursor + page.events.length;
    if (next === events.length) {
        page.nextCursor = null;
        page.pagination = "end";
    }
    else if (page.pagination !== "byte-limited" || page.events.length === limit) {
        page.nextCursor = next;
        page.pagination = "more";
    }
    return page;
}
export async function inspectReaderRoot(root) {
    if (!isAbsolute(root) || resolve(root) !== root)
        throw new Error("Invalid reader root");
    let current = parse(root).root;
    for (const part of root.slice(current.length).split(sep).filter(Boolean)) {
        current = join(current, part);
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink())
            throw new Error("Unsafe reader directory");
        if ([root, dirname(root)].includes(current) && ((info.mode & 0o777) !== 0o700 || (process.getuid && info.uid !== process.getuid())))
            throw new Error("Reader root must be private");
    }
}
/** One server, one fixed evidence root, no caller-selected filesystem paths or execution tools.
 * Root components are checked and files opened NOFOLLOW; not an OS sandbox against directory races. */
export class EvidenceReader {
    calls = 0;
    delivered = 0;
    exhausted = false;
    indexedBytes = 0;
    indexes = new Map();
    manifest;
    root;
    hash;
    trace;
    constructor(root, hash, trace) { this.root = root; this.hash = hash; this.trace = trace; }
    async file(name, limit) {
        await inspectReaderRoot(this.root);
        const handle = await open(join(this.root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const info = await handle.stat();
            if (!info.isFile() || info.nlink !== 1 || info.size > limit || (info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid()))
                throw new Error("Unsafe reader file");
            const bytes = await handle.readFile();
            if (bytes.length !== info.size)
                throw new Error("Reader file changed");
            return bytes;
        }
        finally {
            await handle.close();
        }
    }
    async load() {
        if (this.manifest)
            return this.manifest;
        const bytes = await this.file("manifest.json", 128 * 1024);
        if (createHash("sha256").update(bytes).digest("hex") !== this.hash)
            throw new Error("Manifest binding mismatch");
        const value = JSON.parse(bytes.toString("utf8"));
        if (value.version !== 2 || !Array.isArray(value.artifacts) || value.artifacts.length > 10000)
            throw new Error("Invalid manifest");
        const ids = new Set();
        for (const e of value.artifacts) {
            if (!/^artifact-[1-9][0-9]*$/.test(e.path) || ids.has(e.path) || !/^[a-f0-9]{64}$/.test(e.sha256) || !["text", "nontext"].includes(e.kind) || !["primary", "secondary"].includes(e.priority) || (e.kind === "nontext" ? e.bytes !== null : typeof e.bytes !== "number" || !Number.isSafeInteger(e.bytes) || e.bytes < 0 || e.bytes > 64 * 1024 * 1024))
                throw new Error("Invalid manifest entry");
            ids.add(e.path);
        }
        this.manifest = value;
        return value;
    }
    async conversationIndex(entry) {
        const cached = this.indexes.get(entry.path);
        if (cached)
            return cached;
        if (entry.kind !== "text" || entry.bytes === null)
            throw new Error("Invalid conversation artifact");
        // Bound retained parsed data across all neutral artifacts, not merely per call.
        if (this.indexedBytes + entry.bytes > CONVERSATION_BYTES)
            return { scan: "capped", scanned: 0, events: [], requests: new Map(), responses: new Map() };
        const bytes = await this.file(entry.path, entry.bytes);
        if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
            throw new Error("Conversation binding mismatch");
        this.indexedBytes += bytes.length;
        let index;
        try {
            index = indexToolEvents(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)));
        }
        catch {
            index = { scan: "invalid-json", scanned: 0, events: [], requests: new Map(), responses: new Map() };
        }
        this.indexes.set(entry.path, index);
        return index;
    }
    async call(name, args) {
        if (++this.calls > READER_LIMITS.calls)
            throw new Error("Evidence read count exceeded");
        if (this.exhausted)
            throw new Error("Evidence context byte limit exceeded");
        await this.trace(JSON.stringify({ event: "request", tool: tools.some(t => t.name === name) ? name : "unknown", calls: this.calls }));
        if (!args || typeof args !== "object" || Array.isArray(args))
            throw new Error("Invalid tool arguments");
        const a = args, manifest = await this.load();
        let result;
        if (name === "list_manifest" && Object.keys(a).length === 0)
            result = manifest;
        else if (name === "list_tool_events") {
            if (!["cursor,limit,path", "cursor,exactTool,limit,path"].includes(Object.keys(a).sort().join(",")) || typeof a.path !== "string" || !/^artifact-[1-9][0-9]*$/.test(a.path) || !Number.isSafeInteger(a.cursor) || a.cursor < 0 || !Number.isSafeInteger(a.limit) || a.limit < 1 || a.limit > 100 || (Object.hasOwn(a, "exactTool") && (typeof a.exactTool !== "string" || a.exactTool.length < 1 || a.exactTool.length > 256)))
                throw new Error("Invalid event arguments");
            const entry = manifest.artifacts.find(e => e.path === a.path);
            if (entry?.kind !== "text")
                throw new Error("Invalid conversation artifact");
            result = toolEventPage(await this.conversationIndex(entry), entry, a.cursor, a.limit, a.exactTool);
        }
        else if (name === "read_artifact" && Object.keys(a).sort().join(",") === "length,offset,path") {
            if (typeof a.path !== "string" || !/^artifact-[1-9][0-9]*$/.test(a.path) || !Number.isSafeInteger(a.offset) || !Number.isSafeInteger(a.length))
                throw new Error("Invalid slice");
            const offset = a.offset, length = a.length, entry = manifest.artifacts.find(e => e.path === a.path);
            if (entry?.kind !== "text" || entry.bytes === null || offset < 0 || offset > entry.bytes || length < 1 || length > READER_LIMITS.sliceBytes)
                throw new Error("Invalid slice bounds");
            // Read only requested bytes. Copies were authenticated once by the persistent writer;
            // hashing full multi-MB files on every slice would defeat targeted reading.
            await inspectReaderRoot(this.root);
            const handle = await open(join(this.root, entry.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            try {
                const info = await handle.stat();
                if (!info.isFile() || info.nlink !== 1 || info.size !== entry.bytes || (info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid()))
                    throw new Error("Unsafe evidence file");
                const bytes = Buffer.alloc(Math.min(length, entry.bytes - offset));
                const read = await handle.read(bytes, 0, bytes.length, offset);
                if (read.bytesRead !== bytes.length)
                    throw new Error("Evidence slice changed");
                result = { path: entry.path, sha256: entry.sha256, offset, bytes: read.bytesRead, text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
            }
            finally {
                await handle.close();
            }
        }
        else
            throw new Error("Unknown tool or arguments");
        const text = JSON.stringify(result), bytes = Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text }] }));
        if (this.delivered + bytes > READER_LIMITS.deliveredBytes) {
            this.exhausted = true;
            throw new Error("Evidence context byte limit exceeded");
        }
        this.delivered += bytes;
        await this.trace(JSON.stringify({ name, ...(name === "read_artifact" ? { path: a.path, offset: a.offset, length: a.length } : {}), calls: this.calls, deliveredBytes: this.delivered }));
        return { content: [{ type: "text", text }] };
    }
}
/** Newline-delimited JSON-RPC MCP stdio. Sequential dispatch preserves cumulative budgets.
 * Caller owns streams. Diagnostics never include evidence or arbitrary request text. */
export async function serveEvidenceReader(reader, input, output) {
    let pending = Buffer.alloc(0);
    let messages = 0;
    let protocolBytes = 0;
    const send = async (value) => {
        const frame = `${JSON.stringify(value)}\n`;
        // Include error frames and tool discovery too: refusing a call must not bypass
        // the total delivered-context ceiling through repeated error messages.
        protocolBytes += Buffer.byteLength(frame);
        if (protocolBytes > READER_LIMITS.deliveredBytes)
            throw new Error("MCP delivery byte limit exceeded");
        await new Promise((resolve, reject) => output.write(frame, error => error ? reject(error) : resolve()));
    };
    for await (const chunk of input) {
        pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
        while (pending.indexOf(10) >= 0) {
            const newline = pending.indexOf(10);
            if (++messages > 128)
                throw new Error("MCP message count exceeded");
            const line = pending.subarray(0, newline);
            pending = pending.subarray(newline + 1);
            if (line.length > READER_LIMITS.requestBytes)
                throw new Error("MCP request size exceeded");
            let message;
            try {
                message = JSON.parse(line.toString("utf8"));
            }
            catch {
                await send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } });
                continue;
            }
            if (!message || typeof message !== "object")
                continue;
            if (message.id === undefined)
                continue;
            let result;
            try {
                if (message.method === "initialize")
                    result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "judge_evidence", version: "2.0.0" } };
                else if (message.method === "ping")
                    result = {};
                else if (message.method === "tools/list")
                    result = { tools };
                else if (message.method === "tools/call")
                    result = await reader.call(message.params?.name ?? "", message.params?.arguments ?? {});
                else {
                    await send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
                    continue;
                }
            }
            catch {
                result = { isError: true, content: [{ type: "text", text: "Evidence request refused: invalid binding, bounds or exhausted budget" }] };
            }
            await send({ jsonrpc: "2.0", id: message.id, result });
        }
        if (pending.length > READER_LIMITS.requestBytes)
            throw new Error("MCP request size exceeded");
    }
}
