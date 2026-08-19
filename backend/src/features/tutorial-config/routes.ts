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

function loadTutorialConfig(deps: ApiDeps): TutorialConfigPayload {
  const tutorial = deps.configStore.getJson<NonNullable<TutorialConfigPayload['tutorial']>>('tutorial', {});
  const legacyGuide = deps.configStore.get('guide');
  return {
    tutorial: {
      ...tutorial,
      ...(legacyGuide && !tutorial.download ? { download: legacyGuide } : {}),
    },
    clientDownload: deps.configStore.getJson('clientDownload', {}),
  };
}

export function registerTutorialConfigRoutes(router: Router, deps: ApiDeps, admin: RequestHandler): void {
  router.get('/tutorial-config', (_req, res) => {
    res.json(loadTutorialConfig(deps));
  });

  router.post('/tutorial-config', admin, (req, res) => {
    const body = (req.body ?? {}) as TutorialConfigPayload;
    if (body.tutorial !== undefined) deps.configStore.setJson('tutorial', body.tutorial);
    if (body.clientDownload !== undefined) deps.configStore.setJson('clientDownload', body.clientDownload);
    res.json(loadTutorialConfig(deps));
  });
}
