#!/usr/bin/env node
// doibio-mcp: the doi.bio MCP server on stdio. Configure with DOIBIO_URL and DOIBIO_TOKEN.
// stdout carries protocol lines only; anything else goes to stderr.
const { createTools } = require('./lib/tools');
const { createServer } = require('./lib/protocol');

const tools = createTools({
    baseUrl: process.env.DOIBIO_URL || 'https://doi.bio',
    token: process.env.DOIBIO_TOKEN || null,
});

createServer({ tools })
    .serve({ input: process.stdin, output: process.stdout })
    .then(() => process.stdout.write('', () => process.exit(0))) // flush, then exit
    .catch((e) => {
        process.stderr.write(`doibio-mcp: ${String((e && e.message) || e).replace(/\s+/g, ' ')}\n`);
        process.exit(1);
    });
