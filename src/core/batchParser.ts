import type { ParsedBatchItem } from '../types/contracts';
import { stripLatexMarkup } from './markdownRenderer';

const QUESTION_HEADER_RE =
  /^(?:#{1,4}\s*)?(?:\*\*)?[【\[（(]?\s*((?:第\s*[0-9一二三四五六七八九十百]+\s*[题道]|题目\s*[0-9一二三四五六七八九十百]+|错题\s*[0-9一二三四五六七八九十百]+|Question\s*[0-9]+|Q\s*[0-9]+))\s*[】\]）)]?(?:[:：.\s—\-]+(.*?))?(?:\*\*)?$/i;

const CLEANED_ANSWER_PATTERNS: RegExp[] = [
  /(?:正确项|正确答案|正确选项|参考答案|标准答案|本题答案)\s*(?:（[^）]{0,30}）|\([^)]{0,30}\))?\s*[：:是为]?\s*[【\[]?\s*([A-H]{1,4}|[对错√×])(?:\s*项|[\s.、。，,；;！!）)\]]|$)/i,
  /(?:【(?:正确)?答案】|(?:^|[\s，。；;•\-*○])答案)\s*(?:（[^）]{0,30}）|\([^)]{0,30}\))?\s*[：:是为]\s*[【\[]?\s*([A-H]{1,4}|[对错√×])(?:\s*项|[\s.、。，,；;！!）)\]]|$)/i,
  /(?:^|[\n\s•\-*○])([A-H])(?:\s*项|[.、\s][^（(\n]{0,30})?\s*[（(](?:正确项|正确答案|正确选项)[）)]/i,
  /(?:答案必选|故正确答案为|正确答案为|秒选|直接选|本题选|故选|因此选|答案选|最终选|锁定选项|锁定答案|锁定)\s*[：:是为]?\s*[【\[]?\s*([A-H]{1,4})(?:\s*项|[\s.、。，,；;！!）)\]]|$)/i,
];

const BOXED_ANSWER_RE =
  /\\boxed\{\s*(?:\\(?:textbf|mathbf|text)\{\s*)?([A-H]{1,4})(?:\s*项)?\s*\}?\s*\}/i;

function stripMarkdownDecorators(text: string): string {
  return stripLatexMarkup(text)
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/==/g, '')
    .replace(/`/g, '')
    .replace(/^[【\[]|[】\]]$/g, '')
    .trim();
}

/**
 * 从 AI 解析或题目文本中智能提取正确答案字母（支持剥离 LaTeX 着色/加粗、括号说明、实战推导结论句与 \boxed{A}）。
 */
export function extractCorrectAnswer(text: string): string | undefined {
  if (!text || !text.trim()) return undefined;

  const cleaned = stripLatexMarkup(text)
    .replace(/\*\*/g, '')
    .replace(/==/g, '')
    .replace(/`/g, '');

  for (const pattern of CLEANED_ANSWER_PATTERNS) {
    const match = cleaned.match(pattern);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  const boxedMatch = text.match(BOXED_ANSWER_RE);
  if (boxedMatch?.[1]) {
    return boxedMatch[1].toUpperCase();
  }

  return undefined;
}

function extractStemText(body: string): string {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const stemLines: string[] = [];
  let capturingStem = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (capturingStem && stemLines.length > 0) {
        stemLines.push('');
      }
      continue;
    }

    if (/^(?:一|二|三|四|五)[、.]\s*【/.test(trimmed) || /^#{1,4}\s*(?:一|二|三|解析|复盘)/.test(trimmed)) {
      break;
    }

    if (/^(?:【?(?:原题|题干|题目内容)】?\s*[：:]?)/.test(trimmed)) {
      capturingStem = true;
      const afterLabel = trimmed.replace(/^【?(?:原题|题干|题目内容)】?\s*[：:]?\s*/, '').trim();
      if (afterLabel) {
        stemLines.push(afterLabel);
      }
      continue;
    }

    if (/^(?:【?(?:解析|AI\s*解析|复盘|答案|正确答案|正确项)】?\s*[：:])/.test(trimmed)) {
      if (capturingStem) {
        break;
      }
      continue;
    }

    if (capturingStem) {
      stemLines.push(trimmed);
    }
  }

  return stemLines.join('\n').trim();
}

function buildSuggestedTitle(
  headerExtra: string | undefined,
  body: string,
  fallbackLabel: string,
): string {
  if (headerExtra) {
    const cleaned = stripMarkdownDecorators(headerExtra);
    const isOnlyAnswer =
      /^(?:正确项|正确答案|参考答案|标准答案|本题答案|正确选项|答案|故选|本题选)\s*[：:是为]?\s*[A-D]{1,4}$/i.test(
        cleaned,
      );
    if (!isOnlyAnswer && cleaned.length >= 2) {
      return cleaned.length > 44 ? `${cleaned.slice(0, 44)}...` : cleaned;
    }
  }

  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^[一二三四五六七八九十百]+[、.]\s*【/.test(trimmed)) continue;
    if (/^(?:正确项|正确答案|参考答案|标准答案|答案|故选|本题选)\s*[：:是为]/.test(trimmed)) {
      continue;
    }
    const cleaned = stripMarkdownDecorators(
      trimmed.replace(/^【?(?:原题|题干|题目|考点|核心考点|标题)】?\s*[：:]\s*/, ''),
    );
    if (!cleaned || cleaned.length < 2) continue;
    return cleaned.length > 40 ? `${cleaned.slice(0, 40)}...` : cleaned;
  }

  return fallbackLabel;
}

function isIgnorablePreamble(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length > 140) return false;
  if (/[一二三四五][、.]\s*【/.test(trimmed)) return false;
  if (extractCorrectAnswer(trimmed)) return false;
  if (/^[A-D][.、\s]/m.test(trimmed)) return false;
  return true;
}

/**
 * 批量解析 AI 生成的多题复盘长文：
 * - 智能识别 `第1题` / `第 1 题` / `### 第1题` / `【第1题】` / `题目1` 等题号分隔符
 * - 提取每题标题与正确答案，保留完整解析正文
 * - 无明显题号分隔时退化为单题
 */
export function parseBatchAnalysis(rawText: string): ParsedBatchItem[] {
  const normalized = (rawText ?? '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split('\n');
  interface RawBlock {
    indexLabel: string;
    headerExtra?: string;
    lines: string[];
  }

  const blocks: RawBlock[] = [];
  const preambleLines: string[] = [];
  let currentBlock: RawBlock | null = null;
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
    }

    if (!inCodeFence) {
      const headerMatch = trimmed.match(QUESTION_HEADER_RE);
      if (headerMatch) {
        if (currentBlock) {
          blocks.push(currentBlock);
        }
        currentBlock = {
          indexLabel: headerMatch[1].replace(/\s+/g, ' ').trim(),
          headerExtra: headerMatch[2]?.trim() || undefined,
          lines: [],
        };
        continue;
      }
    }

    if (currentBlock) {
      currentBlock.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  if (blocks.length === 0) {
    const correctAnswer = extractCorrectAnswer(normalized);
    const stemText = extractStemText(normalized);
    return [
      {
        tempId: 'batch-item-1',
        indexLabel: '第1题',
        suggestedTitle: buildSuggestedTitle(undefined, normalized, '第1题'),
        stemText,
        analysisMarkdown: normalized,
        correctAnswer,
        images: [],
      },
    ];
  }

  const preamble = preambleLines.join('\n').trim();
  if (preamble && !isIgnorablePreamble(preamble)) {
    blocks.unshift({
      indexLabel: '第0题',
      lines: preambleLines,
    });
  }

  return blocks
    .map((block, index): ParsedBatchItem | null => {
      const bodyText = block.lines.join('\n').trim();
      const combinedText = [block.headerExtra, bodyText].filter(Boolean).join('\n');
      if (!combinedText) return null;

      const analysisMarkdown =
        block.headerExtra && !bodyText.startsWith(block.headerExtra)
          ? (bodyText ? `### ${block.headerExtra}\n\n${bodyText}` : block.headerExtra).trim()
          : bodyText;

      return {
        tempId: `batch-item-${index + 1}`,
        indexLabel: block.indexLabel,
        suggestedTitle: buildSuggestedTitle(
          block.headerExtra,
          bodyText,
          block.indexLabel,
        ),
        stemText: extractStemText(combinedText),
        analysisMarkdown,
        correctAnswer: extractCorrectAnswer(combinedText),
        images: [],
      };
    })
    .filter((item): item is ParsedBatchItem => item !== null);
}
