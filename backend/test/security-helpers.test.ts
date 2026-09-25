import { describe, expect, it } from 'vitest';
import { parseTrustProxy } from '../src/config.js';
import { normalizeHost, resolveRequestHost } from '../src/net/host.js';
import { isValidHost } from '../src/features/ts3-admin/routes.js';
import { normalizeVersionLabel } from '../src/site.js';

describe('反向代理信任级别解析', () => {
  it('默认只信任本机代理（loopback），不再默认信任任意上游', () => {
    expect(parseTrustProxy(undefined)).toBe('loopback');
    expect(parseTrustProxy('')).toBe('loopback');
    expect(parseTrustProxy('   ')).toBe('loopback');
  });

  it('支持显式的 true / false / 跳数与具体地址', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('127.0.0.1')).toBe('127.0.0.1');
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
  });
});

describe('请求主机名解析', () => {
  it('只使用 Host 头，忽略可被伪造的 X-Forwarded-Host', () => {
    expect(resolveRequestHost({ host: 'example.com', 'x-forwarded-host': 'evil.example.com' })).toBe('example.com');
  });

  it('去掉端口并转为小写、去掉末尾的点', () => {
    expect(normalizeHost('Alpha.Example.COM:8443')).toBe('alpha.example.com');
    expect(normalizeHost('example.com.')).toBe('example.com');
  });

  it('正确处理 IPv6 字面量（旧实现的 split(\':\') 会把它切成 "["）', () => {
    expect(normalizeHost('[::1]:4321')).toBe('[::1]');
    expect(normalizeHost('[2001:db8::1]:443')).toBe('[2001:db8::1]');
  });

  it('缺少 Host 头时返回空字符串，交由调用方按总站处理', () => {
    expect(resolveRequestHost({})).toBe('');
    expect(resolveRequestHost(undefined)).toBe('');
  });
});

describe('TS3 主机地址校验', () => {
  it('接受域名、IPv4 与 IPv6 字面量', () => {
    expect(isValidHost('ts3.example.com')).toBe(true);
    expect(isValidHost('127.0.0.1')).toBe(true);
    expect(isValidHost('2001:db8::1')).toBe(true);
    expect(isValidHost('[::1]')).toBe(true);
    expect(isValidHost('ts3_server.local')).toBe(true);
  });

  it('拒绝空白、协议前缀、路径与超长输入（这些会被写进 SQLite 与 .env）', () => {
    expect(isValidHost('')).toBe(false);
    expect(isValidHost('   ')).toBe(false);
    expect(isValidHost('http://ts3.example.com')).toBe(false);
    expect(isValidHost('ts3.example.com/path')).toBe(false);
    expect(isValidHost('ts3.example.com\nTS3_HOST=evil')).toBe(false);
    expect(isValidHost('a'.repeat(254))).toBe(false);
  });
});

describe('客户端版本号标签校验', () => {
  it('接受数字与点的组合', () => {
    expect(normalizeVersionLabel('3.6.2')).toBe('3.6.2');
    expect(normalizeVersionLabel('3')).toBe('3');
    expect(normalizeVersionLabel(' 3.6.2.1 ')).toBe('3.6.2.1');
  });

  it('拒绝可能被渲染进页面的任意文本', () => {
    expect(normalizeVersionLabel('<script>alert(1)</script>')).toBe('');
    expect(normalizeVersionLabel('v3.6.2')).toBe('');
    expect(normalizeVersionLabel('3.6.2-beta')).toBe('');
    expect(normalizeVersionLabel(undefined)).toBe('');
  });
});