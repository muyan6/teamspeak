import { describe, expect, it } from 'vitest';
import { SubsiteManagementService, validateSubsiteConfig } from './service.js';

describe('分站管理', () => {
  it('校验并规范化分站标识和域名', () => {
    expect(validateSubsiteConfig({ slug: ' Server-A ', domain: 'A.Example.com, b.example.com ' })).toEqual({
      slug: 'server-a',
      domain: 'a.example.com,b.example.com',
    });
  });

  it('拒绝会破坏域名绑定或环境变量语义的值', () => {
    expect(() => validateSubsiteConfig({ slug: 'server_a', domain: 'https://a.example.com' })).toThrow();
    expect(() => validateSubsiteConfig({ slug: 'server-a', domain: 'a.example.com/path' })).toThrow();
  });

  it('保存后立即更新运行时配置并同步环境变量', () => {
    const config = { site: { slug: 'default', domain: '' } };
    const writes: Array<{ slug: string; domain: string }> = [];
    const service = new SubsiteManagementService(config, (value) => writes.push(value));

    expect(service.saveConfig({ slug: 'server-a', domain: 'a.example.com' })).toEqual({
      slug: 'server-a',
      domain: 'a.example.com',
    });
    expect(config.site).toMatchObject({ slug: 'server-a', domain: 'a.example.com' });
    expect(writes).toEqual([{ slug: 'server-a', domain: 'a.example.com' }]);
  });
});
