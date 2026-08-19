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
    officialUrl: normalizeText(download.officialUrl, MAX_DOWNLOAD_VALUE_LENGTH, '官方下载地址'),
    mirrorUrl: normalizeText(download.mirrorUrl, MAX_DOWNLOAD_VALUE_LENGTH, '镜像下载地址'),
    translationUrl: normalizeText(download.translationUrl, MAX_DOWNLOAD_VALUE_LENGTH, '汉化下载地址'),
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
    clientDownload: normalizeClientDownload(deps.configStore.getJson<unknown>('clientDownload', {})),
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
