import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../db/database.js';
import { MultiSubsiteRegistry } from './service.js';

describe('统一分站注册表', () => {
  it('创建分站时自动生成子域名并隔离敏感密码字段', () => {
    const db = openDatabase(':memory:');
    const registry = new MultiSubsiteRegistry(db, 'example.com');
    const created = registry.create({ displayName: 'Alpha 语音', slug: 'alpha', ts3Host: '127.0.0.1', adminPassword: 'password-123' });
    expect(created.domain).toBe('alpha.example.com');
    expect(created.queryPort).toBe(10011);
    expect(registry.getByHost('ALPHA.EXAMPLE.COM')?.id).toBe(created.id);
    db.close();
  });

  it('拒绝重复域名与不安全的后台密码', () => {
    const db = openDatabase(':memory:');
    const registry = new MultiSubsiteRegistry(db, 'example.com');
    const common = { displayName: 'Alpha', slug: 'alpha', ts3Host: '127.0.0.1', adminPassword: 'password-123' };
    registry.create(common);
    expect(() => registry.create({ ...common, slug: 'beta', domain: 'alpha.example.com' })).toThrow('已被占用');
    expect(() => registry.create({ ...common, slug: 'gamma', adminPassword: 'short' })).toThrow('至少需要 8 个字符');
    db.close();
  });

  it('保存根域名后可生成新分站，并将已停用分站识别为托管域名', () => {
    const db = openDatabase(':memory:');
    const registry = new MultiSubsiteRegistry(db, '');
    expect(() => registry.create({ displayName: 'Alpha', slug: 'alpha', ts3Host: '127.0.0.1', adminPassword: 'password-123' })).toThrow('请先在统一分站后台保存根域名');
    expect(registry.saveBaseDomain('Example.COM.')).toEqual({ baseDomain: 'example.com' });
    const created = registry.create({ displayName: 'Alpha', slug: 'alpha', ts3Host: '127.0.0.1', adminPassword: 'password-123' });
    registry.setEnabled(created.id, false);
    expect(registry.getByHost('alpha.example.com')).toBeNull();
    expect(registry.hasHost('alpha.example.com')).toBe(true);
    db.close();
  });

  it('根域名配置会持久化到总站数据库', () => {
    const db = openDatabase(':memory:');
    new MultiSubsiteRegistry(db, '').saveBaseDomain('voice.example.com');
    expect(new MultiSubsiteRegistry(db, 'other.example.com').getSettings()).toEqual({ baseDomain: 'voice.example.com' });
    db.close();
  });
});
