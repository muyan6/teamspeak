import type { RequestHandler, Router } from 'express';
import type { MultiSubsiteRuntimeManager } from './runtime.js';

export function registerMultiSubsiteRoutes(router: Router, manager: MultiSubsiteRuntimeManager, admin: RequestHandler): void {
  router.get('/settings', admin, (_req, res) => {
    res.json(manager.getSettings());
  });

  router.post('/settings', admin, (req, res) => {
    try {
      res.json(manager.saveBaseDomain(req.body?.baseDomain));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  router.get('/subsites', admin, (_req, res) => {
    res.json({ subsites: manager.list().map(({ password: _password, adminPassword: _adminPassword, ...subsite }) => subsite) });
  });

  router.post('/subsites', admin, (req, res) => {
    try {
      const subsite = manager.create(req.body ?? {});
      const { password: _password, adminPassword: _adminPassword, ...safe } = subsite;
      res.status(201).json({ ...safe, connected: false, url: `http://${subsite.domain}` });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  router.post('/subsites/:id/enabled', admin, (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) throw new Error('分站 ID 无效');
      const subsite = manager.setEnabled(id, Boolean(req.body?.enabled));
      const { password: _password, adminPassword: _adminPassword, ...safe } = subsite;
      res.json({ ...safe, connected: false, url: `http://${subsite.domain}` });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  router.put('/subsites/:id', admin, (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) throw new Error('分站 ID 无效');
      const subsite = manager.update(id, req.body ?? {});
      const { password: _password, adminPassword: _adminPassword, ...safe } = subsite;
      res.json({ ...safe, connected: false, url: `http://${subsite.domain}` });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  router.post('/subsites/:id/reset-password', admin, (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) throw new Error('分站 ID 无效');
      manager.resetAdminPassword(id, req.body?.adminPassword);
      res.json({ success: true, message: '分站后台密码重置成功' });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  router.delete('/subsites/:id', admin, (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) throw new Error('分站 ID 无效');
      const purge = Boolean(req.query.purge === 'true' || req.body?.purgeDatabase);
      const subsite = manager.delete(id, purge);
      res.json({ success: true, slug: subsite.slug, domain: subsite.domain });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
}
