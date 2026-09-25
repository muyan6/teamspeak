import { describe, expect, it } from 'vitest';
import { parseEnabledFlag } from './routes.js';

describe('分站启用标记解析', () => {
  it('接受真正的布尔值', () => {
    expect(parseEnabledFlag(true)).toBe(true);
    expect(parseEnabledFlag(false)).toBe(false);
  });

  it('接受 0/1 数字与字符串形式', () => {
    expect(parseEnabledFlag(1)).toBe(true);
    expect(parseEnabledFlag(0)).toBe(false);
    expect(parseEnabledFlag('1')).toBe(true);
    expect(parseEnabledFlag('0')).toBe(false);
    expect(parseEnabledFlag('true')).toBe(true);
    expect(parseEnabledFlag('TRUE')).toBe(true);
  });

  it('把字符串 "false" 解析为 false（旧实现用 Boolean() 会误判为 true，导致无法停用分站）', () => {
    expect(parseEnabledFlag('false')).toBe(false);
    expect(parseEnabledFlag(' false ')).toBe(false);
    expect(parseEnabledFlag('')).toBe(false);
  });

  it('对无法识别的输入一律返回 false，避免误启用', () => {
    expect(parseEnabledFlag(undefined)).toBe(false);
    expect(parseEnabledFlag(null)).toBe(false);
    expect(parseEnabledFlag({})).toBe(false);
    expect(parseEnabledFlag(2)).toBe(false);
    expect(parseEnabledFlag('yes')).toBe(false);
  });
});
