import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true }); });
function fixture() {
    const dir = mkdtempSync(path.join(tmpdir(), 'ts3-update-'));
    dirs.push(dir);
    for (const p of ['.git', 'backend/node_modules', 'frontend/node_modules', 'backend/dist', 'frontend/dist', 'mock-bin'])
        mkdirSync(path.join(dir, p), { recursive: true });
    copyFileSync(path.resolve('../update.sh'), path.join(dir, 'update.sh'));
    writeFileSync(path.join(dir, 'backend/dist/index.js'), 'old');
    writeFileSync(path.join(dir, 'frontend/dist/index.html'), 'old');
    writeFileSync(path.join(dir, 'head'), 'old\n');
    const scripts = { git: `#!/usr/bin/env bash
case "$1" in
 status|fetch) exit 0;;
 rev-parse) case "$2" in --git-dir) echo .git;; --git-path) echo ".git/$3";; *) cat head;; esac;;
 cat-file) exit 0;;
 pull) echo new > head;;
 diff) echo backend/src/changed.ts;;
 *) exit 2;;
esac
`, npm: `#!/usr/bin/env bash
echo "$*" >> ../npm-calls
if [[ -f ../fail-build ]]; then echo SIMULATED_BUILD_FAILURE >&2; exit 1; fi
echo SIMULATED_BUILD_SUCCESS
`, pm2: `#!/usr/bin/env bash
if [[ "$1" == restart ]]; then echo restart >> pm2-calls; [[ ! -f fail-restart ]] || exit 1; fi
exit 0
` };
    for (const [name, body] of Object.entries(scripts)) {
        writeFileSync(path.join(dir, 'mock-bin', name), body);
        chmodSync(path.join(dir, 'mock-bin', name), 0o755);
    }
    const posixDir = dir.replaceAll('\\', '/').replace(/^([A-Z]):/i, (_m, drive: string) => '/' + drive.toLowerCase());
    const run = () => spawnSync(bash, ['-c', 'export PATH="$1/mock-bin:/usr/bin:$PATH"; exec bash "$1/update.sh"', '--', posixDir], { cwd: dir, env: process.env, encoding: 'utf8' });
    return { dir, run };
}
describe('R14 更新脚本回归', () => {
    it.skipIf(process.platform !== 'win32')('Windows构建失败立即退出，不继续前端或重启', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'ts3-batch-'));
        dirs.push(dir);
        for (const p of ['backend', 'frontend', 'mock-bin'])
            mkdirSync(path.join(dir, p), { recursive: true });
        copyFileSync(path.resolve('../update.bat'), path.join(dir, 'update.bat'));
        writeFileSync(path.join(dir, 'mock-bin/npm.cmd'), '@echo off\r\necho %* >> "%~dp0calls.txt"\r\nif "%1 %2"=="run build" exit /b 1\r\nexit /b 0\r\n');
        const result = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', path.join(dir, 'update.bat')], { cwd: dir, env: { ...process.env, PATH: path.join(dir, 'mock-bin') + ';' + process.env.PATH }, encoding: 'utf8' });
        if (!existsSync(path.join(dir, 'mock-bin/calls.txt')))
            throw new Error(result.stdout + '\n' + result.stderr);
        expect(result.status).toBe(1);
        expect(readFileSync(path.join(dir, 'mock-bin/calls.txt'), 'utf8').trim().split(/\r?\n/).map(s => s.trim())).toEqual(['install', 'run build']);
    });
    it.skipIf(!existsSync(bash))('构建失败后默认重跑重新构建，成功后才推进部署版本', () => { const { dir, run } = fixture(); writeFileSync(path.join(dir, 'fail-build'), '1'); const first = run(); expect(first.status).toBe(1); expect(readFileSync(path.join(dir, '.git/ts3-monitor-last-deployed'), 'utf8').trim()).toBe('old'); rmSync(path.join(dir, 'fail-build')); const second = run(); expect(second.status).toBe(0); expect(readFileSync(path.join(dir, 'npm-calls'), 'utf8').trim().split('\n')).toHaveLength(2); expect(readFileSync(path.join(dir, '.git/ts3-monitor-last-deployed'), 'utf8').trim()).toBe('new'); const third = run(); expect(third.status).toBe(0); expect(third.stdout).toContain('No build or restart'); expect(readFileSync(path.join(dir, 'npm-calls'), 'utf8').trim().split('\n')).toHaveLength(2); });
    it.skipIf(!existsSync(bash))('重启失败也保留待部署版本，下一轮重试重启', () => { const { dir, run } = fixture(); writeFileSync(path.join(dir, 'fail-restart'), '1'); expect(run().status).toBe(1); expect(readFileSync(path.join(dir, '.git/ts3-monitor-last-deployed'), 'utf8').trim()).toBe('old'); rmSync(path.join(dir, 'fail-restart')); expect(run().status).toBe(0); expect(readFileSync(path.join(dir, 'pm2-calls'), 'utf8').trim().split('\n')).toHaveLength(2); });
});
