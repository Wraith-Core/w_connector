// The website half of tests/test_console_roundtrip.py: the REAL console policy of the website
// (src/features/gamePanel/consolePolicy.ts, run by the website's own tsx), fed the exact JSON this
// connector's Lua writes. One JSON request per stdin line, one JSON answer per stdout line.
//
//   in   { body: "<the JSON text WC.request sent to /ingame/console>" }
//   out  { status, error?, web?, queued?, command?, data? }
//          status 400 = what connectorConsole.ts answers invalid_args / invalid_target with
//          web    = the website answers it itself (bans, ranks, reports, logs): no Lua handler runs
//          command = the console.run command the website queues back, as the JSON text it sends
//
// Run: <website>/node_modules/.bin/tsx tests/roundtrip_bridge.mts <website root>
import readline from 'node:readline';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? '');
const policy = await import(pathToFileURL(path.join(root, 'src/features/gamePanel/consolePolicy.ts')).href);
const { z } = createRequire(path.join(root, 'package.json'))('zod');
const { CONSOLE_ACTIONS, parseConsoleAction, consoleAllowed, emptyAsObject } = policy;

// connectorConsole.ts's request body. A website that exports it (consoleRequestBody) is used as it is.
const body = policy.consoleRequestBody ?? z.object({
    consoleAction: z.string().regex(/^[a-z]+\.[A-Za-z]+$/).max(64), data: z.preprocess(emptyAsObject, z.record(z.string(), z.unknown())),
    ticket: z.string().regex(/^[0-9a-f]{32}$/), session: z.string().regex(/^[0-9a-f]{32}$/),
    targetSource: z.number().int().positive().max(65535).optional(),
    targetIdentity: z.object({ source: z.number().int().positive().max(65535), name: z.string().max(100).optional(), identifiers: z.record(z.string(), z.string()), charId: z.string().max(64).optional() }).optional(),
    subjects: z.array(z.object({ source: z.number().int().positive().max(65535), name: z.string().max(100),
        charId: z.string().max(64).optional(), discord: z.string().regex(/^discord:\d{15,21}$/).optional() })).max(1024).optional(),
});

// The panel owner: every website permission the console names.
const owner = { role: 'owner', permissions: new Set(Object.values(CONSOLE_ACTIONS).map((d: any) => d.permission)), gamePermissions: new Set<string>() };
const WEB = (name: string) => name === 'query.bans' || name === 'bans.unban' || name === 'logs.query' || name.startsWith('ranks.') || name.startsWith('reports.');

function handle(text: string) {
    let raw: any;
    try { raw = JSON.parse(text); } catch { return { status: 400, error: 'bad_json' }; }
    const request = body.safeParse(raw);
    if (!request.success) return { status: 400, error: 'invalid_args', where: 'body', issues: request.error.issues };
    if (JSON.stringify(request.data.data).length > 65536) return { status: 400, error: 'invalid_args', where: 'size' };
    const parsed = parseConsoleAction(request.data.consoleAction, request.data.data);
    if (!parsed) {
        const def = CONSOLE_ACTIONS[request.data.consoleAction];
        const why = def ? def.schema.safeParse(emptyAsObject(request.data.data)) : null;
        return { status: 400, error: 'invalid_args', where: 'schema', issues: why && !why.success ? why.error.issues : [] };
    }
    if (!consoleAllowed(owner, parsed.name)) return { status: 403, error: 'no_permission' };
    const data = parsed.data as Record<string, any>;
    const target = request.data.targetSource;
    if (parsed.name === 'player.ban' || parsed.name === 'player.warn') {
        const subject = request.data.targetIdentity;
        if (!target || subject?.source !== target || !Object.keys(subject?.identifiers ?? {}).length) return { status: 400, error: 'invalid_target' };
    }
    // what connectorConsole.ts adds before it queues the command
    if (parsed.name === 'player.warn') data.args = { ...data.args, warningId: 41, count: 2, kickAt: 3, kick: false };
    if (parsed.name === 'staff.chat') data.recipients = [];
    if (WEB(parsed.name)) return { status: 200, web: true, data };
    const command = { source: raw.source, session: request.data.session, request: request.data.ticket, name: parsed.name, data, _ingame: request.data.ticket };
    return { status: 200, queued: true, command: JSON.stringify(command),
        ...(parsed.name === 'player.ban' ? { banId: 9 } : {}), ...(parsed.name === 'player.warn' ? { warningId: 41, count: 2 } : {}) };
}

const rl = readline.createInterface({ input: process.stdin });
process.stdout.write(JSON.stringify({ ready: true, actions: Object.keys(CONSOLE_ACTIONS) }) + '\n');
rl.on('line', (line) => {
    let out;
    try { out = handle(JSON.parse(line).body); } catch (e) { out = { status: 500, error: String(e) }; }
    process.stdout.write(JSON.stringify(out) + '\n');
});
