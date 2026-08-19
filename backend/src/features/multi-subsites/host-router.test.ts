import { describe, expect, it, vi } from 'vitest';
import { createHostSelectedApiRouter } from './host-router.js';

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
});
