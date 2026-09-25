import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Ts3ConnectionConfig } from './ts3/client.js';

const TS3_ENV_KEYS: Array<keyof Ts3ConnectionConfig> = ['host', 'queryPort', 'serverPort', 'serverId', 'username', 'password'];

const KEY_TO_ENV: Record<keyof Ts3ConnectionConfig, string> = {
  host: 'TS3_HOST',
  queryPort: 'TS3_QUERY_PORT',
  serverPort: 'TS3_SERVER_PORT',
  serverId: 'TS3_SERVER_ID',
  username: 'TS3_QUERY_USERNAME',
  password: 'TS3_QUERY_PASSWORD',
};

/**
 * 找出实际在用的 .env 路径。
 *
 * 必须与 config.ts 的查找顺序保持一致，否则从仓库根目录启动时会在根目录
 * 新建一个 .env，而 config.ts 下次又会优先读它，造成配置「漂移」到另一个文件。
 */
export function resolveEnvPath(cwd = process.cwd()): string {
  const candidates = [
    path.resolve(cwd, '.env'),
    path.resolve(cwd, 'backend/.env'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // 都不存在时，与 config.ts 一致地优先写 backend/.env（当存在 backend 目录时）。
  if (existsSync(path.resolve(cwd, 'backend'))) return path.resolve(cwd, 'backend/.env');
  return path.resolve(cwd, '.env');
}

function formatEnvValue(value: string): string {
  // 换行/回车必须转义：直接写入会破坏 .env 的行结构，导致后续 dotenv 解析异常。
  const normalized = value.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  if (/[\s#"']/.test(normalized)) return `"${normalized.replace(/"/g, '\\"')}"`;
  return normalized;
}

// 将 TS3 连接配置写回 .env 文件（保留其他配置项，仅更新 TS3 相关键）。
// .env 不存在时优先以 .env.example 为模板生成。
export function syncTs3ConfigToEnv(config: Ts3ConnectionConfig, envPath = resolveEnvPath()): void {
  const values = new Map<string, string>();
  for (const key of TS3_ENV_KEYS) {
    values.set(KEY_TO_ENV[key], key === 'serverId' ? String(config.serverId ?? 0) : String(config[key]));
  }

  let baseLines: string[] = [];
  if (existsSync(envPath)) {
    baseLines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  } else {
    // 模板可能在后端目录，也可能在仓库根目录。
    const exampleCandidates = [
      path.resolve(path.dirname(envPath), '.env.example'),
      path.resolve(path.dirname(envPath), '..', '.env.example'),
    ];
    for (const examplePath of exampleCandidates) {
      if (existsSync(examplePath)) {
        baseLines = readFileSync(examplePath, 'utf8').split(/\r?\n/);
        break;
      }
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of baseLines) {
    const m = /^([A-Z0-9_]+)\s*=/.exec(line.trimStart());
    const key = m?.[1];
    if (key && values.has(key)) {
      out.push(`${key}=${formatEnvValue(values.get(key) as string)}`);
      seen.add(key);
    } else {
      out.push(line);
    }
  }
  for (const [key, value] of values) {
    if (!seen.has(key)) out.push(`${key}=${formatEnvValue(value)}`);
  }

  // 去掉尾部空行，避免写回后累积多余换行
  while (out.length > 0 && out[out.length - 1].trim() === '') {
    out.pop();
  }

  writeFileSync(envPath, out.join('\n') + '\n');
}
