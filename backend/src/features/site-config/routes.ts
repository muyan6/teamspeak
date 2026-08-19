import type { RequestHandler, Router } from 'express';
import type { ApiDeps } from '../../api/router.js';

interface SiteConfigPayload {
  title?: string;
  footerDescription?: string;
  serverName?: string;
  serverAddress?: string;
  adminName?: string;
  adminSteam?: string;
}

function loadSiteConfig(deps: ApiDeps): SiteConfigPayload {
  return deps.configStore.getJson<SiteConfigPayload>('siteInfo', {});
}

export function registerSiteConfigRoutes(router: Router, deps: ApiDeps, admin: RequestHandler): void {
  router.get('/site-config', (_req, res) => {
    res.json(loadSiteConfig(deps));
  });

  router.post('/site-config', admin, (req, res) => {
    const body = (req.body ?? {}) as SiteConfigPayload;
    deps.configStore.setJson('siteInfo', {
      title: typeof body.title === 'string' ? body.title : '',
      footerDescription: typeof body.footerDescription === 'string' ? body.footerDescription : '',
      serverName: typeof body.serverName === 'string' ? body.serverName : '',
      serverAddress: typeof body.serverAddress === 'string' ? body.serverAddress : '',
      adminName: typeof body.adminName === 'string' ? body.adminName : '',
      adminSteam: typeof body.adminSteam === 'string' ? body.adminSteam : '',
    });
    res.json(loadSiteConfig(deps));
  });
}
