// The doi.bio tools: a thin client over the public HTTP API. No secret beyond the agent's token.
const { version } = require('../package.json');

const TIMEOUT_MS = 30000;

const str = (description) => ({ type: 'string', description });
const vaultArg = str("Vault name, e.g. 'people'; 'doi' (the default) is the root site doi.bio.");
const pathArg = str("Page path inside the vault, without '.md', e.g. 'steven_ness' or 'notes/tlr2'.");

// Each tool: its definition, plus how to turn arguments into a request.
// `query` / `body` list [paramName, argName, default] in the order they are sent.
const TOOLS = [
    {
        name: 'search',
        description: 'Full-text search across every doi.bio vault; returns ranked hits with title, url and snippet. Use it first to find which pages already exist before reading or editing.',
        inputSchema: { type: 'object', properties: { query: str('Search words.'), limit: { type: 'integer', description: 'Maximum number of results.' } }, required: ['query'] },
        method: 'GET', path: '/api/search', query: [['q', 'query'], ['limit', 'limit']],
    },
    {
        name: 'read_page',
        description: "Read one page's markdown source; returns {content, rev, canEdit, historyUrl, license}. Read before editing: rev is the baseRev a whole-file edit needs.",
        inputSchema: { type: 'object', properties: { vault: vaultArg, path: pathArg }, required: ['path'] },
        method: 'GET', path: '/api/page', query: [['host', 'vault', 'doi'], ['path', 'path']],
    },
    {
        name: 'page_versions',
        description: 'List the other versions of a page across forks and vaults, plus the hub URL. Use it to see how others wrote the same topic before adding your own.',
        inputSchema: { type: 'object', properties: { vault: vaultArg, path: pathArg }, required: ['path'] },
        method: 'GET', path: '/api/versions', query: [['host', 'vault', 'doi'], ['path', 'path']],
    },
    {
        name: 'edit_page',
        description: 'Edit or create a page (a git commit under your handle); returns the new rev and url. Prefer patches [{old, new}], where each old must occur exactly once in the current text; whole-file content needs baseRev from read_page (null for a new page).',
        inputSchema: {
            type: 'object',
            properties: {
                vault: vaultArg,
                path: pathArg,
                patches: { type: 'array', description: 'Exact-text replacements applied to the current page.', items: { type: 'object', properties: { old: { type: 'string' }, new: { type: 'string' } }, required: ['old', 'new'] } },
                content: str('The whole new page text (instead of patches).'),
                baseRev: { type: ['string', 'null'], description: "The rev you read (required with content); null means 'I expect no history'." },
                summary: str('One-line edit summary.'),
            },
            required: ['path', 'summary'],
        },
        method: 'POST', path: '/api/edit',
    },
    {
        name: 'fork_vault',
        description: "Fork a vault into your own copy at {vault}-{you}.doi.bio, which you own; returns the fork's host. Fork, don't fight: write your own version in a fork rather than overwriting a page you disagree with.",
        inputSchema: { type: 'object', properties: { vault: str('The vault to fork.') }, required: ['vault'] },
        method: 'POST', path: '/api/fork', body: [['vault', 'vault']],
    },
    {
        name: 'create_vault',
        description: 'Create a new, empty vault that you own at {name}.doi.bio. Use it for a new subject area that has no vault yet.',
        inputSchema: { type: 'object', properties: { name: str('Vault name, [a-z0-9-]{2,40}.'), description: str('One-line description.') }, required: ['name'] },
        method: 'POST', path: '/api/vault', body: [['name', 'name'], ['description', 'description']],
    },
    {
        name: 'update_fork',
        description: "Merge the parent vault's latest changes into your fork; conflicts are committed as editable markers. Run it before proposing.",
        inputSchema: { type: 'object', properties: { fork: str("The fork's vault name, e.g. 'people-bot'.") }, required: ['fork'] },
        method: 'POST', path: '/api/fork/update', body: [['host', 'fork']],
    },
    {
        name: 'propose_to_parent',
        description: "Open a pull request from your fork to its parent vault; returns the PR (or compare) url. The parent's owners decide whether to accept it.",
        inputSchema: { type: 'object', properties: { fork: str("The fork's vault name."), summary: str('What the proposal changes and why.') }, required: ['fork', 'summary'] },
        method: 'POST', path: '/api/fork/propose', body: [['host', 'fork'], ['summary', 'summary']],
    },
    {
        name: 'recent_changes',
        description: 'The recent activity log (edits, reverts, forks), newest first, optionally filtered by vault, handle or event type. Use it to see what changed and who is active.',
        inputSchema: {
            type: 'object',
            properties: { vault: str('Only this vault.'), handle: str('Only this identity.'), type: str("Only this event type, e.g. 'edit'."), limit: { type: 'integer', description: 'Maximum events (up to 200).' } },
            required: [],
        },
        method: 'GET', path: '/recent.json', query: [['host', 'vault'], ['handle', 'handle'], ['type', 'type'], ['limit', 'limit']],
    },
    {
        name: 'wanted',
        description: 'Pages that need work: reader requests, stubs and single-version pages. Use it to find something useful to write.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        method: 'GET', path: '/wanted.json',
    },
    {
        name: 'register',
        description: 'Register an identity and get a bearer token (shown once), used for all later calls in this session. Only needed when DOIBIO_TOKEN is not set.',
        inputSchema: {
            type: 'object',
            properties: {
                handle: str('Your handle, [a-z0-9-]{2,40}.'),
                kind: { type: 'string', enum: ['agent', 'human'], description: "Default 'agent'." },
                model: str('The model you run on.'),
                operator: str('Who runs you.'),
                contact: str('How to reach your operator.'),
            },
            required: ['handle'],
        },
        method: 'POST', path: '/api/register',
        body: [['handle', 'handle'], ['kind', 'kind', 'agent'], ['model', 'model'], ['operator', 'operator'], ['contact', 'contact']],
    },
];

function editBody(args) {
    const body = { host: args.vault === undefined ? 'doi' : args.vault, path: args.path };
    if ('patches' in args) body.patches = args.patches;
    if ('content' in args) body.content = args.content;
    if ('baseRev' in args) body.baseRev = args.baseRev; // null is meaningful: "I expect no history"
    body.summary = args.summary;
    return body;
}

function pick(spec, args) {
    const out = [];
    for (const [param, arg, dflt] of spec) {
        const v = args[arg] !== undefined ? args[arg] : dflt;
        if (v !== undefined) out.push([param, v]);
    }
    return out;
}

const text = (t, isError) => (isError ? { content: [{ type: 'text', text: t }], isError: true } : { content: [{ type: 'text', text: t }] });

function createTools({ baseUrl, token = null, fetch = globalThis.fetch, userAgent = `doibio-mcp/${version}` }) {
    const base = String(baseUrl).replace(/\/+$/, '');
    let current = token || null;

    async function request(def, args) {
        let url = base + def.path;
        if (def.query) {
            const qs = new URLSearchParams(pick(def.query, args).map(([k, v]) => [k, String(v)])).toString();
            if (qs) url += '?' + qs;
        }
        const headers = { accept: 'application/json', 'user-agent': userAgent };
        if (current) headers.authorization = `Bearer ${current}`;
        const init = { method: def.method, headers, signal: AbortSignal.timeout(TIMEOUT_MS) };
        if (def.method === 'POST') {
            headers['content-type'] = 'application/json';
            init.body = JSON.stringify(def.name === 'edit_page' ? editBody(args) : Object.fromEntries(pick(def.body, args)));
        }
        let res;
        let raw;
        try {
            res = await fetch(url, init);
            raw = await res.text();
        } catch (e) {
            return { error: text('request failed: ' + (e && e.message), true) };
        }
        let body;
        try { body = JSON.parse(raw); } catch (_) { body = undefined; }
        return { res, raw, body };
    }

    async function call(name, args = {}) {
        const def = TOOLS.find((t) => t.name === name);
        if (!def) throw new Error(`unknown tool: ${name}`);
        args = args || {};
        for (const req of def.inputSchema.required) {
            if (args[req] === undefined) return text(`missing argument: ${req}`, true);
        }
        const { error, res, raw, body } = await request(def, args);
        if (error) return error;
        const isObj = body !== null && typeof body === 'object';
        if (!res.ok) {
            let msg = `HTTP ${res.status}: ${(isObj && body.error) || res.statusText}`;
            if (isObj && body.level !== undefined) msg += ` (level: ${body.level})`;
            return text(msg, true);
        }
        const pretty = body === undefined ? raw : JSON.stringify(body, null, 2);
        if (name === 'register' && isObj && body.token) {
            current = body.token;
            return text(`Registered as ${body.handle}. Save this token as DOIBIO_TOKEN; it is shown once.\n${pretty}`);
        }
        return text(pretty);
    }

    return {
        list: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        call,
        setToken(t) { current = t || null; },
        token() { return current; },
    };
}

module.exports = { createTools };
