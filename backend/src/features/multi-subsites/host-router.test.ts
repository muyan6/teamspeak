import { describe, expect, it, vi } from 'vitest';
import { createHostSelectedApiRouter, createMultiSubsitePlatformRouter } from './host-router.js';

describe('分站 Host 路由', () => {
  it('将已启用分站请求转发至专属路由', () => {
    const subsiteRouter = vi.fn();
    const legacy = vi.fn();
    const manager = { getRouterForHost: vi.fn(() => subsiteRouter), isManagedSubsiteHost: vi.fn(() => true) };
    const handler = createHostSelectedApiRouter(legacy, manager as never);
    handler({ hostname: 'alpha.example.com' } as never, {} as never, vi.fn());
    expect(subsiteRouter).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('拒绝已停用和未知的托管子域名', () => {
    const legacy = vi.fn();
    const manager = { getRouterForHost: vi.fn(() => null), isManagedSubsiteHost: vi.fn(() => true) };
    const status = vi.fn(() => ({ json: vi.fn() }));
    const handler = createHostSelectedApiRouter(legacy, manager as never);
    handler({ hostname: 'stopped.example.com' } as never, { status } as never, vi.fn());
    expect(status).toHaveBeenCalledWith(404);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('保留总站 API 的既有处理器', () => {
    const legacy = vi.fn();
    const manager = { getRouterForHost: vi.fn(() => null), isManagedSubsiteHost: vi.fn(() => false) };
    const handler = createHostSelectedApiRouter(legacy, manager as never);
    handler({ hostname: 'example.com' } as never, {} as never, vi.fn());
    expect(legacy).toHaveBeenCalledOnce();
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
});
