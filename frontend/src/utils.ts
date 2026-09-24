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

/** 仅允许 http/https 和相对路径，拦截 javascript: 等危险协议 */
function safeUrl(url: string): string {
  const u = url.trim();
  if (/^(https?:)?\/\//i.test(u) || u.startsWith('/') || u.startsWith('./') || u.startsWith('../') || u.startsWith('#')) {
    return u;
  }
  return '';
}

export function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  let listTag = 'ul';

  const inline = (text: string): string => {
    let t = escapeHtml(text);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => {
      const safe = safeUrl(src);
      return safe ? `<img alt="${alt}" src="${safe}" loading="lazy">` : '';
    });
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
      const safe = safeUrl(href);
      return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
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

