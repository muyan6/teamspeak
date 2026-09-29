const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
function apiFixture(fetch) { const store = new Map(), timers = []; const exports = {}; const ctx = { exports, require: id => id === 'vue' ? vue : {}, AbortController, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() { }, localStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }, fetch }; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/api.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, ctx); return { ...exports, timers, store }; }
const onAbort = signal => new Promise((_r, j) => { if (signal.aborted)
    j(Error('abort'));
else
    signal.addEventListener('abort', () => j(Error('abort'))); });
test('请求无响应会被截止时间终止，不让仪表盘刷新永久挂起', async () => { const s = apiFixture((_u, o) => onAbort(o.signal)); const response = s.api.getData(); s.timers[0](); await assert.rejects(response, /超时/); });
test('请求超时同时覆盖未完成的JSON响应体', async () => { const s = apiFixture(async (_u, o) => ({ ok: true, json: () => onAbort(o.signal) })); const response = s.api.getData(); await new Promise(r => setImmediate(r)); s.timers[0](); await assert.rejects(response, /超时/); });
test('旧令牌的401响应不清除随后登录取得的新令牌', async () => { let failOld; const s = apiFixture(async (url) => { if (url.endsWith('/auth/login'))
    return { ok: true, json: async () => ({ token: 'new-token' }) }; return new Promise(r => failOld = r); }); const old = s.api.getData(); await s.api.login('test'); failOld({ ok: false, status: 401, json: async () => ({ error: 'expired old token' }) }); await assert.rejects(old, /expired old token/); assert.equal(s.store.get('admin_token'), 'new-token'); assert.equal(s.api.isAuthed(), true); });
