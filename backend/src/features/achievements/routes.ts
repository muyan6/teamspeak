import type { RequestHandler, Router } from 'express';
import type { ApiDeps } from '../../api/router.js';
import { asyncRoute } from '../../api/route-utils.js';

export function registerAchievementRoutes(router: Router, deps: ApiDeps, admin: RequestHandler): void {
  router.get('/achievements/levels', admin, (_req, res) => {
    res.json(deps.achievement.listLevels());
  });

  router.get('/achievements/unlocked', admin, (_req, res) => {
    res.json(deps.achievement.getUnlockedUsers());
  });

  router.post('/achievements/levels', admin, asyncRoute(async (req, res) => {
    const { hours, serverGroupId, title } = req.body ?? {};
    const parsedHours = Number(hours);
    const parsedGroupId = Number(serverGroupId || 0);
    const normalizedTitle = String(title ?? '').trim();
    if (!Number.isFinite(parsedHours) || parsedHours < 0 || !Number.isInteger(parsedGroupId) || parsedGroupId < 0 || !normalizedTitle) {
      res.status(400).json({ error: '成就名称与非负时长必填' });
      return;
    }
    const created = deps.achievement.addLevel({
      hours: parsedHours,
      serverGroupId: parsedGroupId,
      title: normalizedTitle.slice(0, 80),
    });
    void deps.achievement.check();
    res.status(201).json(created);
  }));

  router.patch('/achievements/levels/:id', admin, asyncRoute(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const { hours, serverGroupId, title, enabled } = req.body ?? {};
    const parsedHours = Number(hours);
    const parsedGroupId = Number(serverGroupId || 0);
    const parsedEnabled = Number(enabled);
    const normalizedTitle = String(title ?? '').trim();
    if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(parsedHours) || parsedHours < 0 || !Number.isInteger(parsedGroupId) || parsedGroupId < 0 || ![0, 1].includes(parsedEnabled) || !normalizedTitle) {
      res.status(400).json({ error: '成就配置无效' });
      return;
    }
    const updated = deps.achievement.updateLevel(id, {
      hours: parsedHours,
      serverGroupId: parsedGroupId,
      title: normalizedTitle.slice(0, 80),
      enabled: parsedEnabled,
    });
    if (!updated) {
      res.status(404).json({ error: '成就等级不存在' });
      return;
    }
    void deps.achievement.check();
    res.json({ success: true });
  }));

  router.delete('/achievements/levels/:id', admin, (req, res) => {
    const removed = deps.achievement.removeLevel(Number.parseInt(req.params.id, 10));
    if (!removed) {
      res.status(404).json({ error: '成就等级不存在' });
      return;
    }
    res.json({ success: true });
  });

  /* ========== 勋章管理 (Badges) ========== */

  router.get('/achievements/badges', admin, (_req, res) => {
    res.json(deps.achievement.listBadges());
  });

  router.post('/achievements/badges', admin, asyncRoute(async (req, res) => {
    const { name, category, icon, color, description, conditionType, conditionParams, serverGroupId, enabled, sortOrder } = req.body ?? {};
    const normalizedName = String(name ?? '').trim();
    const normalizedIcon = String(icon ?? '').trim() || 'ph-medal';
    const validConditionTypes = ['total_hours', 'active_days', 'streak_days', 'night_owl', 'bond_friends', 'channel_stay', 'weekly_champion'];
    if (!normalizedName || !validConditionTypes.includes(conditionType)) {
      res.status(400).json({ error: '勋章名称与有效条件类型必填' });
      return;
    }

    const created = deps.achievement.addBadge({
      name: normalizedName,
      category: ['milestone', 'behavior', 'custom'].includes(category) ? category : 'behavior',
      icon: normalizedIcon,
      color: String(color ?? '#fbbf24').trim() || '#fbbf24',
      description: String(description ?? '').trim(),
      conditionType,
      conditionParams: conditionParams && typeof conditionParams === 'object' ? conditionParams : {},
      serverGroupId: Number(serverGroupId || 0),
      enabled: enabled === 0 ? 0 : 1,
      sortOrder: Number(sortOrder || 100),
    });

    void deps.achievement.check();
    res.status(201).json(created);
  }));

  router.patch('/achievements/badges/:id', admin, asyncRoute(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const { name, category, icon, color, description, conditionType, conditionParams, serverGroupId, enabled, sortOrder } = req.body ?? {};
    const normalizedName = String(name ?? '').trim();
    const normalizedIcon = String(icon ?? '').trim() || 'ph-medal';
    const validConditionTypes = ['total_hours', 'active_days', 'streak_days', 'night_owl', 'bond_friends', 'channel_stay', 'weekly_champion'];
    if (!Number.isInteger(id) || id <= 0 || !normalizedName || !validConditionTypes.includes(conditionType)) {
      res.status(400).json({ error: '勋章配置参数无效' });
      return;
    }

    const updated = deps.achievement.updateBadge(id, {
      name: normalizedName,
      category: ['milestone', 'behavior', 'custom'].includes(category) ? category : 'behavior',
      icon: normalizedIcon,
      color: String(color ?? '#fbbf24').trim() || '#fbbf24',
      description: String(description ?? '').trim(),
      conditionType,
      conditionParams: conditionParams && typeof conditionParams === 'object' ? conditionParams : {},
      serverGroupId: Number(serverGroupId || 0),
      enabled: enabled === 0 ? 0 : 1,
      sortOrder: Number(sortOrder || 100),
    });

    if (!updated) {
      res.status(404).json({ error: '勋章不存在' });
      return;
    }

    void deps.achievement.check();
    res.json({ success: true });
  }));

  router.delete('/achievements/badges/:id', admin, (req, res) => {
    const removed = deps.achievement.removeBadge(Number.parseInt(req.params.id, 10));
    if (!removed) {
      res.status(404).json({ error: '勋章不存在' });
      return;
    }
    res.json({ success: true });
  });

  router.post('/achievements/check', admin, asyncRoute(async (_req, res) => {
    res.json({ results: await deps.achievement.check() });
  }));
}
