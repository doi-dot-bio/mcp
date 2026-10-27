// Model Context Protocol over stdio: newline-delimited JSON-RPC 2.0, one message per line.
// Zero dependencies; only the methods a tools-only server needs.
const readline = require('readline');
const { version } = require('../package.json');

const PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];
const LATEST = '2025-06-18';

function ok(id, result) { return { jsonrpc: '2.0', id, result }; }
function fail(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

function createServer({ tools, serverInfo = { name: 'doibio', version } }) {
    async function callTool(id, params) {
        const name = params && params.name;
        if (!tools.list.some((t) => t.name === name)) return fail(id, -32602, `unknown tool: ${name}`);
        try {
            return ok(id, await tools.call(name, params.arguments || {}));
        } catch (e) {
            return ok(id, { content: [{ type: 'text', text: 'error: ' + (e && e.message) }], isError: true });
        }
    }

    async function handle(msg) {
        const isRequest = msg && typeof msg === 'object' && !Array.isArray(msg) && 'id' in msg;
        if (!isRequest) return null; // notifications (and junk without an id) get no response
        const { id, method, params } = msg;
        if (typeof method !== 'string') return fail(id, -32600, 'invalid request');
        switch (method) {
            case 'initialize': {
                const asked = params && params.protocolVersion;
                return ok(id, {
                    protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST,
                    capabilities: { tools: { listChanged: false } },
                    serverInfo,
                });
            }
            case 'ping': return ok(id, {});
            case 'tools/list': return ok(id, { tools: tools.list });
            case 'tools/call': return callTool(id, params);
            default: return fail(id, -32601, `method not found: ${method}`);
        }
    }

    async function serve({ input, output }) {
        const rl = readline.createInterface({ input, crlfDelay: Infinity });
        for await (const line of rl) {
            if (!line.trim()) continue;
            let resp;
            try {
                let msg;
                try { msg = JSON.parse(line); } catch (_) { resp = fail(null, -32700, 'parse error'); }
                if (!resp) {
                    resp = Array.isArray(msg) ? fail(null, -32600, 'batches are not supported') : await handle(msg);
                }
            } catch (e) {
                resp = fail(null, -32603, 'internal error');
            }
            if (resp) output.write(JSON.stringify(resp) + '\n');
        }
    }

    return { handle, serve };
}

module.exports = { createServer, PROTOCOL_VERSIONS };
