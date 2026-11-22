import { describe, expect, it } from 'vitest';
import { extractCorrectAnswer, parseBatchAnalysis } from '../index';

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

  it('returns empty array for empty text', () => {
    expect(parseBatchAnalysis('')).toEqual([]);
    expect(parseBatchAnalysis('   \n\t ')).toEqual([]);
  });
});
