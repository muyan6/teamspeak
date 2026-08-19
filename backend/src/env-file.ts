import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Ts3ConnectionConfig } from './ts3/client.js';

const TS3_ENV_KEYS: Array<keyof Ts3ConnectionConfig> = ['host', 'queryPort', 'serverPort', 'username', 'password'];

const KEY_TO_ENV: Record<keyof Ts3ConnectionConfig, string> = {
  host: 'TS3_HOST',
  queryPort: 'TS3_QUERY_PORT',
  serverPort: 'TS3_SERVER_PORT',
  username: 'TS3_QUERY_USERNAME',
  password: 'TS3_QUERY_PASSWORD',
};

function formatEnvValue(v: string): string {
  if (/[\s#"']/.test(v)) return `"${v.replace(/"/g, '\\"')}"`;
  return v;
}

// 将 TS3 连接配置写回 .env 文件（保留其他配置项，仅更新 TS3 相关键）。
// .env 不存在时优先以 .env.example 为模板生成。
export function syncTs3ConfigToEnv(config: Ts3ConnectionConfig, envPath = path.resolve(process.cwd(), '.env')): void {
  const values = new Map<string, string>();
  for (const key of TS3_ENV_KEYS) {
    values.set(KEY_TO_ENV[key], String(config[key]));
  }

  let baseLines: string[] = [];
  if (existsSync(envPath)) {
    baseLines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  } else {
    const examplePath = path.resolve(path.dirname(envPath), '.env.example');
    if (existsSync(examplePath)) {
      baseLines = readFileSync(examplePath, 'utf8').split(/\r?\n/);
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
