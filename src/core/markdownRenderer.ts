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
  while (
    i < str.length &&
    (str[i] === ' ' || str[i] === '\t' || str[i] === '\n')
  ) {
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

function readBracketGroup(
  str: string,
  startIdx: number,
): { content: string; endIdx: number } | null {
  let i = startIdx;
  while (i < str.length && (str[i] === ' ' || str[i] === '\t')) {
    i += 1;
  }
  if (i >= str.length || str[i] !== '[') {
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
    if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
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

function stripLeftRightPrefixes(text: string): string {
  return text
    .replace(/\\(?:left|right)\./g, '')
    .replace(/\\(?:left|right)\s*\\([{}])/g, '$1')
    .replace(/\\(?:left|right)(?![A-Za-z])\s*/g, '');
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
    .replace(/\\(?:cdots|ldots|dots)(?![A-Za-z])/g, '…')
    .replace(/\\cdot(?![A-Za-z])/g, '·')
    .replace(/\\infty(?![A-Za-z])/g, '∞')
    .replace(/\^\s*(?:\{\s*\\circ\s*\}|\\circ(?![A-Za-z]))/g, '°')
    .replace(/\\circ(?![A-Za-z])/g, '°')
    .replace(/\\Delta(?![A-Za-z])/g, 'Δ')
    .replace(/\\pi(?![A-Za-z])/g, 'π')
    .replace(/\\alpha(?![A-Za-z])/g, 'α')
    .replace(/\\beta(?![A-Za-z])/g, 'β')
    .replace(/\\theta(?![A-Za-z])/g, 'θ')
    .replace(/\\because(?![A-Za-z])/g, '∵')
    .replace(/\\therefore(?![A-Za-z])/g, '∴')
    .replace(/\\angle(?![A-Za-z])/g, '∠')
    .replace(/\\perp(?![A-Za-z])/g, '⊥')
    .replace(/\\parallel(?![A-Za-z])/g, '∥')
    .replace(/\\triangle(?![A-Za-z])/g, '△')
    .replace(/\\(?:qquad|quad)(?![A-Za-z])/g, ' ')
    .replace(/\\[,;:]/g, ' ')
    .replace(/\\%/g, '%');
}

function isCommandAt(str: string, index: number, cmdName: string): boolean {
  if (!str.startsWith(cmdName, index)) return false;
  const nextPos = index + cmdName.length;
  return nextPos >= str.length || !/[A-Za-z]/.test(str[nextPos]);
}

function findClosingInlineDelimiter(
  str: string,
  startIdx: number,
  delimiter: string,
  allowNewline: boolean,
): number {
  for (let i = startIdx; i < str.length; i += 1) {
    if (!allowNewline && str[i] === '\n') {
      return -1;
    }
    if (str.startsWith(delimiter, i) && str[i - 1] !== '\\') {
      return i;
    }
  }
  return -1;
}

const MATH_CONTENT_SIGNAL_RE =
  /\\(?:[A-Za-z]+|%|[()[\],;:])|\^|_|^[A-Za-z0-9+\-*/=<>().,\s]+$/;
const HAS_MATH_OPERATOR_OR_VAR_RE = /[=+\-*/<>]|[A-Za-z]/;

function isLikelyDollarMath(inner: string, nextAfterClose: string): boolean {
  if (!inner.trim()) return false;
  if (/[0-9]/.test(nextAfterClose)) return false;
  if (/\\(?:[A-Za-z]+|%)|\^|_/.test(inner)) return true;
  if (
    MATH_CONTENT_SIGNAL_RE.test(inner) &&
    HAS_MATH_OPERATOR_OR_VAR_RE.test(inner)
  ) {
    return true;
  }
  return false;
}

interface InlineRenderHooks {
  onHighlight: (innerHtml: string) => string;
  onFraction: (numHtml: string, denHtml: string) => string;
  onSqrt: (idxHtml: string | null, bodyHtml: string) => string;
  onBoxed: (bodyHtml: string) => string;
  onSup: (innerHtml: string) => string;
  onSub: (innerHtml: string) => string;
  onPlainText: (escapedReady: string) => string;
  enableMarkdownHighlight: boolean;
}

function renderInlineCore(
  rawText: string,
  inMathContext: boolean,
  hooks: InlineRenderHooks,
): string {
  const tokens: string[] = [];
  const pushToken = (rendered: string): string => {
    const idx = tokens.length;
    tokens.push(rendered);
    return `\u0000TK${idx}\u0000`;
  };

  const renderNested = (inner: string, childInMath: boolean): string =>
    renderInlineCore(inner, childInMath, hooks);

  // 先剥离 \left / \right 定界符修饰，避免打断外层括号与上标结合
  const cleanedDelims = stripLeftRightPrefixes(rawText);

  let out = '';
  let i = 0;

  while (i < cleanedDelims.length) {
    const ch = cleanedDelims[i];

    // 1. {\color{...} ...} / {\textcolor{...} ...}
    if (ch === '{') {
      const outer = readBracedGroup(cleanedDelims, i);
      if (outer) {
        const innerTrimmed = outer.content.trimStart();
        const colorCmd = isCommandAt(innerTrimmed, 0, '\\textcolor')
          ? '\\textcolor'
          : isCommandAt(innerTrimmed, 0, '\\color')
            ? '\\color'
            : '';
        if (colorCmd) {
          const colorSpec = readBracedGroup(innerTrimmed, colorCmd.length);
          if (colorSpec) {
            const rest = innerTrimmed.slice(colorSpec.endIdx).trim();
            out += pushToken(hooks.onHighlight(renderNested(rest, inMathContext)));
            i = outer.endIdx;
            continue;
          }
        }
      }
    }

    // 2. LaTeX 命令：\color, \textcolor, \textbf, \mathbf, \frac/\dfrac/\tfrac, \sqrt, \boxed, \text/\mathrm/\operatorname/\boldsymbol, \(...\), \[...\]
    if (ch === '\\') {
      // 2a. 行内 \( ... \) 与 \[ ... \]
      if (!inMathContext && cleanedDelims.startsWith('\\(', i)) {
        const closeIdx = findClosingInlineDelimiter(cleanedDelims, i + 2, '\\)', false);
        if (closeIdx !== -1) {
          const inner = cleanedDelims.slice(i + 2, closeIdx).trim();
          out += pushToken(renderNested(inner, true));
          i = closeIdx + 2;
          continue;
        }
      }

      if (!inMathContext && cleanedDelims.startsWith('\\[', i)) {
        const closeIdx = findClosingInlineDelimiter(cleanedDelims, i + 2, '\\]', true);
        if (closeIdx !== -1) {
          const inner = cleanedDelims.slice(i + 2, closeIdx).trim();
          out += pushToken(renderNested(inner, true));
          i = closeIdx + 2;
          continue;
        }
      }

      // 2b. \color / \textcolor
      const colorCmd = isCommandAt(cleanedDelims, i, '\\textcolor')
        ? '\\textcolor'
        : isCommandAt(cleanedDelims, i, '\\color')
          ? '\\color'
          : '';
      if (colorCmd) {
        const colorSpec = readBracedGroup(cleanedDelims, i + colorCmd.length);
        if (colorSpec) {
          let afterColor = colorSpec.endIdx;
          while (
            afterColor < cleanedDelims.length &&
            (cleanedDelims[afterColor] === ' ' || cleanedDelims[afterColor] === '\t')
          ) {
            afterColor += 1;
          }

          const boldCmd = isCommandAt(cleanedDelims, afterColor, '\\textbf')
            ? '\\textbf'
            : isCommandAt(cleanedDelims, afterColor, '\\mathbf')
              ? '\\mathbf'
              : '';
          if (boldCmd) {
            const boldBody = readBracedGroup(
              cleanedDelims,
              afterColor + boldCmd.length,
            );
            if (boldBody) {
              out += pushToken(
                hooks.onHighlight(renderNested(boldBody.content, inMathContext)),
              );
              i = boldBody.endIdx;
              continue;
            }
          }

          const bodyGroup = readBracedGroup(cleanedDelims, afterColor);
          if (bodyGroup) {
            out += pushToken(
              hooks.onHighlight(renderNested(bodyGroup.content, inMathContext)),
            );
            i = bodyGroup.endIdx;
            continue;
          }
        }
      }

      // 2c. \textbf / \mathbf
      const boldCmd = isCommandAt(cleanedDelims, i, '\\textbf')
        ? '\\textbf'
        : isCommandAt(cleanedDelims, i, '\\mathbf')
          ? '\\mathbf'
          : '';
      if (boldCmd) {
        const boldBody = readBracedGroup(cleanedDelims, i + boldCmd.length);
        if (boldBody) {
          out += pushToken(
            hooks.onHighlight(renderNested(boldBody.content, inMathContext)),
          );
          i = boldBody.endIdx;
          continue;
        }
      }

      // 2d. \frac / \dfrac / \tfrac
      const fracCmd = isCommandAt(cleanedDelims, i, '\\frac')
        ? '\\frac'
        : isCommandAt(cleanedDelims, i, '\\dfrac')
          ? '\\dfrac'
          : isCommandAt(cleanedDelims, i, '\\tfrac')
            ? '\\tfrac'
            : '';
      if (fracCmd) {
        const numGroup = readBracedGroup(cleanedDelims, i + fracCmd.length);
        if (numGroup) {
          const denGroup = readBracedGroup(cleanedDelims, numGroup.endIdx);
          if (denGroup) {
            const numHtml = renderNested(numGroup.content.trim(), true);
            const denHtml = renderNested(denGroup.content.trim(), true);
            out += pushToken(hooks.onFraction(numHtml, denHtml));
            i = denGroup.endIdx;
            continue;
          }
        }
      }

      // 2e. \sqrt[n]{body} / \sqrt{body}
      if (isCommandAt(cleanedDelims, i, '\\sqrt')) {
        let cursor = i + 5;
        const idxGroup = readBracketGroup(cleanedDelims, cursor);
        if (idxGroup) {
          cursor = idxGroup.endIdx;
        }
        const bodyGroup = readBracedGroup(cleanedDelims, cursor);
        if (bodyGroup) {
          const idxHtml = idxGroup ? renderNested(idxGroup.content.trim(), true) : null;
          const bodyHtml = renderNested(bodyGroup.content.trim(), true);
          out += pushToken(hooks.onSqrt(idxHtml, bodyHtml));
          i = bodyGroup.endIdx;
          continue;
        }
      }

      // 2f. \boxed{body}
      if (isCommandAt(cleanedDelims, i, '\\boxed')) {
        const boxedGroup = readBracedGroup(cleanedDelims, i + 6);
        if (boxedGroup) {
          const bodyHtml = renderNested(boxedGroup.content.trim(), true);
          out += pushToken(hooks.onBoxed(bodyHtml));
          i = boxedGroup.endIdx;
          continue;
        }
      }

      // 2g. \text / \mathrm / \operatorname / \boldsymbol 剥离包装保留内容
      const plainCmd = isCommandAt(cleanedDelims, i, '\\operatorname')
        ? '\\operatorname'
        : isCommandAt(cleanedDelims, i, '\\boldsymbol')
          ? '\\boldsymbol'
          : isCommandAt(cleanedDelims, i, '\\mathrm')
            ? '\\mathrm'
            : isCommandAt(cleanedDelims, i, '\\text')
              ? '\\text'
              : '';
      if (plainCmd) {
        const group = readBracedGroup(cleanedDelims, i + plainCmd.length);
        if (group) {
          out += pushToken(renderNested(group.content, false));
          i = group.endIdx;
          continue;
        }
      }
    }

    // 3. $...$ 与行内 $$...$$（仅在非数学递归顶层拆封，同时保护 $100 和 $200）
    if (!inMathContext && ch === '$' && (i === 0 || cleanedDelims[i - 1] !== '\\')) {
      const isDouble =
        i + 1 < cleanedDelims.length && cleanedDelims[i + 1] === '$';
      const delimLen = isDouble ? 2 : 1;
      const closeIdx = findClosingInlineDelimiter(
        cleanedDelims,
        i + delimLen,
        isDouble ? '$$' : '$',
        isDouble,
      );
      if (closeIdx !== -1) {
        const nextAfterClose =
          closeIdx + delimLen < cleanedDelims.length
            ? cleanedDelims[closeIdx + delimLen]
            : '';
        const inner = cleanedDelims.slice(i + delimLen, closeIdx);
        if (isLikelyDollarMath(inner, nextAfterClose)) {
          out += pushToken(renderNested(inner.trim(), true));
          i = closeIdx + delimLen;
          continue;
        }
      }
    }

    // 4. 角度简写 ^\circ / ^{\circ} -> °（必须在通用上标前拦截）
    if (ch === '^') {
      const restSlice = cleanedDelims.slice(i);
      const degMatch = restSlice.match(/^\^\s*(?:\{\s*\\circ\s*\}|\\circ(?![A-Za-z]))/);
      if (degMatch) {
        out += '°';
        i += degMatch[0].length;
        continue;
      }

      // 花括号上标 ^{...}
      const supGroup = readBracedGroup(cleanedDelims, i + 1);
      if (supGroup) {
        out += pushToken(hooks.onSup(renderNested(supGroup.content.trim(), true)));
        i = supGroup.endIdx;
        continue;
      }

      // 数学上下文或紧跟字母/数字/右括号/数学Token的单字符上标 ^x
      const prevChar = i > 0 ? cleanedDelims[i - 1] : '';
      const nextChar = i + 1 < cleanedDelims.length ? cleanedDelims[i + 1] : '';
      const afterNext = i + 2 < cleanedDelims.length ? cleanedDelims[i + 2] : '';
      const validSupBase =
        inMathContext || /[A-Za-z0-9)\u0000]/.test(prevChar);
      if (
        validSupBase &&
        /[A-Za-z0-9]/.test(nextChar) &&
        !/[A-Za-z0-9_]/.test(afterNext)
      ) {
        out += pushToken(hooks.onSup(hooks.onPlainText(nextChar)));
        i += 2;
        continue;
      }
    }

    // 5. 下标 _{...} 与安全单字符下标 _x（绝不误伤 foo_bar_baz 或 URL）
    if (ch === '_') {
      const subGroup = readBracedGroup(cleanedDelims, i + 1);
      if (subGroup) {
        out += pushToken(hooks.onSub(renderNested(subGroup.content.trim(), true)));
        i = subGroup.endIdx;
        continue;
      }

      const prevChar = i > 0 ? cleanedDelims[i - 1] : '';
      const beforePrev = i > 1 ? cleanedDelims[i - 2] : '';
      const nextChar = i + 1 < cleanedDelims.length ? cleanedDelims[i + 1] : '';
      const afterNext = i + 2 < cleanedDelims.length ? cleanedDelims[i + 2] : '';

      const isSingleSubTarget =
        /[A-Za-z0-9]/.test(nextChar) && !/[A-Za-z0-9_]/.test(afterNext);
      const validSubBase = inMathContext
        ? /[A-Za-z0-9)\u0000]/.test(prevChar)
        : /[A-Za-z0-9)\u0000]/.test(prevChar) &&
          (prevChar === ')' ||
            prevChar === '\u0000' ||
            !/[A-Za-z0-9_/:.]/.test(beforePrev));

      if (validSubBase && isSingleSubTarget) {
        out += pushToken(hooks.onSub(hooks.onPlainText(nextChar)));
        i += 2;
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  const withSymbols = replaceLatexSymbols(out).replace(/\\\$/g, '$');
  let rendered = hooks.onPlainText(withSymbols);

  if (hooks.enableMarkdownHighlight) {
    rendered = rendered
      .replace(/\*\*(.+?)\*\*/g, '<mark class="hl-key">$1</mark>')
      .replace(/==(.+?)==/g, '<mark class="hl-key hl-mark">$1</mark>');
  }

  return rendered.replace(/\u0000TK(\d+)\u0000/g, (_match, idxStr: string) => {
    return tokens[Number(idxStr)] ?? '';
  });
}

const HTML_RENDER_HOOKS: InlineRenderHooks = {
  onHighlight: (innerHtml) => {
    if (
      innerHtml.startsWith('<mark class="hl-key">') &&
      innerHtml.endsWith('</mark>') &&
      innerHtml.indexOf('</mark>') === innerHtml.length - 7
    ) {
      return innerHtml;
    }
    return `<mark class="hl-key">${innerHtml}</mark>`;
  },
  onFraction: (numHtml, denHtml) =>
    `<span class="math-frac"><span class="math-num">${numHtml}</span><span class="math-den">${denHtml}</span></span>`,
  onSqrt: (idxHtml, bodyHtml) =>
    idxHtml !== null
      ? `<span class="math-sqrt"><sup class="math-sqrt-idx">${idxHtml}</sup><span class="math-sqrt-sign">√</span><span class="math-sqrt-body">${bodyHtml}</span></span>`
      : `<span class="math-sqrt"><span class="math-sqrt-sign">√</span><span class="math-sqrt-body">${bodyHtml}</span></span>`,
  onBoxed: (bodyHtml) => `<span class="math-boxed">${bodyHtml}</span>`,
  onSup: (innerHtml) => `<sup class="math-sup">${innerHtml}</sup>`,
  onSub: (innerHtml) => `<sub class="math-sub">${innerHtml}</sub>`,
  onPlainText: (raw) => escapeHtml(raw),
  enableMarkdownHighlight: true,
};

const PLAIN_STRIP_HOOKS: InlineRenderHooks = {
  onHighlight: (inner) => inner,
  onFraction: (num, den) => `${num}/${den}`,
  onSqrt: (idx, body) => (idx ? `${idx}√${body}` : `√${body}`),
  onBoxed: (body) => body,
  onSup: (inner) => `^${inner}`,
  onSub: (inner) => `_${inner}`,
  onPlainText: (raw) => raw,
  enableMarkdownHighlight: false,
};

/**
 * 剥离常见 LaTeX 着色/加粗/分式/根号/公式包裹，保留干净可读纯文本（供批量标题提取等复用）。
 */
export function stripLatexMarkup(rawText: string): string {
  if (!rawText) return '';
  const sanitized = rawText.replace(/\u0000/g, '');
  return renderInlineCore(sanitized, false, PLAIN_STRIP_HOOKS);
}

function renderInlineInternal(rawText: string, inMathContext: boolean): string {
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

  const rendered = renderInlineCore(
    withCodePlaceholders,
    inMathContext,
    HTML_RENDER_HOOKS,
  );

  return rendered.replace(/\u0000CODE(\d+)\u0000/g, (_match, idxStr: string) => {
    return codeBlocks[Number(idxStr)] ?? '';
  });
}

function renderInline(rawText: string): string {
  return renderInlineInternal(rawText, false);
}

/**
 * 渲染题干/选项行内文本与数学公式（防 XSS）：
 * 供 `ReviewDeck` 原题区段落、陈述句与选项安全呈现分式、根号、上下标、数学符号与重点强调。
 */
export function renderStemInlineHtml(rawText: string): string {
  if (!rawText) return '';
  const normalized = rawText.replace(/\r\n?/g, '\n');
  if (!normalized.includes('\n')) {
    return renderInlineInternal(normalized, false);
  }
  return normalized
    .split('\n')
    .map((line) => renderInlineInternal(line, false))
    .join('<br />');
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
 * - 完整保留已正常换行的 Markdown、代码块与块级公式
 */
export function normalizePastedAnalysis(markdown: string): string {
  if (!markdown || !markdown.trim()) {
    return markdown;
  }

  const normalized = markdown.replace(/\r\n?/g, '\n');
  const rawLines = normalized.split('\n');
  const resultLines: string[] = [];
  let inCodeFence = false;
  let mathDelimiter: '$$' | '\\[' | null = null;

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

    if (mathDelimiter !== null) {
      resultLines.push(line);
      const endDelim = mathDelimiter === '$$' ? '$$' : '\\]';
      if (trimmed.endsWith(endDelim)) {
        mathDelimiter = null;
      }
      continue;
    }

    if (
      (trimmed.startsWith('$$') && trimmed.slice(2).indexOf('$$') === -1) ||
      (trimmed.startsWith('\\[') && trimmed.slice(2).indexOf('\\]') === -1)
    ) {
      mathDelimiter = trimmed.startsWith('$$') ? '$$' : '\\[';
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

function renderMathBlockHtml(rawFormula: string): string {
  const trimmed = rawFormula.trim();
  if (!trimmed) return '<div class="math-block"></div>';
  const rendered = renderInlineInternal(trimmed, true);
  const formatted = rendered.replace(/\n+/g, '<br />');
  return `<div class="math-block">${formatted}</div>`;
}

/**
 * 零外部依赖、防 XSS 的公考复盘 Markdown 渲染器：
 * - 先对粘连富文本粘贴内容做板块/标签换行规整
 * - 对全部文本执行 HTML 转义 (< > & " ')，支持安全递归 LaTeX 分式/根号/方框/上下标/块级公式与暖红高亮
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
  let mathBlockMode: '$$' | '\\[' | null = null;
  let mathBlockLines: string[] = [];

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

  const flushUnclosedMathBlock = (): void => {
    if (mathBlockMode === null) return;
    const openDelim = mathBlockMode;
    mathBlockMode = null;
    const raw = `${openDelim}${mathBlockLines.join('\n')}`;
    mathBlockLines = [];
    for (const part of raw.split('\n')) {
      if (part.trim()) {
        paragraphLines.push(part.trim());
      }
    }
    flushParagraph();
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

    if (mathBlockMode !== null) {
      const closeDelim = mathBlockMode === '$$' ? '$$' : '\\]';
      if (trimmed.endsWith(closeDelim)) {
        const beforeClose = trimmed.slice(0, -closeDelim.length).trim();
        if (beforeClose) {
          mathBlockLines.push(beforeClose);
        }
        out.push(renderMathBlockHtml(mathBlockLines.join('\n')));
        mathBlockMode = null;
        mathBlockLines = [];
      } else {
        mathBlockLines.push(line);
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

    // 独立块级公式：单行或多行 $$...$$ 与 \[...\]
    if (
      trimmed.startsWith('$$') &&
      trimmed.endsWith('$$') &&
      trimmed.length > 4 &&
      trimmed.slice(2, -2).indexOf('$$') === -1
    ) {
      flushParagraph();
      flushQuote();
      flushLists();
      out.push(renderMathBlockHtml(trimmed.slice(2, -2)));
      continue;
    }

    if (trimmed.startsWith('$$') && trimmed.slice(2).indexOf('$$') === -1) {
      flushParagraph();
      flushQuote();
      flushLists();
      mathBlockMode = '$$';
      const firstBody = trimmed.slice(2).trim();
      mathBlockLines = firstBody ? [firstBody] : [];
      continue;
    }

    if (
      trimmed.startsWith('\\[') &&
      trimmed.endsWith('\\]') &&
      trimmed.length > 4 &&
      trimmed.slice(2, -2).indexOf('\\]') === -1
    ) {
      flushParagraph();
      flushQuote();
      flushLists();
      out.push(renderMathBlockHtml(trimmed.slice(2, -2)));
      continue;
    }

    if (trimmed.startsWith('\\[') && trimmed.slice(2).indexOf('\\]') === -1) {
      flushParagraph();
      flushQuote();
      flushLists();
      mathBlockMode = '\\[';
      const firstBody = trimmed.slice(2).trim();
      mathBlockLines = firstBody ? [firstBody] : [];
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

  flushUnclosedMathBlock();
  flushCodeFence();
  flushParagraph();
  flushQuote();
  flushLists();

  return out.join('\n');
}
