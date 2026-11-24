import type { ParsedBatchItem, ParsedMaterialPack } from '../types/contracts';
import { stripLatexMarkup } from './markdownRenderer';

const QUESTION_HEADER_RE =
  /^(?:#{1,4}\s*)?(?:\*\*)?[【\[（(]?\s*((?:第\s*[0-9一二三四五六七八九十百]+\s*[题道]|题目\s*[0-9一二三四五六七八九十百]+|错题\s*[0-9一二三四五六七八九十百]+|Question\s*[0-9]+|Q\s*[0-9]+))\s*[】\]）)]?(?:[:：.\s—\-]+(.*?))?(?:\*\*)?$/i;

const NUMBERED_QUESTION_LINE_RE =
  /^(?:#{1,4}\s*)?(?:\*\*)?(\d{1,2})\s*[.、．]\s+(.+?)(?:\*\*)?$/;
const OPTION_LINE_HINT_RE =
  /^(?:[（(]?([A-H])[)）]?[.、．:：]\s*\S.*|[（(]?([A-H])[)）]?)$/i;
const MATERIAL_PREFIX_RE =
  /^(?:#{1,4}\s*)?(?:\*\*)?[【\[（(]?\s*(?:背景|给定|文字)?(?:材料|资料)(?:\s*[一二三四五1-9])?\s*[】\]）)]?\s*(?:\*\*)?\s*[：:]?\s*/;

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
  let explicitTagFound = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (capturingStem && stemLines.length > 0) {
        stemLines.push('');
      }
      continue;
    }

    if (
      /^(?:一|二|三|四|五)[、.]\s*【/.test(trimmed) ||
      /^#{1,4}\s*(?:一|二|三|解析|复盘)/.test(trimmed)
    ) {
      break;
    }

    if (/^(?:【?(?:原题|题干|题目内容)】?\s*[：:]?)/.test(trimmed)) {
      capturingStem = true;
      explicitTagFound = true;
      const afterLabel = trimmed
        .replace(/^【?(?:原题|题干|题目内容)】?\s*[：:]?\s*/, '')
        .trim();
      if (afterLabel) {
        stemLines.push(afterLabel);
      }
      continue;
    }

    if (
      /^(?:【?(?:解析|AI\s*解析|复盘|答案|正确答案|正确项)】?\s*[：:])/.test(
        trimmed,
      )
    ) {
      if (capturingStem) {
        break;
      }
      continue;
    }

    if (capturingStem) {
      stemLines.push(trimmed);
    }
  }

  if (explicitTagFound) {
    return stemLines.join('\n').trim();
  }

  // 若无显式“题干：”标签，但解析前段包含选项（A/B/C/D），则提取前段题干与选项作为 stemText
  const preAnalysisLines: string[] = [];
  let optionCount = 0;
  let lastOptionIdx = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      /^(?:一|二|三|四|五)[、.]\s*【/.test(trimmed) ||
      /^#{1,4}\s*(?:一|二|三|解析|复盘)/.test(trimmed) ||
      /^(?:【?(?:解析|AI\s*解析|复盘|答案|正确答案|正确项)】?\s*[：:])/.test(
        trimmed,
      )
    ) {
      break;
    }
    if (OPTION_LINE_HINT_RE.test(trimmed)) {
      optionCount += 1;
      lastOptionIdx = preAnalysisLines.length;
    }
    preAnalysisLines.push(line);
  }

  if (optionCount >= 2 && lastOptionIdx >= 0) {
    // 若最后一行是单字母标且紧跟其后还有一行选项内容，一并包含
    let endSlice = lastOptionIdx + 1;
    if (
      /^[（(]?[A-H][)）]?[.、．:：]?$/i.test(
        preAnalysisLines[lastOptionIdx].trim(),
      )
    ) {
      for (let k = lastOptionIdx + 1; k < preAnalysisLines.length; k += 1) {
        if (preAnalysisLines[k].trim()) {
          endSlice = k + 1;
          break;
        }
      }
    }
    return preAnalysisLines.slice(0, endSlice).join('\n').trim();
  }

  return '';
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

function cleanMaterialStem(rawPreamble: string): string {
  const trimmed = rawPreamble.trim();
  if (!trimmed) return '';
  return trimmed.replace(MATERIAL_PREFIX_RE, '').trim();
}

function findNumberedOptionQuestionIndices(lines: string[]): number[] {
  const candidates: Array<{ lineIdx: number; num: number }> = [];
  let inCodeFence = false;
  let inAnalysisSection = false;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    if (
      /^(?:一|二|三|四|五)[、.]\s*【/.test(trimmed) ||
      /^(?:【?(?:解析|AI\s*解析|复盘)】?\s*[：:]|#{1,4}\s*(?:一|二|三|解析|复盘))/.test(
        trimmed,
      )
    ) {
      inAnalysisSection = true;
      continue;
    }

    const match = trimmed.match(NUMBERED_QUESTION_LINE_RE);
    if (match) {
      const num = Number(match[1]);
      // 若处于解析段落中，仅当后方很快出现 >= 2 个选项行时才视为下一道带选项大题
      if (inAnalysisSection) {
        let nearbyOptions = 0;
        for (let k = i + 1; k < Math.min(lines.length, i + 14); k += 1) {
          if (OPTION_LINE_HINT_RE.test(lines[k].trim())) {
            nearbyOptions += 1;
            if (nearbyOptions >= 2) break;
          }
        }
        if (nearbyOptions < 2) continue;
        inAnalysisSection = false;
      }
      candidates.push({ lineIdx: i, num });
    }
  }

  // 过滤出真正带有选项的大题起始行（区间内至少含 2 个选项行）
  const validIndices: number[] = [];
  for (let c = 0; c < candidates.length; c += 1) {
    const start = candidates[c].lineIdx;
    const end =
      c + 1 < candidates.length ? candidates[c + 1].lineIdx : lines.length;
    let optionHits = 0;
    for (let k = start + 1; k < end; k += 1) {
      if (OPTION_LINE_HINT_RE.test(lines[k].trim())) {
        optionHits += 1;
      }
    }
    if (optionHits >= 2) {
      validIndices.push(start);
    }
  }

  return validIndices;
}

/**
 * 将包含共用大材料与多道小题（一拖N）的长文拆解为 `{ materialStemText, subItems }`：
 * - 若首个题号前存在材料文本或 `【材料】`/`【给定资料】`/`【背景材料】` 块，提取并清洗前缀作为 `materialStemText`
 * - 后方各小题复用 `parseBatchAnalysis` 逻辑拆解，支持标准题号及带选项的 `1.`/`2.` 编号大题
 */
export function parseMaterialPack(rawText: string): ParsedMaterialPack {
  const normalized = (rawText ?? '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return {
      materialStemText: '',
      subItems: [],
    };
  }

  const lines = normalized.split('\n');
  let firstHeaderIdx = -1;
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (!inCodeFence && QUESTION_HEADER_RE.test(trimmed)) {
      firstHeaderIdx = i;
      break;
    }
  }

  if (firstHeaderIdx !== -1) {
    const materialStemText = cleanMaterialStem(
      lines.slice(0, firstHeaderIdx).join('\n'),
    );
    const questionsText = lines.slice(firstHeaderIdx).join('\n');
    return {
      materialStemText,
      subItems: parseBatchAnalysis(questionsText),
    };
  }

  // 回退识别带选项的 `1.` / `2.` 编号大题
  const numberedIndices = findNumberedOptionQuestionIndices(lines);
  if (numberedIndices.length > 0) {
    const firstNumIdx = numberedIndices[0];
    const materialStemText = cleanMaterialStem(
      lines.slice(0, firstNumIdx).join('\n'),
    );
    const indexSet = new Set(numberedIndices);
    let seq = 0;
    const normalizedQuestionLines = lines.slice(firstNumIdx).map((line, relIdx) => {
      const absIdx = firstNumIdx + relIdx;
      if (!indexSet.has(absIdx)) return line;
      seq += 1;
      const bodyAfterNum = line.trim().replace(/^(?:#{1,4}\s*)?(?:\*\*)?\d{1,2}\s*[.、．]\s+/, '').replace(/\*\*$/, '').trim();
      return `第${seq}题\n${bodyAfterNum}`;
    });

    return {
      materialStemText,
      subItems: parseBatchAnalysis(normalizedQuestionLines.join('\n')),
    };
  }

  // 无明显题号分隔时退化为单题且无前导材料
  return {
    materialStemText: '',
    subItems: parseBatchAnalysis(normalized),
  };
}
