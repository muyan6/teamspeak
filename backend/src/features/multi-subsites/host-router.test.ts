import { describe, expect, it, vi } from 'vitest';
import { createHostSelectedApiRouter, createMultiSubsitePlatformRouter, resolveRequestHost } from './host-router.js';

describe('分站 Host 路由', () => {
  const req = (host: string, extra: Record<string, unknown> = {}) => ({ headers: { host }, hostname: 'ignored.example.com', ...extra });

  it('将已启用分站请求转发至专属路由', () => {
    const subsiteRouter = vi.fn();
    const legacy = vi.fn();
    const manager = { getRouterForHost: vi.fn(() => subsiteRouter), isManagedSubsiteHost: vi.fn(() => true) };
    const handler = createHostSelectedApiRouter(legacy, manager as never);
    handler(req('alpha.example.com') as never, {} as never, vi.fn());
    expect(subsiteRouter).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('拒绝已停用和未知的托管子域名', () => {
    const legacy = vi.fn();
    const manager = { getRouterForHost: vi.fn(() => null), isManagedSubsiteHost: vi.fn(() => true) };
    const status = vi.fn(() => ({ json: vi.fn() }));
    const handler = createHostSelectedApiRouter(legacy, manager as never);
    handler(req('stopped.example.com') as never, { status } as never, vi.fn());
    expect(status).toHaveBeenCalledWith(404);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('保留总站 API 的既有处理器', () => {
    const legacy = vi.fn();
    const manager = { getRouterForHost: vi.fn(() => null), isManagedSubsiteHost: vi.fn(() => false) };
    const handler = createHostSelectedApiRouter(legacy, manager as never);
    handler(req('example.com') as never, {} as never, vi.fn());
    expect(legacy).toHaveBeenCalledOnce();
  });

  it('将未注册子域名按总站处理，避免主站别名被误判为分站', () => {
    const legacy = vi.fn();
    const manager = { getRouterForHost: vi.fn(() => null), isManagedSubsiteHost: vi.fn(() => false) };
    const handler = createHostSelectedApiRouter(legacy, manager as never);
    handler(req('www.example.com') as never, {} as never, vi.fn());
    expect(legacy).toHaveBeenCalledOnce();
  });

  it('忽略被伪造的 X-Forwarded-Host，只信任客户端实际访问的 Host', () => {
    const legacy = vi.fn();
    const subsiteRouter = vi.fn();
    const manager = {
      getRouterForHost: vi.fn((host: string) => (host === 'example.com' ? null : subsiteRouter)),
      isManagedSubsiteHost: vi.fn(() => false),
    };
    const handler = createHostSelectedApiRouter(legacy, manager as never);
    // 直连后端时攻击者可能塞入 X-Forwarded-Host 冒充分站；hostname 已按 express 语义
    // 取该头，而实现必须完全无视它，改用 headers.host。
    handler({
      headers: { host: 'example.com', 'x-forwarded-host': 'alpha.example.com' },
      hostname: 'alpha.example.com',
    } as never, {} as never, vi.fn());
    expect(manager.getRouterForHost).toHaveBeenCalledWith('example.com');
    expect(legacy).toHaveBeenCalledOnce();
    expect(subsiteRouter).not.toHaveBeenCalled();
  });

  it('兼容带端口与 IPv6 字面量的 Host 头', () => {
    const legacy = vi.fn();
    const manager = { getRouterForHost: vi.fn(() => null), isManagedSubsiteHost: vi.fn(() => false) };
    const handler = createHostSelectedApiRouter(legacy, manager as never);
    handler(req('alpha.example.com:8443') as never, {} as never, vi.fn());
    expect(manager.getRouterForHost).toHaveBeenCalledWith('alpha.example.com');

    manager.getRouterForHost.mockClear();
    handler(req('[::1]:4321') as never, {} as never, vi.fn());
    expect(manager.getRouterForHost).toHaveBeenCalledWith('[::1]');
  });

  it('不向分站暴露统一分站平台路由', async () => {
    const manager = { isManagedSubsiteHost: vi.fn(() => true) };
    const router = createMultiSubsitePlatformRouter({} as never, manager as never);
    const app = (await import('express')).default();
    app.use('/api/platform', router);
    const server = (await import('node:http')).createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('测试服务器启动失败');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/platform/settings`, { headers: { Host: 'alpha.example.com' } });
    expect(response.status).toBe(404);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('停用或未知分站域名访问健康检查返回 404', () => {
    const manager = {
      getHealthForHost: vi.fn(() => null),
      isManagedSubsiteHost: vi.fn((host: string) => host === 'stopped.example.com'),
    };
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const healthHandler = (req: { headers: { host: string } }, res: { json: (data: unknown) => void; status: (code: number) => { json: (data: unknown) => void } }) => {
      const host = resolveRequestHost(req.headers);
      const hostHealth = manager.getHealthForHost(host);
      if (hostHealth) {
        res.json(hostHealth);
        return;
      }
      if (manager.isManagedSubsiteHost(host)) {
        res.status(404).json({ error: '分站不存在或已停用' });
        return;
      }
      res.json({ ok: true, ts3Connected: true, site: 'main', platform: true });
    };

    healthHandler({ headers: { host: 'stopped.example.com' } }, { json, status });
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: '分站不存在或已停用' });

    json.mockClear();
    status.mockClear();
    healthHandler({ headers: { host: 'example.com' } }, { json, status });
    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, platform: true }));
  });
});
