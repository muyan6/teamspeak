import type { RequestHandler, Router } from 'express';
import type { ApiDeps } from '../../api/router.js';
import { cleanupBotData } from '../../db/database.js';

interface SiteConfigPayload {
  title?: string;
  footerDescription?: string;
  serverName?: string;
  serverAddress?: string;
  adminName?: string;
  adminQq?: string;
  adminSteam?: string;
  excludedBotUids?: string;
  tsManagerUrl?: string;
  musicBotUrl?: string;
  webClientUrl?: string;
  steamBoxUrl?: string;
}

const MAX_ADMIN_CONTACT_LENGTH = 2_000;
const MAX_URL_LENGTH = 2_000;

function normalizeHttpUrl(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${fieldName} 必须是字符串`);
  const text = value.trim();
  if (!text) return '';
  if (text.length > MAX_URL_LENGTH) throw new Error(`${fieldName} 不能超过 ${MAX_URL_LENGTH} 个字符`);
  try {
    const url = new URL(text);
    if (url.protocol === 'http:' || url.protocol === 'https:') return text;
  } catch {
    // 统一返回字段错误
  }
  throw new Error(`${fieldName} 仅支持 HTTP 或 HTTPS 地址`);
}

function sanitizeHttpUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > MAX_URL_LENGTH) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? text : '';
  } catch {
    return '';
  }
}

function normalizeAdminContact(value: unknown): string {
  if (typeof value !== 'string') return '';
  const contact = value.trim();
  if (!contact) return '';
  if (contact.length > MAX_ADMIN_CONTACT_LENGTH) throw new Error(`管理员联系方式不能超过 ${MAX_ADMIN_CONTACT_LENGTH} 个字符`);
  if (/^[1-9]\d{4,11}$/.test(contact)) return contact;
  try {
    const url = new URL(contact);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'tencent:' || url.protocol === 'mqqwpa:') {
      return contact;
    }
  } catch {
    // 统一返回字段错误，避免泄漏运行时细节。
  }
  throw new Error('管理员联系方式仅支持 QQ 号码、HTTP(S)、tencent 或 mqqwpa 链接');
}

function sanitizeAdminContact(value: unknown): string {
  try {
    return normalizeAdminContact(value);
  } catch {
    return '';
  }
}

function loadSiteConfig(deps: ApiDeps): SiteConfigPayload {
  const info = deps.configStore.getJson<SiteConfigPayload>('siteInfo', {});
  const res: SiteConfigPayload = {
    title: info.title ?? '',
    footerDescription: info.footerDescription ?? '',
    serverName: info.serverName ?? '',
    serverAddress: info.serverAddress ?? '',
    adminName: info.adminName ?? '',
    adminSteam: sanitizeAdminContact(info.adminSteam || info.adminQq || ''),
    excludedBotUids: typeof info.excludedBotUids === 'string' ? info.excludedBotUids : '',
    tsManagerUrl: sanitizeHttpUrl(info.tsManagerUrl || deps.configStore.get('tsManagerUrl')),
    musicBotUrl: sanitizeHttpUrl(info.musicBotUrl || deps.configStore.get('musicBotUrl')),
    webClientUrl: sanitizeHttpUrl(info.webClientUrl || deps.configStore.get('webClientUrl')),
    steamBoxUrl: sanitizeHttpUrl(info.steamBoxUrl || deps.configStore.get('steamBoxUrl')),
  };
  if (info.adminQq !== undefined) {
    res.adminQq = sanitizeAdminContact(info.adminQq);
  }
  return res;
}

export function registerSiteConfigRoutes(router: Router, deps: ApiDeps, admin: RequestHandler): void {
  router.get('/site-config', (_req, res) => {
    res.json(loadSiteConfig(deps));
  });

  router.post('/site-config', admin, (req, res) => {
    const body = (req.body ?? {}) as SiteConfigPayload;
    try {
      const adminSteam = normalizeAdminContact(
        typeof body.adminSteam === 'string' ? body.adminSteam : (typeof body.adminQq === 'string' ? body.adminQq : '')
      );
      const siteInfo: SiteConfigPayload = {
        title: typeof body.title === 'string' ? body.title : '',
        footerDescription: typeof body.footerDescription === 'string' ? body.footerDescription : '',
        serverName: typeof body.serverName === 'string' ? body.serverName : '',
        serverAddress: typeof body.serverAddress === 'string' ? body.serverAddress : '',
        adminName: typeof body.adminName === 'string' ? body.adminName : '',
        adminSteam,
        excludedBotUids: typeof body.excludedBotUids === 'string' ? body.excludedBotUids.trim() : '',
      };
      if (typeof body.adminQq === 'string') {
        siteInfo.adminQq = normalizeAdminContact(body.adminQq);
      }
      if (body.tsManagerUrl !== undefined) {
        siteInfo.tsManagerUrl = normalizeHttpUrl(body.tsManagerUrl, 'TS Manager 链接') ?? '';
        deps.configStore.set('tsManagerUrl', siteInfo.tsManagerUrl);
      }
      if (body.musicBotUrl !== undefined) {
        siteInfo.musicBotUrl = normalizeHttpUrl(body.musicBotUrl, 'TSMusicBot 链接') ?? '';
        deps.configStore.set('musicBotUrl', siteInfo.musicBotUrl);
      }
      if (body.webClientUrl !== undefined) {
        siteInfo.webClientUrl = normalizeHttpUrl(body.webClientUrl, 'WebSpeak 网页端链接') ?? '';
        deps.configStore.set('webClientUrl', siteInfo.webClientUrl);
      }
      if (body.steamBoxUrl !== undefined) {
        siteInfo.steamBoxUrl = normalizeHttpUrl(body.steamBoxUrl, 'Steam 盒子链接') ?? '';
        deps.configStore.set('steamBoxUrl', siteInfo.steamBoxUrl);
      }
      deps.configStore.setJson('siteInfo', siteInfo);
      if (deps.stats?.getDatabase) {
        cleanupBotData(deps.stats.getDatabase());
      }
      res.json(loadSiteConfig(deps));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
}
