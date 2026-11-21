import { describe, expect, it } from 'vitest';
import { renderAnalysisHtml } from '../index';

describe('markdownRenderer', () => {
  it('escapes raw HTML to prevent XSS across paragraphs, code, and quotes', () => {
    const malicious = [
      '### 一、【安全测试】<script>alert(1)</script>',
      '> <img src=x onerror="alert(\'xss\')">',
      '正文包含 **<svg onload=alert(1)>** 与 `<b>code</b>` & 引号"测试"',
    ].join('\n');

    const html = renderAnalysisHtml(malicious);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<b>code</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;');
    expect(html).toContain('<mark class="hl-key">&lt;svg onload=alert(1)&gt;</mark>');
    expect(html).toContain('<code>&lt;b&gt;code&lt;/b&gt;</code>');
  });

  it('renders Chinese section headings and markdown headings with analysis-section-title class', () => {
    const md = [
      '一、【底层核心概念（说人话）】',
      '**二、【考场第一反应】**',
      '### 三、【实战解题与选项拆解】',
      '## 二级标题',
      '# 一级标题',
    ].join('\n');

    const html = renderAnalysisHtml(md);
    expect(html).toContain('<h3 class="analysis-section-title">一、【底层核心概念（说人话）】</h3>');
    expect(html).toContain('<h3 class="analysis-section-title">二、【考场第一反应】</h3>');
    expect(html).toContain('<h3 class="analysis-section-title">三、【实战解题与选项拆解】</h3>');
    expect(html).toContain('<h2 class="analysis-section-title">二级标题</h2>');
    expect(html).toContain('<h2 class="analysis-section-title">一级标题</h2>');
  });

  it('distinguishes **bold** (hl-key) and ==highlight== (hl-key hl-mark) while keeping inline code literal', () => {
    const md = '核心是 **实体经济**，切记 ==不要选数字经济==，代码 `**raw**` 原样显示。';
    const html = renderAnalysisHtml(md);
    expect(html).toContain('<mark class="hl-key">实体经济</mark>');
    expect(html).toContain('<mark class="hl-key hl-mark">不要选数字经济</mark>');
    expect(html).toContain('<code>**raw**</code>');
  });

  it('supports **bold** and ==highlight== wrapping inline code spans without leaking raw markers', () => {
    const md = '4. 推理图 4：指向 **右下斜向 `135°`（`\\` 方向）**，同时 ==注意 `a < b` 边界==。';
    const html = renderAnalysisHtml(md);
    expect(html).not.toContain('**');
    expect(html).not.toContain('==');
    expect(html).toContain(
      '<mark class="hl-key">右下斜向 <code>135°</code>（<code>\\</code> 方向）</mark>',
    );
    expect(html).toContain('<mark class="hl-key hl-mark">注意 <code>a &lt; b</code> 边界</mark>');
  });

  it('renders ordered lists and nested unordered lists with nested-list class', () => {
    const md = [
      '1. 第一步审题',
      '2. 第二步拆解',
      '- A 项正确',
      '  - 子要点一',
      '  * 子要点二',
      '• B 项干扰',
      '○ 无缩进空心圆点子要点',
    ].join('\n');

    const html = renderAnalysisHtml(md);
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>第一步审题</li>');
    expect(html).toContain('<ul class="nested-list">');
    expect(html).toContain('<li>子要点一</li>');
    expect(html).toContain('<li>无缩进空心圆点子要点</li>');
  });

  it('returns empty string for empty or whitespace input', () => {
    expect(renderAnalysisHtml('')).toBe('');
    expect(renderAnalysisHtml('   \n  ')).toBe('');
  });

  it('normalizes single-line pasted analysis and safely converts LaTeX colors, bold, and math symbols', () => {
    const pastedStickySample =
      '一、【底层核心概念（说人话）】 先翻译题目：这道题本质在考 $\\color{#FF5555}{\\textbf{现代化产业体系}}$ 的精准归类，利润率 $\\ge 15\\%$ 且 $A \\rightarrow B$ ，价格从 $100 涨到 $200 。 题型与关键词：政治理论。 思维链：先看大板块，再剔除市场体制。 考场潜规则（政治理论）：改革归体制，开放归外开。 二、【考场第一反应（应该怎么想）】 看什么：盯紧专精特新。 砍选项动作流： 1. 排除②统一大市场。 2. 排除③制度型开放。 ○ 注意不要被工业词带偏。 实战推导：锁定①④⑤。 正确项：A。 错误项（B/C/D）：混淆了板块归属。 秒杀口诀：企业装备加服务。 总结：抓主体不跑偏。 避坑提示：别把统一大市场当产业体系。';

    const html = renderAnalysisHtml(pastedStickySample);

    // 标题必须独立成 <h3 class="analysis-section-title">，严禁吞并正文
    expect(html).toContain('<h3 class="analysis-section-title">一、【底层核心概念（说人话）】</h3>');
    expect(html).toContain('<h3 class="analysis-section-title">二、【考场第一反应（应该怎么想）】</h3>');
    expect(html).not.toContain(
      '<h3 class="analysis-section-title">一、【底层核心概念（说人话）】 先翻译题目',
    );

    // LaTeX 源码必须零裸露，且正常美元价格 $100 和 $200 保持原样
    expect(html).not.toContain('\\color');
    expect(html).not.toContain('\\textbf');
    expect(html).not.toContain('\\rightarrow');
    expect(html).toContain('<mark class="hl-key">现代化产业体系</mark>');
    expect(html).toContain('≥ 15%');
    expect(html).toContain('A → B');
    expect(html).toContain('价格从 $100 涨到 $200');

    // 正文分段与列表结构必须被正确拆出，而非一整段粗体标题
    expect(html).toContain('<p>先翻译题目：');
    expect(html).toContain('<p>考场潜规则（政治理论）：改革归体制，开放归外开。</p>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<ul class="nested-list">');
    expect(html).toContain('<li>注意不要被工业词带偏。</li>');
  });

  it('supports bare and dollar-wrapped LaTeX highlight variants and escapes XSS inside LaTeX', () => {
    const sample = [
      '变体1：$\\color{red}\\textbf{核心点A}$',
      '变体2：$\\textcolor{#F06A6A}{核心点B}$',
      '变体3：{\\color{#FF5555} 核心点C}',
      '变体4：\\textbf{<script>alert(1)</script>} 与 \\mathbf{a \\times b \\neq c}',
      '变体5：$\\text{纯文本}$ 且 \\text{增长率} \\le 10\\% \\pm 1\\% 与 $$\\color{red}{核心点D}$$',
    ].join('\n');

    const html = renderAnalysisHtml(sample);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('\\color');
    expect(html).not.toContain('\\textcolor');
    expect(html).not.toContain('\\textbf');
    expect(html).not.toContain('\\mathbf');
    expect(html).not.toContain('\\text');
    expect(html).not.toContain('$');
    expect(html).toContain('<mark class="hl-key">核心点A</mark>');
    expect(html).toContain('<mark class="hl-key">核心点B</mark>');
    expect(html).toContain('<mark class="hl-key">核心点C</mark>');
    expect(html).toContain('<mark class="hl-key">核心点D</mark>');
    expect(html).toContain('<mark class="hl-key">&lt;script&gt;alert(1)&lt;/script&gt;</mark>');
    expect(html).toContain('<mark class="hl-key">a × b ≠ c</mark>');
    expect(html).toContain('纯文本 且 增长率 ≤ 10% ± 1%');
  });
});
