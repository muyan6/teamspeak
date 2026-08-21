import type { RequestHandler, Router } from 'express';
import type { ApiDeps } from '../../api/router.js';

interface TutorialConfigPayload {
  tutorial?: {
    download?: string;
    basic?: string;
    advanced?: string;
  };
  clientDownload?: {
    version?: string;
    officialUrl?: string;
    mirrorUrl?: string;
    translationUrl?: string;
  };
}

const MAX_TUTORIAL_CONTENT_LENGTH = 100_000;
const MAX_DOWNLOAD_VALUE_LENGTH = 2_000;

function normalizeText(value: unknown, maxLength: number, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${fieldName} 必须是字符串`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${fieldName} 不能超过 ${maxLength} 个字符`);
  return text;
}

function normalizeHttpUrl(value: unknown, fieldName: string): string | undefined {
  const text = normalizeText(value, MAX_DOWNLOAD_VALUE_LENGTH, fieldName);
  if (!text) return text;
  try {
    const url = new URL(text);
    if (url.protocol === 'http:' || url.protocol === 'https:') return text;
  } catch {
    // 统一返回字段错误，避免泄漏运行时细节。
  }
  throw new Error(`${fieldName} 仅支持 HTTP 或 HTTPS 地址`);
}

function sanitizeHttpUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > MAX_DOWNLOAD_VALUE_LENGTH) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? text : '';
  } catch {
    return '';
  }
}

function normalizeTutorial(value: unknown): NonNullable<TutorialConfigPayload['tutorial']> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('tutorial 必须是对象');
  const tutorial = value as Record<string, unknown>;
  return {
    download: normalizeText(tutorial.download, MAX_TUTORIAL_CONTENT_LENGTH, '下载教程'),
    basic: normalizeText(tutorial.basic, MAX_TUTORIAL_CONTENT_LENGTH, '基础教程'),
    advanced: normalizeText(tutorial.advanced, MAX_TUTORIAL_CONTENT_LENGTH, '进阶教程'),
  };
}

function normalizeClientDownload(value: unknown): NonNullable<TutorialConfigPayload['clientDownload']> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('clientDownload 必须是对象');
  const download = value as Record<string, unknown>;
  return {
    version: normalizeText(download.version, MAX_DOWNLOAD_VALUE_LENGTH, '客户端版本'),
    officialUrl: normalizeHttpUrl(download.officialUrl, '官方下载地址'),
    mirrorUrl: normalizeHttpUrl(download.mirrorUrl, '镜像下载地址'),
    translationUrl: normalizeHttpUrl(download.translationUrl, '汉化下载地址'),
  };
}

function sanitizeClientDownload(value: unknown): NonNullable<TutorialConfigPayload['clientDownload']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const download = value as Record<string, unknown>;
  return {
    version: typeof download.version === 'string' ? download.version.trim().slice(0, MAX_DOWNLOAD_VALUE_LENGTH) : '',
    officialUrl: sanitizeHttpUrl(download.officialUrl),
    mirrorUrl: sanitizeHttpUrl(download.mirrorUrl),
    translationUrl: sanitizeHttpUrl(download.translationUrl),
  };
}

function loadTutorialConfig(deps: ApiDeps): TutorialConfigPayload {
  const tutorial = normalizeTutorial(deps.configStore.getJson<unknown>('tutorial', {}));
  const legacyGuide = deps.configStore.get('guide');
  return {
    tutorial: {
      ...tutorial,
      ...(legacyGuide && !tutorial.download ? { download: legacyGuide } : {}),
    },
    clientDownload: sanitizeClientDownload(deps.configStore.getJson<unknown>('clientDownload', {})),
  };
}

export function registerTutorialConfigRoutes(router: Router, deps: ApiDeps, admin: RequestHandler): void {
  router.get('/tutorial-config', (_req, res) => {
    res.json(loadTutorialConfig(deps));
  });

  router.post('/tutorial-config', admin, (req, res) => {
    const body = (req.body ?? {}) as TutorialConfigPayload;
    try {
      if (body.tutorial !== undefined) deps.configStore.setJson('tutorial', normalizeTutorial(body.tutorial));
      if (body.clientDownload !== undefined) deps.configStore.setJson('clientDownload', normalizeClientDownload(body.clientDownload));
      res.json(loadTutorialConfig(deps));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
}
