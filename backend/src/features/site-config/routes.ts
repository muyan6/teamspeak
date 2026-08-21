import type { RequestHandler, Router } from 'express';
import type { ApiDeps } from '../../api/router.js';

interface SiteConfigPayload {
  title?: string;
  footerDescription?: string;
  serverName?: string;
  serverAddress?: string;
  adminName?: string;
  adminQq?: string;
  adminSteam?: string;
}

const MAX_ADMIN_CONTACT_LENGTH = 2_000;

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
      };
      if (typeof body.adminQq === 'string') {
        siteInfo.adminQq = normalizeAdminContact(body.adminQq);
      }
      deps.configStore.setJson('siteInfo', siteInfo);
      res.json(loadSiteConfig(deps));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
}
