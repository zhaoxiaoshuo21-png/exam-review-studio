import { describe, expect, it } from 'vitest';
import {
  extractCorrectAnswer,
  parseBatchAnalysis,
  parseMaterialPack,
} from '../index';

describe('batchParser', () => {
  it('splits multi-question AI output with varied question header formats', () => {
    const raw = [
      '好的，以下是今天的三道错题深度复盘：',
      '',
      '### 第1题：建设现代化产业体系',
      '正确项：A',
      '一、【底层核心概念（说人话）】',
      '坚持把发展经济的着力点放在 **实体经济** 上。',
      '',
      '【第 2 题】',
      '题干：某地去年粮食产量同比增长 8%。',
      '答案：C',
      '二、【考场第一反应】',
      '基期量计算优先截位直除。',
      '',
      '题目3：判断推理对称轴',
      '正确答案：D',
      '对称轴每次顺时针旋转 45 度。',
    ].join('\n');

    const items = parseBatchAnalysis(raw);
    expect(items).toHaveLength(3);

    expect(items[0].indexLabel).toBe('第1题');
    expect(items[0].suggestedTitle).toBe('建设现代化产业体系');
    expect(items[0].correctAnswer).toBe('A');
    expect(items[0].analysisMarkdown).toContain('一、【底层核心概念（说人话）】');
    expect(items[0].analysisMarkdown).toContain('实体经济');

    expect(items[1].indexLabel).toBe('第 2 题');
    expect(items[1].correctAnswer).toBe('C');
    expect(items[1].stemText).toContain('某地去年粮食产量同比增长 8%');
    expect(items[1].analysisMarkdown).toContain('基期量计算优先截位直除');

    expect(items[2].indexLabel).toBe('题目3');
    expect(items[2].suggestedTitle).toBe('判断推理对称轴');
    expect(items[2].correctAnswer).toBe('D');
  });

  it('extracts correctAnswer when placed directly on the separator line', () => {
    const raw = [
      '第1题：正确项：B',
      '一、【核心解析】',
      '本题容易误选 A，实际应选 B。',
    ].join('\n');

    const items = parseBatchAnalysis(raw);
    expect(items).toHaveLength(1);
    expect(items[0].correctAnswer).toBe('B');
    expect(items[0].suggestedTitle).not.toBe('正确项：B');
  });

  it('falls back to a single item when no question separator exists', () => {
    const raw = [
      '一、【底层核心概念（说人话）】',
      '遇到增长率比较题先看现期量与基期量倍数。',
      '答案：B',
    ].join('\n');

    const items = parseBatchAnalysis(raw);
    expect(items).toHaveLength(1);
    expect(items[0].indexLabel).toBe('第1题');
    expect(items[0].correctAnswer).toBe('B');
    expect(items[0].analysisMarkdown).toBe(raw);
  });

  it('strips LaTeX color/bold wrappers from suggestedTitle', () => {
    const raw = [
      '### 第1题：$\\color{#FF5555}{\\textbf{建设现代化产业体系}}$',
      '正确答案：A',
      '一、【底层核心概念（说人话）】',
      '核心围绕 $\\color{#FF5555}{\\textbf{实体经济}}$。',
    ].join('\n');

    const items = parseBatchAnalysis(raw);
    expect(items).toHaveLength(1);
    expect(items[0].suggestedTitle).toBe('建设现代化产业体系');
    expect(items[0].suggestedTitle).not.toContain('\\color');
    expect(items[0].suggestedTitle).not.toContain('$');
  });

  it('extracts correctAnswer across LaTeX color/bold wrappers, parenthetical notes, deduction phrases, and boxed notation', () => {
    expect(
      extractCorrectAnswer('• 正确项： $\\color{#FF5555}{\\textbf{D项}}$。'),
    ).toBe('D');
    expect(
      extractCorrectAnswer('实战推导：答案必选 $\\color{#FF5555}{\\textbf{D}}$。'),
    ).toBe('D');
    expect(extractCorrectAnswer('正确项（本题选非）：D')).toBe('D');
    expect(extractCorrectAnswer('根据比例同构直接秒选 A。')).toBe('A');
    expect(extractCorrectAnswer('综合以上分析，最终结论为 \\boxed{C项}')).toBe('C');
    expect(extractCorrectAnswer('- **A. ①④⑤（正确项）**：唯一正解')).toBe('A');
  });

  it('parses material pack with leading 【材料】 block and sub-questions into materialStemText + subItems', () => {
    const raw = [
      '【材料】',
      '2025年某省规模以上工业增加值同比增长6.5%，其中高技术制造业增长11.2%。',
      '',
      '第1题',
      '2025年该省高技术制造业增速比规上工业高多少个百分点？',
      'A. 4.7',
      'B. 5.2',
      'C. 6.5',
      'D. 11.2',
      '一、【底层核心概念】',
      '直接作差：11.2 - 6.5 = 4.7，正确项：A。',
      '',
      '第2题',
      '若2024年规上工业增加值为1000亿元，2025年约为多少亿元？',
      'A. 1050',
      'B. 1065',
      'C. 1112',
      'D. 1200',
      '答案：B',
    ].join('\n');

    const pack = parseMaterialPack(raw);
    expect(pack.materialStemText).toBe(
      '2025年某省规模以上工业增加值同比增长6.5%，其中高技术制造业增长11.2%。',
    );
    expect(pack.subItems).toHaveLength(2);
    expect(pack.subItems[0].indexLabel).toBe('第1题');
    expect(pack.subItems[0].stemText).toContain('A. 4.7');
    expect(pack.subItems[0].correctAnswer).toBe('A');
    expect(pack.subItems[1].indexLabel).toBe('第2题');
    expect(pack.subItems[1].correctAnswer).toBe('B');
  });

  it('supports numbered 1./2. option sub-questions after 【给定资料】 and empty materialStemText when starting at 第1题', () => {
    const numberedRaw = [
      '【给定资料】：某科研团队有甲、乙、丙、丁、戊五名成员需要分组值班。',
      '1. 如果甲在第一组，下列哪项必定为真？',
      'A. 乙在第一组',
      'B. 丙在第二组',
      '解析：1. 先固定甲；2. 再推乙丙。正确项：B。',
      '2. 如果丁不在第二组，谁一定在第一组？',
      'A. 戊',
      'B. 甲',
      '答案：A',
    ].join('\n');

    const numberedPack = parseMaterialPack(numberedRaw);
    expect(numberedPack.materialStemText).toBe(
      '某科研团队有甲、乙、丙、丁、戊五名成员需要分组值班。',
    );
    expect(numberedPack.subItems).toHaveLength(2);
    expect(numberedPack.subItems[0].correctAnswer).toBe('B');
    expect(numberedPack.subItems[1].correctAnswer).toBe('A');

    const noLeadPack = parseMaterialPack('第1题\n题干：测试\n答案：C\n第2题\n答案：D');
    expect(noLeadPack.materialStemText).toBe('');
    expect(noLeadPack.subItems).toHaveLength(2);
  });

  it('returns empty array for empty text', () => {
    expect(parseBatchAnalysis('')).toEqual([]);
    expect(parseBatchAnalysis('   \n\t ')).toEqual([]);
  });
});
