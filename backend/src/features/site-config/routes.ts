import type { RequestHandler, Router } from 'express';
import type { ApiDeps } from '../../api/router.js';

interface SiteConfigPayload {
  guide?: string;
  clientDownload?: {
    version?: string;
    officialUrl?: string;
    mirrorUrl?: string;
    translationUrl?: string;
  };
}

function loadSiteConfig(deps: ApiDeps): SiteConfigPayload {
  return {
    guide: deps.configStore.get('guide') ?? '',
    clientDownload: deps.configStore.getJson('clientDownload', {}),
  };
}

export function registerSiteConfigRoutes(router: Router, deps: ApiDeps, admin: RequestHandler): void {
  router.get('/site-config', (_req, res) => {
    res.json(loadSiteConfig(deps));
  });

  router.post('/site-config', admin, (req, res) => {
    const body = (req.body ?? {}) as SiteConfigPayload;
    if (body.guide !== undefined) deps.configStore.set('guide', String(body.guide));
    if (body.clientDownload !== undefined) deps.configStore.setJson('clientDownload', body.clientDownload);
    res.json(loadSiteConfig(deps));
  });
}
