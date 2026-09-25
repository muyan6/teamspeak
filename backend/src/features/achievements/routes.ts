import type { RequestHandler, Router } from 'express';
import type { ApiDeps } from '../../api/router.js';
import { asyncRoute } from '../../api/route-utils.js';

function parseNonNegativeInteger(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * 解析排序权重。
 * 旧实现用 `Number(sortOrder || 100)`，会把显式传入的 `0` 变成 100，
 * 导致「排到最前」这一合法诉求无法表达。
 */
function parseSortOrder(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

const MAX_TITLE_LENGTH = 80;
const VALID_CONDITION_TYPES = ['total_hours', 'active_days', 'streak_days', 'night_owl', 'bond_friends', 'channel_stay', 'weekly_champion'];

/**
 * 校验勋章/成就名称长度。
 * 旧实现用 `slice(0, 80)` 静默截断：管理员以为保存成功，实际名称被改写且没有任何提示。
 * 改为显式报错，让问题在保存时暴露。
 */
function parseTitle(value: unknown): string | null {
  const title = String(value ?? '').trim();
  if (!title || title.length > MAX_TITLE_LENGTH) return null;
  return title;
}

/**
 * 校验勋章达成阈值。
 * `evaluateBadgeForUser` 对 `conditionParams.threshold` 直接取 `Number(... || 1)`，
 * 负数或非数字会产生难以排查的判定结果，因此在写入前拦截。
 * night_owl 不使用 threshold，weekly_champion 的阈值恒为「至少 1 次」。
 */
function normalizeConditionParams(conditionType: unknown, conditionParams: unknown): Record<string, unknown> | { error: string } {
  if (conditionType === 'night_owl') return { start_hour: 2, end_hour: 5 };
  const raw = (conditionParams && typeof conditionParams === 'object' && !Array.isArray(conditionParams))
    ? conditionParams as Record<string, unknown>
    : {};
  const threshold = Number(raw.threshold ?? 1);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return { error: '达成阈值必须是大于 0 的数字' };
  }
  return { ...raw, threshold };
}

export function registerAchievementRoutes(router: Router, deps: ApiDeps, admin: RequestHandler): void {
  router.get('/achievements/levels/:id/users', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '无效的成就等级 ID' });
      return;
    }
    res.json(deps.achievement.getLevelUsers(id));
  });

  router.get('/achievements/levels', admin, (_req, res) => {
    res.json(deps.achievement.listLevels());
  });

  router.get('/achievements/unlocked', admin, (_req, res) => {
    res.json(deps.achievement.getUnlockedUsers());
  });

  router.post('/achievements/levels', admin, asyncRoute(async (req, res) => {
    const { hours, serverGroupId, title } = req.body ?? {};
    const parsedHours = Number(hours);
    const parsedGroupId = parseNonNegativeInteger(serverGroupId, 0);
    const normalizedTitle = parseTitle(title);
    // hours 必须 > 0：0 小时成就会让前端进度条按 current/0 计算，宽度变成 "NaN%"。
    if (!Number.isFinite(parsedHours) || parsedHours <= 0 || parsedGroupId === null || !normalizedTitle) {
      res.status(400).json({ error: `成就名称（1~${MAX_TITLE_LENGTH} 字符）与大于 0 的时长必填` });
      return;
    }
    const created = deps.achievement.addLevel({
      hours: parsedHours,
      serverGroupId: parsedGroupId,
      title: normalizedTitle,
    });
    void deps.achievement.check();
    res.status(201).json(created);
  }));

  router.patch('/achievements/levels/:id', admin, asyncRoute(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const { hours, serverGroupId, title, enabled } = req.body ?? {};
    const parsedHours = Number(hours);
    const parsedGroupId = parseNonNegativeInteger(serverGroupId, 0);
    const parsedEnabled = Number(enabled);
    const normalizedTitle = parseTitle(title);
    if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(parsedHours) || parsedHours <= 0 || parsedGroupId === null || ![0, 1].includes(parsedEnabled) || !normalizedTitle) {
      res.status(400).json({ error: `成就配置无效（名称需为 1~${MAX_TITLE_LENGTH} 字符）` });
      return;
    }
    const currentLevel = deps.achievement.listLevels().find((level) => level.id === id);
    if (!currentLevel) {
      res.status(404).json({ error: '成就等级不存在' });
      return;
    }
    if (
      (currentLevel.serverGroupId !== parsedGroupId || parsedEnabled === 0)
      && typeof deps.achievement.revokeLevelGrants === 'function'
      && !await deps.achievement.revokeLevelGrants(id, currentLevel.serverGroupId)
    ) {
      res.status(503).json({ error: '旧成就服务器组回收失败，请稍后重试' });
      return;
    }

    const updated = deps.achievement.updateLevel(id, {
      hours: parsedHours,
      serverGroupId: parsedGroupId,
      title: normalizedTitle,
      enabled: parsedEnabled,
    });
    if (!updated) {
      res.status(404).json({ error: '成就等级不存在' });
      return;
    }
    void deps.achievement.check();
    res.json({ success: true });
  }));

  router.delete('/achievements/levels/:id', admin, asyncRoute(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const removed = typeof deps.achievement.removeLevelAndRevoke === 'function'
      ? await deps.achievement.removeLevelAndRevoke(id)
      : deps.achievement.removeLevel(id);
    if (!removed) {
      if (typeof deps.achievement.listLevels === 'function' && deps.achievement.listLevels().some((level) => level.id === id)) {
        res.status(503).json({ error: '旧成就服务器组回收失败，请稍后重试' });
        return;
      }
      res.status(404).json({ error: '成就等级不存在' });
      return;
    }
    res.json({ success: true });
  }));

  /* ========== 勋章管理 (Badges) ========== */

  router.get('/achievements/badges', admin, (_req, res) => {
    res.json(deps.achievement.listBadges());
  });

  router.post('/achievements/badges', admin, asyncRoute(async (req, res) => {
    const { name, category, icon, color, description, conditionType, conditionParams, serverGroupId, enabled, sortOrder } = req.body ?? {};
    const normalizedName = parseTitle(name);
    const normalizedIcon = String(icon ?? '').trim() || 'ph-medal';
    if (!normalizedName || !VALID_CONDITION_TYPES.includes(conditionType)) {
      res.status(400).json({ error: `勋章名称（1~${MAX_TITLE_LENGTH} 字符）与有效条件类型必填` });
      return;
    }
    const parsedParams = normalizeConditionParams(conditionType, conditionParams);
    if ('error' in parsedParams) {
      res.status(400).json({ error: parsedParams.error });
      return;
    }
    const parsedGroupId = parseNonNegativeInteger(serverGroupId, 0);
    if (parsedGroupId === null) {
      res.status(400).json({ error: '勋章服务器组 ID 无效' });
      return;
    }

    const created = deps.achievement.addBadge({
      name: normalizedName,
      category: ['milestone', 'behavior', 'custom'].includes(category) ? category : 'behavior',
      icon: normalizedIcon,
      color: String(color ?? '#fbbf24').trim() || '#fbbf24',
      description: String(description ?? '').trim(),
      conditionType,
      conditionParams: parsedParams,
      serverGroupId: parsedGroupId,
      enabled: Number(enabled) === 0 ? 0 : 1,
      // 注意不要用 `sortOrder || 100`：显式传入 0（想排最前）会被替换成 100。
      sortOrder: parseSortOrder(sortOrder, 100),
    });

    void deps.achievement.check();
    res.status(201).json(created);
  }));

  router.patch('/achievements/badges/:id', admin, asyncRoute(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const { name, category, icon, color, description, conditionType, conditionParams, serverGroupId, enabled, sortOrder } = req.body ?? {};
    const normalizedName = parseTitle(name);
    const normalizedIcon = String(icon ?? '').trim() || 'ph-medal';
    if (!Number.isInteger(id) || id <= 0 || !normalizedName || !VALID_CONDITION_TYPES.includes(conditionType)) {
      res.status(400).json({ error: `勋章配置参数无效（名称需为 1~${MAX_TITLE_LENGTH} 字符）` });
      return;
    }
    const parsedParams = normalizeConditionParams(conditionType, conditionParams);
    if ('error' in parsedParams) {
      res.status(400).json({ error: parsedParams.error });
      return;
    }

    const currentBadge = deps.achievement.listBadges().find((b) => b.id === id);
    if (!currentBadge) {
      res.status(404).json({ error: '勋章不存在' });
      return;
    }

    const parsedGroupId = parseNonNegativeInteger(serverGroupId, currentBadge.serverGroupId);
    if (parsedGroupId === null) {
      res.status(400).json({ error: '勋章服务器组 ID 无效' });
      return;
    }
    const resolvedEnabled = enabled !== undefined ? (Number(enabled) === 0 ? 0 : 1) : currentBadge.enabled;

    if (
      (currentBadge.serverGroupId !== parsedGroupId || resolvedEnabled === 0)
      && typeof deps.achievement.revokeBadgeGrants === 'function'
      && !await deps.achievement.revokeBadgeGrants(id, currentBadge.serverGroupId)
    ) {
      res.status(503).json({ error: '旧勋章服务器组回收失败，请稍后重试' });
      return;
    }

    const updated = deps.achievement.updateBadge(id, {
      name: normalizedName,
      category: ['milestone', 'behavior', 'custom'].includes(category) ? category : (currentBadge.category || 'behavior'),
      icon: normalizedIcon,
      color: String(color ?? currentBadge.color ?? '#fbbf24').trim() || '#fbbf24',
      description: description !== undefined ? String(description).trim() : currentBadge.description,
      conditionType,
      conditionParams: parsedParams,
      serverGroupId: parsedGroupId,
      enabled: resolvedEnabled,
      sortOrder: sortOrder !== undefined ? parseSortOrder(sortOrder, currentBadge.sortOrder) : currentBadge.sortOrder,
    });

    if (!updated) {
      res.status(404).json({ error: '勋章不存在' });
      return;
    }

    void deps.achievement.check();
    res.json({ success: true });
  }));

  router.delete('/achievements/badges/:id', admin, asyncRoute(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const removed = typeof deps.achievement.removeBadgeAndRevoke === 'function'
      ? await deps.achievement.removeBadgeAndRevoke(id)
      : deps.achievement.removeBadge(id);
    if (!removed) {
      if (typeof deps.achievement.listBadges === 'function' && deps.achievement.listBadges().some((badge) => badge.id === id)) {
        res.status(503).json({ error: '旧勋章服务器组回收失败，请稍后重试' });
        return;
      }
      res.status(404).json({ error: '勋章不存在' });
      return;
    }
    res.json({ success: true });
  }));

  router.post('/achievements/check', admin, asyncRoute(async (_req, res) => {
    res.json({ results: await deps.achievement.check() });
  }));
}
