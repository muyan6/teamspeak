export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0 分钟';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d} 天`);
  if (h > 0) parts.push(`${h} 小时`);
  if (m > 0) parts.push(`${m} 分钟`);
  if (parts.length === 0) parts.push(`${s} 秒`);
  return parts.join(' ');
}

export function formatCompact(seconds: number): string {
  if (!seconds || seconds < 0) return '0h';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatUptime(seconds: number): string {
  if (!seconds || seconds < 0) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}小时`);
  if (m > 0) parts.push(`${m}分钟`);
  return parts.join(' ') || '刚刚';
}

export function formatMinutes(minutes: number): string {
  if (!minutes || minutes < 0) return '0 分钟';
  const m = Math.floor(minutes);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const rm = m % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d} 天`);
  if (h > 0) parts.push(`${h} 小时`);
  if (rm > 0) parts.push(`${rm} 分钟`);
  if (parts.length === 0) parts.push('0 分钟');
  return parts.join(' ');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 仅允许 http/https 和站内相对路径，拦截 javascript: 等危险协议。
 *
 * 不能只靠字符前缀判断：WHATWG URL 对 http(s) 等「特殊 scheme」会把反斜杠
 * 归一化成正斜杠，因此 `/(反斜杠)evil.com` 实际等价于 `//evil.com`，会被浏览器
 * 解析到外域（已用 node 复现：`new URL('/\\evil.com','https://good.example/')`
 * → `https://evil.com/`）。这里改为先用占位 origin 解析，再据此判定归属。
 */
const SAFE_URL_SENTINEL_ORIGIN = 'https://safe-url.invalid';

function safeUrl(url: string): string {
  const u = url.trim();
  if (!u) return '';
  try {
    const parsed = new URL(u, SAFE_URL_SENTINEL_ORIGIN);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    // 相对路径必须解析回占位 origin；解析到别处说明它其实是绝对/协议相对地址。
    if (parsed.origin === SAFE_URL_SENTINEL_ORIGIN) return u;
    if (u.startsWith('/') || u.startsWith('./') || u.startsWith('../')) return '';
    return u;
  } catch {
    return '';
  }
}

export function renderMarkdown(md: string): string {
  if (!md || typeof md !== 'string') return '';
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  let listTag = 'ul';

  const inline = (text: string): string => {
    // 注意：文本此前已由 escapeHtml 处理过（& 已转为 &amp;，" 已转为 &quot;）。
    // 此处 escapeAttr 只需确保单双引号与尖括号被安全编码，绝不能再次把 &amp; 转为 &amp;amp;，
    // 否则会破坏包含查询参数（?a=1&b=2）的链接与图片地址。
    const escapeAttr = (value: string): string =>
      value.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let t = escapeHtml(text);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => {
      const safe = safeUrl(src);
      return safe ? `<img alt="${escapeAttr(alt)}" src="${escapeAttr(safe)}" loading="lazy">` : '';
    });
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
      const safe = safeUrl(href);
      return safe ? `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    });
    return t;
  };

  const closeList = (): void => {
    if (inList) {
      html += `</${listTag}>`;
      inList = false;
    }
  };

  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      closeList();
      html += `<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`;
    } else if (/^\d+\.\s+/.test(line)) {
      if (!inList || listTag !== 'ol') {
        closeList();
        html += '<ol>';
        listTag = 'ol';
        inList = true;
      }
      html += `<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`;
    } else if (/^[*+-]\s+/.test(line)) {
      if (!inList || listTag !== 'ul') {
        closeList();
        html += '<ul>';
        listTag = 'ul';
        inList = true;
      }
      html += `<li>${inline(line.replace(/^[*+-]\s+/, ''))}</li>`;
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 降级使用 textarea
    }
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch {
    return false;
  }
}

