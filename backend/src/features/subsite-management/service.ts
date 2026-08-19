import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../../config.js';

export interface SubsiteConfig {
  slug: string;
  domain: string;
}

export interface SubsiteConfigInput {
  slug?: unknown;
  domain?: unknown;
}

export type EnvWriter = (config: SubsiteConfig) => void;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function formatEnvValue(value: string): string {
  if (/[^a-zA-Z0-9._-]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}

function normalizeDomain(value: unknown): string {
  return String(value ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
    .join(',');
}

function isValidDomain(host: string): boolean {
  if (host.length > 253 || host.includes('://') || host.includes('/') || host.includes(' ')) return false;
  if (host === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
}

export function validateSubsiteConfig(input: SubsiteConfigInput): SubsiteConfig {
  const slug = String(input.slug ?? '').trim().toLowerCase();
  const domain = normalizeDomain(input.domain);
  if (!SLUG_PATTERN.test(slug) || slug.length > 64) {
    throw new Error('分站标识只能使用小写字母、数字和连字符，且不能以连字符开头或结尾');
  }
  if (domain && domain.split(',').some((host) => !isValidDomain(host))) {
    throw new Error('允许访问域名格式无效，请填写域名或 IP，多个值用逗号分隔');
  }
  return { slug, domain };
}

export function syncSubsiteConfigToEnv(config: SubsiteConfig, envPath = path.resolve(process.cwd(), '.env')): void {
  const values = new Map([
    ['SITE_SLUG', config.slug],
    ['SITE_DOMAIN', config.domain],
  ]);
  let baseLines: string[] = [];
  if (existsSync(envPath)) {
    baseLines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  }
  const seen = new Set<string>();
  const out = baseLines.map((line) => {
    const key = /^\s*([A-Z0-9_]+)\s*=/.exec(line)?.[1];
    if (!key || !values.has(key)) return line;
    seen.add(key);
    return `${key}=${formatEnvValue(values.get(key) as string)}`;
  });
  for (const [key, value] of values) {
    if (!seen.has(key)) out.push(`${key}=${formatEnvValue(value)}`);
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  writeFileSync(envPath, `${out.join('\n')}\n`);
}

export class SubsiteManagementService {
  constructor(
    private readonly config: Pick<AppConfig, 'site'>,
    private readonly envWriter: EnvWriter = (value) => syncSubsiteConfigToEnv(value)
  ) {}

  getConfig(): SubsiteConfig {
    return { slug: this.config.site.slug, domain: this.config.site.domain };
  }

  saveConfig(input: SubsiteConfigInput): SubsiteConfig {
    const next = validateSubsiteConfig(input);
    this.config.site.slug = next.slug;
    this.config.site.domain = next.domain;
    this.envWriter(next);
    return this.getConfig();
  }
}
