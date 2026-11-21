import type { AppStateSnapshot } from '../types/schema';

export const EMBEDDED_DATA_SCRIPT_ID = 'EXAM_REVIEW_EMBEDDED_DATA';

// 避免在源码字面量中出现闭合 script 标签字符串，防止单文件打包内联时被 HTML 解析器提前截断
const SCRIPT_CLOSE_TAG = '<' + '/script>';
const EMBEDDED_SCRIPT_TAG_RE = new RegExp(
  `<script\\b[^>]*\\bid\\s*=\\s*(['"])${EMBEDDED_DATA_SCRIPT_ID}\\1[^>]*>([\\s\\S]*?)${SCRIPT_CLOSE_TAG}`,
  'i',
);
const ROOT_DIV_RE = /(<div\b[^>]*\bid\s*=\s*(['"])root\2[^>]*>)[\s\S]*?(<\/div>)/i;

export function isValidSnapshot(value: unknown): value is AppStateSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AppStateSnapshot>;
  return (
    Array.isArray(candidate.folders) &&
    Array.isArray(candidate.questions) &&
    typeof candidate.version === 'number'
  );
}

/**
 * 将快照安全序列化为可内嵌进 HTML script 标签的 JSON 字符串，
 * 强制转义 `<`、`>`、`&` 及行分隔符，防止闭合注入。
 */
export function serializeSnapshotForScript(snapshot: AppStateSnapshot): string {
  return JSON.stringify(snapshot)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * 判断当前是否处于 Vite 开发模式（页面中存在 `/src/main.tsx` 或 `/@vite/client` 脚本）。
 */
export function isViteDevMode(doc?: Document): boolean {
  const targetDoc = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!targetDoc) return false;

  const scripts = targetDoc.querySelectorAll('script[src]');
  for (let i = 0; i < scripts.length; i += 1) {
    const srcAttr = scripts[i].getAttribute('src') ?? '';
    const srcProp = (scripts[i] as HTMLScriptElement).src ?? '';
    const combined = `${srcAttr} ${srcProp}`;
    if (combined.includes('/src/main.tsx') || combined.includes('/@vite/client')) {
      return true;
    }
  }
  return false;
}

/**
 * 从当前 Document 的 `<script id="EXAM_REVIEW_EMBEDDED_DATA">` 读取内嵌快照。
 */
export function readEmbeddedSnapshotFromDocument(
  doc?: Document,
): AppStateSnapshot | null {
  const targetDoc = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!targetDoc) return null;

  const el = targetDoc.getElementById(EMBEDDED_DATA_SCRIPT_ID);
  if (!el) return null;

  const raw = (el.textContent ?? '').trim();
  if (!raw || raw === 'null') return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 从完整 HTML 字符串中解析 `<script id="EXAM_REVIEW_EMBEDDED_DATA">` 内嵌快照。
 */
export function parseEmbeddedSnapshotFromHtml(
  htmlText: string,
): AppStateSnapshot | null {
  if (!htmlText) return null;
  const match = htmlText.match(EMBEDDED_SCRIPT_TAG_RE);
  if (!match) return null;

  const raw = match[2].trim();
  if (!raw || raw === 'null') return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 基于给定的整页 HTML 字符串与快照，构建自举单文件 HTML：
 * 1. 清空 `#root` 容器避免残留已渲染 DOM
 * 2. 更新或插入 `<script id="EXAM_REVIEW_EMBEDDED_DATA" type="application/json">`
 * 3. 保留样式、脚本及页面其他结构，输出完整 `<!doctype html>...`
 */
export function buildSelfContainedHtmlString(
  docHtml: string,
  snapshot: AppStateSnapshot,
): string {
  const safeJson = serializeSnapshotForScript(snapshot);

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(docHtml, 'text/html');

    const rootEl = parsed.getElementById('root');
    if (rootEl) {
      rootEl.innerHTML = '';
    }

    parsed.documentElement.classList.toggle('dark', snapshot.theme === 'dark');

    let dataScript = parsed.getElementById(EMBEDDED_DATA_SCRIPT_ID);
    if (!dataScript) {
      dataScript = parsed.createElement('script');
      dataScript.id = EMBEDDED_DATA_SCRIPT_ID;
      dataScript.setAttribute('type', 'application/json');

      if (parsed.body) {
        const firstScript = parsed.body.querySelector('script');
        if (firstScript) {
          parsed.body.insertBefore(dataScript, firstScript);
        } else {
          parsed.body.appendChild(dataScript);
        }
      } else {
        parsed.head.appendChild(dataScript);
      }
    } else {
      dataScript.setAttribute('type', 'application/json');
    }

    dataScript.textContent = safeJson;
    return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
  }

  // 非 DOM 环境安全字符串替换回退
  let nextHtml = docHtml.replace(ROOT_DIV_RE, '$1$3');
  const scriptTag = `<script id="${EMBEDDED_DATA_SCRIPT_ID}" type="application/json">${safeJson}${SCRIPT_CLOSE_TAG}`;

  if (EMBEDDED_SCRIPT_TAG_RE.test(nextHtml)) {
    nextHtml = nextHtml.replace(EMBEDDED_SCRIPT_TAG_RE, () => scriptTag);
  } else if (/<\/body>/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<\/body>/i, `${scriptTag}\n</body>`);
  } else {
    nextHtml = `${nextHtml}\n${scriptTag}`;
  }

  if (!/^\s*<!doctype\s+html>/i.test(nextHtml)) {
    nextHtml = `<!doctype html>\n${nextHtml}`;
  }
  return nextHtml;
}

function formatDateTag(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function triggerHtmlDownload(html: string, filename: string): void {
  if (
    typeof document === 'undefined' ||
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return;
  }

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body?.appendChild(anchor);
  anchor.click();
  document.body?.removeChild(anchor);

  setTimeout(() => {
    URL.revokeObjectURL?.(url);
  }, 1000);
}

/**
 * 导出携带当前全部题库、图片与复习进度的自举单文件 HTML。
 * 若检测到处于 Vite 开发模式，返回引导构建单文件产物的提示原因。
 */
export function exportSelfContainedHtml(
  snapshot: AppStateSnapshot,
  filename?: string,
): { ok: boolean; reason?: string; html?: string; sizeBytes?: number } {
  if (isViteDevMode()) {
    return {
      ok: false,
      reason:
        '当前处于开发模式(vite dev)，请运行 npm run build 生成单体 dist/index.html 后打开使用自举导出功能，或先使用 JSON 备份。',
    };
  }

  if (typeof document === 'undefined' || !document.documentElement) {
    return {
      ok: false,
      reason: '当前运行环境不支持页面 DOM 导出，请改用 JSON 备份。',
    };
  }

  const now = Date.now();
  const nextSnapshot: AppStateSnapshot = {
    ...snapshot,
    exportedAt: now,
  };

  const rawDocHtml = `<!doctype html>\n${document.documentElement.outerHTML}`;
  const html = buildSelfContainedHtmlString(rawDocHtml, nextSnapshot);
  const sizeBytes =
    typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(html).length
      : html.length;

  const targetFilename = filename || `备考复盘本-${formatDateTag(now)}.html`;
  triggerHtmlDownload(html, targetFilename);

  return {
    ok: true,
    html,
    sizeBytes,
  };
}
