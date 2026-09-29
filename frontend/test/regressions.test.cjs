const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
function load(file, names, mocks = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
    const js = ts.transpileModule(source + '\n;globalThis.exposed={' + names.join(',') + '};', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const timers = [];
    const context = { exports: {}, console, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() { }, setInterval: () => 0, clearInterval() { }, window: { confirm: () => true, prompt: () => null }, require: id => {
            if (id === 'vue')
                return { ...vue, onMounted() { }, onUnmounted() { }, onBeforeUnmount() { }, watch() { } };
            if (id === 'vue-router')
                return { useRoute: () => ({ query: {} }), useRouter: () => ({ replace: mocks.replace ?? (() => { }) }) };
            if (id.includes('useToast'))
                return { toast: { success() { }, error() { }, warning() { }, info() { } } };
            if (id.endsWith('/api'))
                return { api: mocks.api ?? {}, ApiError: class extends Error {
                    } };
            throw Error(id);
        }, ...mocks.globals };
    vm.runInNewContext(js, context, { filename: file });
    return { ...context.exposed, timers };
}
const emptyLists = { listChannels: async () => [], listClients: async () => [], getServerGroups: async () => [], listChannelGroups: async () => [] };
test('R01 取消封禁时长框不发送封禁请求', async () => { let count = 0; const { ban } = load('features/ts3-admin/Ts3AdminPanel.vue', ['ban'], { api: { ...emptyLists, banClient: async () => count++ } }); await ban({ clid: 1, uniqueIdentifier: 'uid', nickname: 'User' }); assert.equal(count, 0); });
test('留空确认仍允许永久封禁，非取消操作', async () => { const calls = []; const { ban } = load('features/ts3-admin/Ts3AdminPanel.vue', ['ban'], { api: { ...emptyLists, banClient: async (...args) => calls.push(args) }, globals: { window: { confirm: () => true, prompt: () => '' } } }); await ban({ clid: 1, uniqueIdentifier: 'uid', nickname: 'User' }); assert.equal(calls.length, 1); assert.equal(calls[0][3], undefined); });
test('取消移动密码框不移动用户', async () => { let count = 0; const s = load('features/ts3-admin/Ts3AdminPanel.vue', ['move', 'moveSel'], { api: { ...emptyLists, moveClient: async () => count++ } }); s.moveSel.value[1] = 2; await s.move(1); assert.equal(count, 0); });
test('R11 旧成功响应不覆盖最新用户、URL、loading', async () => { const a = deferred(), b = deferred(), queries = []; let count = 0; const s = load('views/ProfileView.vue', ['nickname', 'selectedUid', 'profile', 'search', 'loading'], { api: { getUserStats: () => ++count === 1 ? a.promise : b.promise }, replace: q => queries.push(q) }); s.nickname.value = 'Alice'; const first = s.search(); s.nickname.value = 'Bob'; const second = s.search(); b.resolve({ nickname: 'Bob' }); await second; a.resolve({ nickname: 'Alice' }); await first; assert.equal(s.profile.value.nickname, 'Bob'); assert.equal(queries.length, 1); assert.equal(queries[0].query.nickname, 'Bob'); assert.equal(s.loading.value, false); });
test('R11 旧失败响应不覆盖新结果或错误提示', async () => { const a = deferred(), b = deferred(); let count = 0; const s = load('views/ProfileView.vue', ['nickname', 'profile', 'search', 'error', 'loading'], { api: { getUserStats: () => ++count === 1 ? a.promise : b.promise } }); s.nickname.value = 'Alice'; const first = s.search(); s.nickname.value = 'Bob'; const second = s.search(); b.resolve({ nickname: 'Bob' }); await second; a.reject(Error('old failure')); await first; assert.equal(s.profile.value.nickname, 'Bob'); assert.equal(s.error.value, ''); assert.equal(s.loading.value, false); });
test('先完成的旧查询不能清除新查询的加载状态', async () => { const a = deferred(), b = deferred(); let count = 0; const s = load('views/ProfileView.vue', ['nickname', 'search', 'loading'], { api: { getUserStats: () => ++count === 1 ? a.promise : b.promise } }); s.nickname.value = 'Alice'; const first = s.search(); s.nickname.value = 'Bob'; const second = s.search(); a.resolve({ nickname: 'Alice' }); await first; assert.equal(s.loading.value, true); b.resolve({ nickname: 'Bob' }); await second; assert.equal(s.loading.value, false); });
test('清空输入后旧联想响应不会重新弹出候选', async () => { const response = deferred(); const s = load('views/ProfileView.vue', ['nickname', 'onInput', 'suggestions'], { api: { suggestNicknames: () => response.promise } }); s.nickname.value = 'Al'; s.onInput(); const pending = s.timers[0](); s.nickname.value = ''; s.onInput(); response.resolve({ suggestions: [{ nickname: 'Alice', uid: 'a' }] }); await pending; assert.equal(s.suggestions.value.length, 0); });
