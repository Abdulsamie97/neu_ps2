/**
 * @file debugger.test.mjs
 * @brief Prueft den VS-Code-Debug-Adapter gegen den echten Pseudo2-Worker.
 * @author Abdul
 */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const extensionRoot = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', extensionRoot), 'utf8'));
assert.ok(manifest.contributes.breakpoints.some(item => item.language === 'pseudo2'));
assert.ok(manifest.contributes.debuggers.some(item => item.type === 'pseudo2'));
assert.deepEqual(manifest.contributes.menus['editor/title'].map(item => item.command), [
    'pseudo2.inspectVariables', 'pseudo2.debug'
]);
for (const command of manifest.contributes.commands.filter(item =>
    item.command === 'pseudo2.inspectVariables' || item.command === 'pseudo2.debug'
)) {
    await access(new URL(command.icon.light, extensionRoot));
    await access(new URL(command.icon.dark, extensionRoot));
}

const compiled = await build({
    entryPoints: [fileURLToPath(new URL('src/extension/debug-session.ts', extensionRoot))],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    write: false,
    logLevel: 'silent'
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { Pseudo2DebugSession } = module.exports;

/** Erzeugt einen DAP-Testclient mit Antworten und asynchronen Ereignissen. */
function debugClient(source) {
    const program = fileURLToPath(new URL('example.pseudo2', extensionRoot));
    const session = new Pseudo2DebugSession(async requested => {
        assert.equal(requested, program);
        return source;
    });
    const messages = [];
    const waiters = [];
    let sequence = 1;
    session.onDidSendMessage(message => {
        messages.push(message);
        for (const waiter of [...waiters]) {
            if (!waiter.predicate(message)) continue;
            clearTimeout(waiter.timer);
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.resolve(message);
        }
    });
    function waitFor(predicate, after = messages.length) {
        const existing = messages.slice(after).find(predicate);
        if (existing) return Promise.resolve(existing);
        return new Promise((resolve, reject) => {
            const waiter = {
                predicate, resolve,
                timer: setTimeout(() => {
                    waiters.splice(waiters.indexOf(waiter), 1);
                    reject(new Error(`DAP timeout: ${JSON.stringify(messages.slice(-5))}`));
                }, 8_000)
            };
            waiters.push(waiter);
        });
    }
    function request(command, args = {}) {
        const seq = sequence++;
        const response = waitFor(message => message.type === 'response' && message.request_seq === seq);
        session.handleMessage({ seq, type: 'request', command, arguments: args });
        return response;
    }
    const event = (name, after = messages.length) => waitFor(message => message.type === 'event' && message.event === name, after);
    return { session, program, messages, request, event };
}

const source = `func increment(value)
  var next = value + 1
  return next
var number = 1
number = increment(number)
print number
`;
const client = debugClient(source);
try {
    const initialized = client.event('initialized');
    const initResponse = await client.request('initialize', {
        clientID: 'pseudo2-test', adapterID: 'pseudo2', pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true
    });
    assert.equal(initResponse.success, true, JSON.stringify(initResponse));
    assert.equal(initResponse.body.supportsConfigurationDoneRequest, true);
    await initialized;

    const launch = client.request('launch', { program: client.program, timeoutMs: 1000 });
    const breakpoints = await client.request('setBreakpoints', {
        source: { path: client.program }, breakpoints: [{ line: 5 }]
    });
    assert.equal(breakpoints.body.breakpoints[0].verified, true);
    const firstStop = client.event('stopped');
    await client.request('configurationDone');
    assert.equal((await launch).success, true);
    assert.equal((await firstStop).body.reason, 'entry');

    const thread = await client.request('threads');
    assert.equal(thread.body.threads.length, 1);
    const firstStack = await client.request('stackTrace', { threadId: 1 });
    assert.equal(firstStack.body.stackFrames[0].line, 4);

    const atCall = client.event('stopped');
    await client.request('next', { threadId: 1 });
    assert.equal((await atCall).body.reason, 'breakpoint');
    const globalFrame = (await client.request('stackTrace', { threadId: 1 })).body.stackFrames[0];
    assert.equal(globalFrame.line, 5);
    const globalScope = (await client.request('scopes', { frameId: globalFrame.id })).body.scopes[0];
    const globals = (await client.request('variables', { variablesReference: globalScope.variablesReference })).body.variables;
    assert.equal(globals.find(variable => variable.name === 'number').value, '1');

    const inFunction = client.event('stopped');
    await client.request('stepIn', { threadId: 1 });
    await inFunction;
    const functionStack = (await client.request('stackTrace', { threadId: 1 })).body.stackFrames;
    assert.deepEqual(functionStack.map(frame => frame.name), ['increment', 'Programm']);
    assert.equal(functionStack[0].line, 2);
    const scopes = (await client.request('scopes', { frameId: functionStack[0].id })).body.scopes;
    assert.deepEqual(scopes.map(scope => scope.name), ['Lokal', 'Global']);
    const locals = (await client.request('variables', { variablesReference: scopes[0].variablesReference })).body.variables;
    assert.equal(locals.find(variable => variable.name === 'value').value, '1');
    assert.equal((await client.request('evaluate', { frameId: functionStack[0].id, expression: 'value' })).body.result, '1');

    const afterFunction = client.event('stopped');
    await client.request('stepOut', { threadId: 1 });
    await afterFunction;
    const afterStack = (await client.request('stackTrace', { threadId: 1 })).body.stackFrames;
    assert.equal(afterStack[0].line, 6);
    const afterScopes = (await client.request('scopes', { frameId: afterStack[0].id })).body.scopes;
    const afterGlobals = (await client.request('variables', { variablesReference: afterScopes[0].variablesReference })).body.variables;
    assert.equal(afterGlobals.find(variable => variable.name === 'number').value, '2');

    const terminated = client.event('terminated');
    await client.request('continue', { threadId: 1 });
    await terminated;
    assert.equal(client.messages.filter(message => message.event === 'output').map(message => message.body.output).join(''), '2\n');
    assert.equal(client.messages.find(message => message.event === 'exited').body.exitCode, 0);
} finally {
    client.session.dispose();
}

const invalid = debugClient('print unknownName\n');
try {
    await invalid.request('initialize', { clientID: 'pseudo2-test', adapterID: 'pseudo2', pathFormat: 'path' });
    const launch = invalid.request('launch', { program: invalid.program });
    await invalid.request('configurationDone');
    const result = await launch;
    assert.equal(result.success, false);
    assert.match(result.message, /Zeile 1/);
    assert.ok(invalid.messages.some(message => message.event === 'terminated'));
} finally {
    invalid.session.dispose();
}

const endless = `var count = 0
while true
  count += 1
`;
const interruptible = debugClient(endless);
try {
    await interruptible.request('initialize', { clientID: 'pseudo2-test', adapterID: 'pseudo2', pathFormat: 'path' });
    const launch = interruptible.request('launch', { program: interruptible.program, timeoutMs: 1000 });
    const entry = interruptible.event('stopped');
    await interruptible.request('configurationDone');
    await launch;
    await entry;
    const paused = interruptible.event('stopped');
    await interruptible.request('continue', { threadId: 1 });
    await interruptible.request('pause', { threadId: 1 });
    assert.equal((await paused).body.reason, 'pause');
    await interruptible.request('setBreakpoints', {
        source: { path: interruptible.program }, breakpoints: [{ line: 3 }]
    });
    const hit = interruptible.event('stopped');
    await interruptible.request('continue', { threadId: 1 });
    assert.equal((await hit).body.reason, 'breakpoint');
    const terminated = interruptible.event('terminated');
    await interruptible.request('terminate');
    await terminated;
} finally {
    interruptible.session.dispose();
}

const timed = debugClient(endless);
try {
    await timed.request('initialize', { clientID: 'pseudo2-test', adapterID: 'pseudo2', pathFormat: 'path' });
    const launch = timed.request('launch', { program: timed.program, timeoutMs: 100 });
    const entry = timed.event('stopped');
    await timed.request('configurationDone');
    await launch;
    await entry;
    const terminated = timed.event('terminated');
    await timed.request('continue', { threadId: 1 });
    await terminated;
    assert.ok(timed.messages.some(message => message.event === 'output' && /Zeitlimit/.test(message.body.output)));
    assert.equal(timed.messages.find(message => message.event === 'exited').body.exitCode, 1);
} finally {
    timed.session.dispose();
}

const withoutDebugging = debugClient('print 42\n');
try {
    await withoutDebugging.request('initialize', { clientID: 'pseudo2-test', adapterID: 'pseudo2', pathFormat: 'path' });
    const launch = withoutDebugging.request('launch', { program: withoutDebugging.program, noDebug: true });
    const terminated = withoutDebugging.event('terminated');
    await withoutDebugging.request('configurationDone');
    await launch;
    await terminated;
    assert.equal(withoutDebugging.messages.filter(message => message.event === 'stopped').length, 0);
    assert.equal(withoutDebugging.messages.filter(message => message.event === 'output').map(message => message.body.output).join(''), '42\n');
} finally {
    withoutDebugging.session.dispose();
}

console.log('VS Code Pseudo2 debugger test passed.');
