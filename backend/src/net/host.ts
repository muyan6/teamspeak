/**
 * 主机名解析工具。
 *
 * 分站（租户）判定、WebSocket 定向推送都依赖「客户端到底访问了哪个域名」。
 * 统一在这里处理，避免各处自行 `split(':')` 造成 IPv6 字面量解析错误
 * （`[::1]:4321` 会被切成 `[`）。
 */

/**
 * 归一化主机名：去掉端口与末尾的点，转为小写，兼容 IPv6 字面量。
 *
 * @param rawHost 原始主机字符串，例如 `alpha.example.com:443`、`[::1]:4321`
 */
export function normalizeHost(rawHost: string): string {
  const value = (rawHost || '').trim().replace(/\.+$/, '');
  if (!value) return '';
  try {
    // 借助 URL 解析端口/IPv6，避免手写正则出错。
    return new URL(`http://${value}`).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    const withoutPort = value.replace(/:\d+$/, '');
    return withoutPort.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  }
}

/**
 * 从请求头中取出用于租户判定的主机名。
 *
 * 只读取 `Host`，**不读取** `X-Forwarded-Host`：后者在开启 `trust proxy`
 * 后可被直连后端的攻击者伪造，从而越权访问任意分站的 API。
 * 反向代理会原样转发 `Host`（见 install.md 的 `proxy_set_header Host $host`），
 * 因此这里拿到的就是用户真正访问的域名。
 */
export function resolveRequestHost(headers: Record<string, unknown> | undefined): string {
  const raw = headers && typeof headers.host === 'string' ? headers.host : '';
  return normalizeHost(raw);
}