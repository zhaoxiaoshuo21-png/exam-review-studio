/**
 * 将字符转义为安全 HTML 实体，防止任何 XSS 注入。
 */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readBracedGroup(
  str: string,
  startIdx: number,
): { content: string; endIdx: number } | null {
  let i = startIdx;
  while (i < str.length && (str[i] === ' ' || str[i] === '\t')) {
    i += 1;
  }
  if (i >= str.length || str[i] !== '{') {
    return null;
  }

  let depth = 0;
  const contentStart = i + 1;
  for (let j = i; j < str.length; j += 1) {
    const ch = str[j];
    if (ch === '\\' && j + 1 < str.length) {
      j += 1;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          content: str.slice(contentStart, j),
          endIdx: j + 1,
        };
      }
    }
  }
  return null;
}

function replaceLatexSymbols(text: string): string {
  return text
    .replace(/\\(?:rightarrow|Rightarrow)(?![A-Za-z])/g, '→')
    .replace(/\\leftarrow(?![A-Za-z])/g, '←')
    .replace(/\\times(?![A-Za-z])/g, '×')
    .replace(/\\div(?![A-Za-z])/g, '÷')
    .replace(/\\approx(?![A-Za-z])/g, '≈')
    .replace(/\\neq(?![A-Za-z])/g, '≠')
    .replace(/\\(?:leq|le)(?![A-Za-z])/g, '≤')
    .replace(/\\(?:geq|ge)(?![A-Za-z])/g, '≥')
    .replace(/\\pm(?![A-Za-z])/g, '±')
    .replace(/\\%/g, '%');
}

function unwrapLatexCommand(str: string, cmdName: string): string {
  let out = '';
  let i = 0;
  const prefix = `\\${cmdName}`;
  while (i < str.length) {
    if (
      str.startsWith(prefix, i) &&
      (i + prefix.length >= str.length || !/[A-Za-z]/.test(str[i + prefix.length]))
    ) {
      const group = readBracedGroup(str, i + prefix.length);
      if (group) {
        out += unwrapLatexCommand(group.content, cmdName);
        i = group.endIdx;
        continue;
      }
    }
    out += str[i];
    i += 1;
  }
  return out;
}

function resolveLatexInnerText(rawInner: string): string {
  let current = rawInner;
  for (const cmd of ['textbf', 'mathbf', 'text']) {
    current = unwrapLatexCommand(current, cmd);
  }
  return replaceLatexSymbols(current);
}

function parseColorOrBoldCommands(
  str: string,
  onHighlight: (plainInner: string) => string,
): string {
  let out = '';
  let i = 0;

  while (i < str.length) {
    // 1. 匹配 {\color{...} ...} 或 {\textcolor{...} ...}
    if (str[i] === '{') {
      const outer = readBracedGroup(str, i);
      if (outer) {
        const innerTrimmed = outer.content.trimStart();
        const colorCmd = innerTrimmed.startsWith('\\textcolor')
          ? '\\textcolor'
          : innerTrimmed.startsWith('\\color')
            ? '\\color'
            : '';
        if (
          colorCmd &&
          (innerTrimmed.length === colorCmd.length ||
            !/[A-Za-z]/.test(innerTrimmed[colorCmd.length]))
        ) {
          const colorSpec = readBracedGroup(innerTrimmed, colorCmd.length);
          if (colorSpec) {
            const rest = innerTrimmed.slice(colorSpec.endIdx).trim();
            out += onHighlight(resolveLatexInnerText(rest));
            i = outer.endIdx;
            continue;
          }
        }
      }
    }

    // 2. 匹配 \color{...}{\textbf{...}} / \color{...}\textbf{...} / \textcolor{...}{...} / \color{...}{...}
    if (str[i] === '\\') {
      const isTextColor =
        str.startsWith('\\textcolor', i) &&
        (i + 10 >= str.length || !/[A-Za-z]/.test(str[i + 10]));
      const isColor =
        !isTextColor &&
        str.startsWith('\\color', i) &&
        (i + 6 >= str.length || !/[A-Za-z]/.test(str[i + 6]));

      if (isTextColor || isColor) {
        const cmdLen = isTextColor ? 10 : 6;
        const colorSpec = readBracedGroup(str, i + cmdLen);
        if (colorSpec) {
          let afterColor = colorSpec.endIdx;
          while (afterColor < str.length && (str[afterColor] === ' ' || str[afterColor] === '\t')) {
            afterColor += 1;
          }

          const boldCmd = str.startsWith('\\textbf', afterColor)
            ? '\\textbf'
            : str.startsWith('\\mathbf', afterColor)
              ? '\\mathbf'
              : '';
          if (
            boldCmd &&
            (afterColor + boldCmd.length >= str.length ||
              !/[A-Za-z]/.test(str[afterColor + boldCmd.length]))
          ) {
            const boldBody = readBracedGroup(str, afterColor + boldCmd.length);
            if (boldBody) {
              out += onHighlight(resolveLatexInnerText(boldBody.content));
              i = boldBody.endIdx;
              continue;
            }
          }

          const bodyGroup = readBracedGroup(str, afterColor);
          if (bodyGroup) {
            out += onHighlight(resolveLatexInnerText(bodyGroup.content));
            i = bodyGroup.endIdx;
            continue;
          }
        }
      }

      // 3. 匹配独立 \textbf{...} 或 \mathbf{...}
      const boldCmd = str.startsWith('\\textbf', i)
        ? '\\textbf'
        : str.startsWith('\\mathbf', i)
          ? '\\mathbf'
          : '';
      if (
        boldCmd &&
        (i + boldCmd.length >= str.length || !/[A-Za-z]/.test(str[i + boldCmd.length]))
      ) {
        const boldBody = readBracedGroup(str, i + boldCmd.length);
        if (boldBody) {
          out += onHighlight(resolveLatexInnerText(boldBody.content));
          i = boldBody.endIdx;
          continue;
        }
      }
    }

    out += str[i];
    i += 1;
  }

  return out;
}

const HAS_LATEX_CMD_RE = /\\(?:[A-Za-z]+|%)|\u0000HL/;

function unwrapMathDollarWrappers(str: string): string {
  let out = '';
  let i = 0;

  while (i < str.length) {
    if (str[i] === '$' && (i === 0 || str[i - 1] !== '\\')) {
      const isDouble = i + 1 < str.length && str[i + 1] === '$';
      const delimLen = isDouble ? 2 : 1;
      let j = i + delimLen;
      while (j < str.length && str[j] !== '\n') {
        if (isDouble) {
          if (str[j] === '$' && j + 1 < str.length && str[j + 1] === '$' && str[j - 1] !== '\\') {
            break;
          }
        } else if (str[j] === '$' && str[j - 1] !== '\\') {
          break;
        }
        j += 1;
      }

      const hasClosing = isDouble
        ? j + 1 < str.length && str[j] === '$' && str[j + 1] === '$'
        : j < str.length && str[j] === '$';
      if (hasClosing) {
        const nextAfterClose = j + delimLen < str.length ? str[j + delimLen] : '';
        const inner = str.slice(i + delimLen, j);
        if (HAS_LATEX_CMD_RE.test(inner) && !/[0-9]/.test(nextAfterClose)) {
          out += inner.trim();
          i = j + delimLen;
          continue;
        }
      }
    }

    out += str[i];
    i += 1;
  }

  return out;
}

function resolveLatexCommon(
  sanitized: string,
  wrapHighlight: (plainInner: string) => string,
): { text: string; hlBlocks: string[] } {
  const hlBlocks: string[] = [];
  const withLatexPlaceholders = parseColorOrBoldCommands(
    sanitized,
    (plainInner) => {
      const index = hlBlocks.length;
      hlBlocks.push(wrapHighlight(plainInner));
      return `\u0000HL${index}\u0000`;
    },
  );

  const unwrappedMath = unwrapMathDollarWrappers(withLatexPlaceholders);
  const unwrappedText = unwrapLatexCommand(unwrappedMath, 'text');
  const withSymbols = replaceLatexSymbols(unwrappedText).replace(/\\\$/g, '$');
  return { text: withSymbols, hlBlocks };
}

/**
 * 剥离常见 LaTeX 着色/加粗/公式包裹，保留干净可读纯文本（供批量标题提取等复用）。
 */
export function stripLatexMarkup(rawText: string): string {
  if (!rawText) return '';
  const sanitized = rawText.replace(/\u0000/g, '');
  const { text, hlBlocks } = resolveLatexCommon(sanitized, (inner) => inner);
  return text.replace(/\u0000HL(\d+)\u0000/g, (_match, idxStr: string) => {
    return hlBlocks[Number(idxStr)] ?? '';
  });
}

/**
 * 渲染行内 Markdown：
 * - 行内代码 `...`
 * - LaTeX 着色/加粗（$\color{...}{\textbf{...}}$ / \textcolor / \textbf 等）与数学符号（防 XSS）
 * - **文字** -> <mark class="hl-key">文字</mark>（纯暖红粗体重点字）
 * - ==文字== -> <mark class="hl-key hl-mark">文字</mark>（柔和底纹高亮）
 */
function renderInline(rawText: string): string {
  const codeBlocks: string[] = [];
  const sanitized = rawText.replace(/\u0000/g, '');

  const withCodePlaceholders = sanitized.replace(
    /`([^`]+)`/g,
    (_match, codeContent: string) => {
      const index = codeBlocks.length;
      codeBlocks.push(`<code>${escapeHtml(codeContent)}</code>`);
      return `\u0000CODE${index}\u0000`;
    },
  );

  const { text: withSymbols, hlBlocks } = resolveLatexCommon(
    withCodePlaceholders,
    (plainInner) => `<mark class="hl-key">${escapeHtml(plainInner)}</mark>`,
  );

  const escaped = escapeHtml(withSymbols);
  const highlighted = escaped
    .replace(/\*\*(.+?)\*\*/g, '<mark class="hl-key">$1</mark>')
    .replace(/==(.+?)==/g, '<mark class="hl-key hl-mark">$1</mark>');

  return highlighted
    .replace(/\u0000HL(\d+)\u0000/g, (_match, idxStr: string) => {
      return hlBlocks[Number(idxStr)] ?? '';
    })
    .replace(/\u0000CODE(\d+)\u0000/g, (_match, idxStr: string) => {
      return codeBlocks[Number(idxStr)] ?? '';
    });
}

interface ListLevel {
  tag: 'ul' | 'ol';
  indent: number;
  hasOpenLi: boolean;
}

const SECTION_HEADING_RE = /^([一二三四五六七八九十百]+[、.]\s*【[^】]{1,40}】)$/;
const PLAIN_CN_HEADING_RE = /^([一二三四五六七八九十百]+、\s*[^。！？!?]{1,36})$/;
const HASH_HEADING_RE = /^(#{1,4})\s+(.+)$/;
const UL_RE = /^([ \t]*)([-*•○])\s+(.*)$/;
const OL_RE = /^([ \t]*)(\d+)\.\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^([-*_]){3,}\s*$/;
const FENCE_RE = /^```/;

const EMBEDDED_CN_SECTION_RE =
  /(^|[\s。！？!?；;：:）)\]])(?:#{1,4}\s*)?(?:\*\*)?([一二三四五六七八九十百]+[、.]\s*【[^】]{1,40}】)(?:\*\*)?/g;
const STICKY_LABEL_RE =
  /([。！？!?；;]\s*|\s+)((?:[-*•○]\s+)?(?:\*\*)?(?:先翻译题目|题型与关键词|思维链|考场潜规则(?:（[^）]{1,20}）|\([^)]{1,20}\))?|看什么|砍选项动作流|实战推导|正确项(?:（[^）]{1,20}）|\([^)]{1,20}\))?|错误项(?:（[^）]{1,20}）|\([^)]{1,20}\))?|秒杀口诀|总结|避坑提示)\s*(?:\*\*)?[：:](?:\*\*)?)/g;
const STICKY_LIST_AFTER_PUNCT_RE =
  /([。！？!?；;：:])\s*(\d+\.\s+|[○•]\s+)/g;

function splitEmbeddedSectionsOnLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [line];

  const hashMatch = trimmed.match(HASH_HEADING_RE);
  if (hashMatch) {
    const hashBody = hashMatch[2].trim();
    const onlySection = hashBody.match(
      /^(?:\*\*)?([一二三四五六七八九十百]+[、.]\s*【[^】]{1,40}】)(?:\*\*)?$/,
    );
    if (onlySection) {
      return [line];
    }
    const leadingSection = hashBody.match(
      /^(?:\*\*)?([一二三四五六七八九十百]+[、.]\s*【[^】]{1,40}】)(?:\*\*)?\s+(.+)$/,
    );
    if (leadingSection) {
      return [`${hashMatch[1]} ${leadingSection[1].trim()}`, leadingSection[2].trim()];
    }
    return [line];
  }

  const standaloneUnwrapped =
    trimmed.startsWith('**') && trimmed.endsWith('**') && trimmed.length > 4
      ? trimmed.slice(2, -2).trim()
      : trimmed;
  if (SECTION_HEADING_RE.test(standaloneUnwrapped)) {
    return [line];
  }

  if (!/[一二三四五六七八九十百]+[、.]\s*【[^】]{1,40}】/.test(trimmed)) {
    return [line];
  }

  const replaced = trimmed.replace(
    EMBEDDED_CN_SECTION_RE,
    (_full, prefix: string, heading: string) => {
      const cleanPrefix = prefix && !/^\s+$/.test(prefix) ? prefix : '';
      return `${cleanPrefix}\n\n${heading.trim()}\n`;
    },
  );

  return replaced
    .split('\n')
    .map((part) => part.trim())
    .filter((part, idx, arr) => part.length > 0 || (idx > 0 && arr[idx - 1] !== ''));
}

function splitStickyLongLine(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.length <= 80) {
    return [line];
  }

  let next = trimmed.replace(
    STICKY_LABEL_RE,
    (full, sep: string, label: string, offset: number, source: string) => {
      const before = source.slice(0, offset).trim();
      if (!before || /^(?:\d+\.|[-*•○])$/.test(before)) {
        return full;
      }
      const cleanSep = /^[。！？!?；;]/.test(sep) ? sep.trimEnd() : '';
      const isBulletLabel = /^[-*•○]\s+/.test(label);
      return `${cleanSep}${isBulletLabel ? '\n' : '\n\n'}${label}`;
    },
  );

  next = next.replace(
    STICKY_LIST_AFTER_PUNCT_RE,
    (_full, punct: string, marker: string) => `${punct}\n${marker}`,
  );

  return next.split('\n');
}

/**
 * 前置规整富文本粘贴丢失换行的 AI 解析：
 * - 自动将同行的 `一、【...】`、`二、【...】` 等大板块标题拆成独立行
 * - 对丢失换行的长行，在典型复盘标签及句末标点后的列表项前补回换行
 * - 完整保留已正常换行的 Markdown 与代码块
 */
export function normalizePastedAnalysis(markdown: string): string {
  if (!markdown || !markdown.trim()) {
    return markdown;
  }

  const normalized = markdown.replace(/\r\n?/g, '\n');
  const rawLines = normalized.split('\n');
  const resultLines: string[] = [];
  let inCodeFence = false;

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (FENCE_RE.test(trimmed)) {
      inCodeFence = !inCodeFence;
      resultLines.push(line);
      continue;
    }

    if (inCodeFence) {
      resultLines.push(line);
      continue;
    }

    const afterSectionSplit = splitEmbeddedSectionsOnLine(line);
    for (const part of afterSectionSplit) {
      const expanded = splitStickyLongLine(part);
      resultLines.push(...expanded);
    }
  }

  return resultLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function computeIndent(rawPrefix: string): number {
  let width = 0;
  for (let i = 0; i < rawPrefix.length; i += 1) {
    width += rawPrefix[i] === '\t' ? 2 : 1;
  }
  return width;
}

function isHeadingLine(trimmed: string): { level: number; text: string } | null {
  const hashMatch = trimmed.match(HASH_HEADING_RE);
  if (hashMatch) {
    return {
      level: hashMatch[1].length,
      text: hashMatch[2].trim(),
    };
  }
  const unwrapped =
    trimmed.startsWith('**') && trimmed.endsWith('**') && trimmed.length > 4
      ? trimmed.slice(2, -2).trim()
      : trimmed;
  const cnBracketMatch = unwrapped.match(SECTION_HEADING_RE);
  if (cnBracketMatch) {
    return {
      level: 3,
      text: cnBracketMatch[1].trim(),
    };
  }
  const cnPlainMatch = unwrapped.match(PLAIN_CN_HEADING_RE);
  if (cnPlainMatch) {
    return {
      level: 3,
      text: cnPlainMatch[1].trim(),
    };
  }
  return null;
}

/**
 * 零外部依赖、防 XSS 的公考复盘 Markdown 渲染器：
 * - 先对粘连富文本粘贴内容做板块/标签换行规整
 * - 对全部文本执行 HTML 转义 (< > & " ')，支持安全 LaTeX 暖红高亮与常见数学符号
 * - 识别中文板块标题（一、【...】、二、【...】）与 Markdown 标题（# / ## / ###），输出带 class="analysis-section-title" 的标题
 * - 将 **文字** 渲染为 <mark class="hl-key">文字</mark>，==文字== 渲染为 <mark class="hl-key hl-mark">文字</mark>
 * - 支持有序列表、多级无序列表（含缩进与 - / * / • / ○，子列表带 class="nested-list"）、行内代码、引用块与普通段落
 */
export function renderAnalysisHtml(markdown: string): string {
  if (!markdown || !markdown.trim()) {
    return '';
  }

  const normalized = normalizePastedAnalysis(markdown);
  const lines = normalized.split('\n');
  const out: string[] = [];

  const listStack: ListLevel[] = [];
  let paragraphLines: string[] = [];
  let quoteLines: string[] = [];
  let inCodeFence = false;
  let codeFenceLines: string[] = [];

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) return;
    const html = paragraphLines.map((line) => renderInline(line)).join('<br />');
    out.push(`<p>${html}</p>`);
    paragraphLines = [];
  };

  const flushQuote = (): void => {
    if (quoteLines.length === 0) return;
    const html = quoteLines.map((line) => renderInline(line)).join('<br />');
    out.push(`<blockquote><p>${html}</p></blockquote>`);
    quoteLines = [];
  };

  const closeOpenLi = (): void => {
    if (
      out.length > 0 &&
      out[out.length - 1].startsWith('<li>') &&
      !out[out.length - 1].endsWith('</li>')
    ) {
      out[out.length - 1] += '</li>';
    } else {
      out.push('</li>');
    }
  };

  const flushLists = (): void => {
    while (listStack.length > 0) {
      const top = listStack.pop()!;
      if (top.hasOpenLi) {
        closeOpenLi();
      }
      out.push(`</${top.tag}>`);
    }
  };

  const flushCodeFence = (): void => {
    if (!inCodeFence) return;
    out.push(`<pre><code>${escapeHtml(codeFenceLines.join('\n'))}</code></pre>`);
    inCodeFence = false;
    codeFenceLines = [];
  };

  const pushListItem = (
    tag: 'ul' | 'ol',
    rawIndent: number,
    marker: string,
    rawContent: string,
  ): void => {
    let effectiveIndent = rawIndent;
    // 若未缩进但使用了空心圆点 ○ 且当前已在列表中，视为二级子列表
    if (marker === '○' && rawIndent === 0 && listStack.length > 0) {
      effectiveIndent = listStack[0].indent + 2;
    }

    const contentHtml = renderInline(rawContent);

    if (listStack.length === 0) {
      out.push(`<${tag}>`);
      listStack.push({ tag, indent: effectiveIndent, hasOpenLi: true });
      out.push(`<li>${contentHtml}`);
      return;
    }

    const top = listStack[listStack.length - 1];
    if (effectiveIndent > top.indent) {
      out.push(`<${tag} class="nested-list">`);
      listStack.push({ tag, indent: effectiveIndent, hasOpenLi: true });
      out.push(`<li>${contentHtml}`);
      return;
    }

    while (listStack.length > 0 && effectiveIndent < listStack[listStack.length - 1].indent) {
      const popped = listStack.pop()!;
      if (popped.hasOpenLi) {
        closeOpenLi();
      }
      out.push(`</${popped.tag}>`);
    }

    if (listStack.length === 0) {
      out.push(`<${tag}>`);
      listStack.push({ tag, indent: effectiveIndent, hasOpenLi: true });
      out.push(`<li>${contentHtml}`);
      return;
    }

    const currentTop = listStack[listStack.length - 1];
    if (effectiveIndent > currentTop.indent) {
      out.push(`<${tag} class="nested-list">`);
      listStack.push({ tag, indent: effectiveIndent, hasOpenLi: true });
      out.push(`<li>${contentHtml}`);
      return;
    }

    if (currentTop.tag !== tag) {
      if (currentTop.hasOpenLi) {
        closeOpenLi();
      }
      out.push(`</${currentTop.tag}>`);
      listStack.pop();
      const nestedAttr = listStack.length > 0 ? ' class="nested-list"' : '';
      out.push(`<${tag}${nestedAttr}>`);
      listStack.push({ tag, indent: effectiveIndent, hasOpenLi: true });
      out.push(`<li>${contentHtml}`);
      return;
    }

    if (currentTop.hasOpenLi) {
      closeOpenLi();
    }
    currentTop.hasOpenLi = true;
    out.push(`<li>${contentHtml}`);
  };

  const peekNextNonEmptyLine = (startIndex: number): string | null => {
    for (let j = startIndex + 1; j < lines.length; j += 1) {
      const candidate = lines[j];
      if (candidate.trim().length > 0) {
        return candidate;
      }
    }
    return null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (inCodeFence) {
      if (FENCE_RE.test(trimmed)) {
        flushCodeFence();
      } else {
        codeFenceLines.push(line);
      }
      continue;
    }

    if (FENCE_RE.test(trimmed)) {
      flushParagraph();
      flushQuote();
      flushLists();
      inCodeFence = true;
      codeFenceLines = [];
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushQuote();
      if (listStack.length > 0) {
        const nextLine = peekNextNonEmptyLine(i);
        const nextIsList =
          nextLine !== null && (UL_RE.test(nextLine) || OL_RE.test(nextLine));
        if (!nextIsList) {
          flushLists();
        }
      }
      continue;
    }

    const heading = isHeadingLine(trimmed);
    if (heading) {
      flushParagraph();
      flushQuote();
      flushLists();
      const tag = heading.level <= 2 ? 'h2' : 'h3';
      out.push(
        `<${tag} class="analysis-section-title">${renderInline(heading.text)}</${tag}>`,
      );
      continue;
    }

    const quoteMatch = trimmed.match(QUOTE_RE);
    if (quoteMatch) {
      flushParagraph();
      flushLists();
      quoteLines.push(quoteMatch[1]);
      continue;
    }

    if (HR_RE.test(trimmed)) {
      flushParagraph();
      flushQuote();
      flushLists();
      out.push('<hr />');
      continue;
    }

    const ulMatch = line.match(UL_RE);
    if (ulMatch) {
      flushParagraph();
      flushQuote();
      pushListItem(
        'ul',
        computeIndent(ulMatch[1]),
        ulMatch[2],
        ulMatch[3],
      );
      continue;
    }

    const olMatch = line.match(OL_RE);
    if (olMatch) {
      flushParagraph();
      flushQuote();
      pushListItem(
        'ol',
        computeIndent(olMatch[1]),
        olMatch[2],
        olMatch[3],
      );
      continue;
    }

    flushQuote();
    flushLists();
    paragraphLines.push(trimmed);
  }

  flushCodeFence();
  flushParagraph();
  flushQuote();
  flushLists();

  return out.join('\n');
}
