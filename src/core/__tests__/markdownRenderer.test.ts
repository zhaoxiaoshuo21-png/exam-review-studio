import { describe, expect, it } from 'vitest';
import {
  renderAnalysisHtml,
  renderStemInlineHtml,
  stripLatexMarkup,
} from '../index';

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

  it('renders data-analysis fractions and numeric expressions with or without dollar signs', () => {
    const md = [
      '户均利润 = 户均营收 × \\frac{总利润}{总营收}',
      '代入计算：$\\frac{197.6 \\times 12}{10198.5} \\approx 0.232$',
      '兼容变体：\\dfrac{A}{B} 与 \\tfrac{1}{2}',
    ].join('\n');

    const html = renderAnalysisHtml(md);
    expect(html).not.toContain('\\frac');
    expect(html).not.toContain('\\dfrac');
    expect(html).not.toContain('\\tfrac');
    expect(html).not.toContain('$');
    expect(html).toContain(
      '<span class="math-frac"><span class="math-num">总利润</span><span class="math-den">总营收</span></span>',
    );
    expect(html).toContain(
      '<span class="math-frac"><span class="math-num">197.6 × 12</span><span class="math-den">10198.5</span></span> ≈ 0.232',
    );
    expect(html).toContain(
      '<span class="math-frac"><span class="math-num">A</span><span class="math-den">B</span></span>',
    );
  });

  it('renders nested two-period proportion fractions, multi-line math blocks, roots, and boxed answers', () => {
    const md = [
      '两期比重公式：\\frac{\\frac{A}{1+a}}{\\frac{B}{1+b}}',
      '',
      '$$',
      '\\frac{A}{B} \\times \\frac{a-b}{1+a}',
      '$$',
      '',
      '\\[ \\sqrt[3]{27} + (1+r)^2 + \\sqrt{x^2 + y_1} \\]',
      '',
      '结论：\\boxed{A}，角度 $90^\\circ$，满足 \\( \\because a \\cdot b \\neq 0 \\therefore \\Delta > 0 \\)。',
    ].join('\n');

    const html = renderAnalysisHtml(md);
    // 嵌套分式
    expect(html).toContain(
      '<span class="math-frac"><span class="math-num"><span class="math-frac"><span class="math-num">A</span><span class="math-den">1+a</span></span></span><span class="math-den"><span class="math-frac"><span class="math-num">B</span><span class="math-den">1+b</span></span></span></span>',
    );
    // 跨行 $$...$$ 块级公式
    expect(html).toContain('<div class="math-block">');
    expect(html).toContain(
      '<div class="math-block"><span class="math-frac"><span class="math-num">A</span><span class="math-den">B</span></span> × <span class="math-frac"><span class="math-num">a-b</span><span class="math-den">1+a</span></span></div>',
    );
    // 块级 \[...\] + 根号 + 上下标
    expect(html).toContain(
      '<div class="math-block"><span class="math-sqrt"><sup class="math-sqrt-idx">3</sup><span class="math-sqrt-sign">√</span><span class="math-sqrt-body">27</span></span> + (1+r)<sup class="math-sup">2</sup> + <span class="math-sqrt"><span class="math-sqrt-sign">√</span><span class="math-sqrt-body">x<sup class="math-sup">2</sup> + y<sub class="math-sub">1</sub></span></span></div>',
    );
    // \boxed 与行内 \(...\) 及扩展符号
    expect(html).toContain('<span class="math-boxed">A</span>');
    expect(html).toContain('90°');
    expect(html).toContain('∵ a · b ≠ 0 ∴ Δ &gt; 0');
  });

  it('supports color/bold nested in fractions while protecting currency, identifiers, URLs, and XSS', () => {
    const md = [
      '高亮嵌套：\\color{#FF5555}{\\frac{增量}{基期}} 与 \\frac{\\color{#FF5555}{\\textbf{总利润}}}{**总营收**}',
      '括号与符号：\\left(\\frac{1}{1+r}\\right)^3 + \\mathrm{GDP} + \\operatorname{max}(a, b) + \\boldsymbol{v} \\cdots \\infty \\pi \\alpha \\beta \\theta \\angle A \\perp B \\parallel C \\triangle ABC \\quad \\,',
      '价格保护：成本 $100 涨到 $200，普通下划线 foo_bar_baz 与 `code_1^2` 以及 https://example.com/path_1 不应转换，但 A_1 与 x^{n+1} 应转换。',
      'XSS 防护：$$\\frac{<script>alert(1)</script>}{\\sqrt{<img src=x onerror=alert(1)>}}$$',
    ].join('\n');

    const html = renderAnalysisHtml(md);
    expect(html).toContain(
      '<mark class="hl-key"><span class="math-frac"><span class="math-num">增量</span><span class="math-den">基期</span></span></mark>',
    );
    expect(html).toContain(
      '<span class="math-frac"><span class="math-num"><mark class="hl-key">总利润</mark></span><span class="math-den"><mark class="hl-key">总营收</mark></span></span>',
    );
    expect(html).toContain(
      '(<span class="math-frac"><span class="math-num">1</span><span class="math-den">1+r</span></span>)<sup class="math-sup">3</sup>',
    );
    expect(html).toContain('GDP');
    expect(html).toContain('max(a, b)');
    expect(html).toContain('… ∞ π α β θ ∠ A ⊥ B ∥ C △ ABC');
    expect(html).toContain('成本 $100 涨到 $200');
    expect(html).toContain('foo_bar_baz');
    expect(html).toContain('<code>code_1^2</code>');
    expect(html).toContain('https://example.com/path_1');
    expect(html).toContain('A<sub class="math-sub">1</sub>');
    expect(html).toContain('x<sup class="math-sup">n+1</sup>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders stem inline formulas via renderStemInlineHtml and flattens fractions in stripLatexMarkup', () => {
    const stemHtml = renderStemInlineHtml(
      '某企业年增长率公式为 \\left(1 + \\frac{r}{100}\\right)^2 - 1，其中 r = \\sqrt{16}，价格 $100 仅作参考，严防 <script>x</script>',
    );
    expect(stemHtml).toContain(
      '(1 + <span class="math-frac"><span class="math-num">r</span><span class="math-den">100</span></span>)<sup class="math-sup">2</sup> - 1',
    );
    expect(stemHtml).toContain(
      '<span class="math-sqrt"><span class="math-sqrt-sign">√</span><span class="math-sqrt-body">16</span></span>',
    );
    expect(stemHtml).toContain('价格 $100');
    expect(stemHtml).not.toContain('<script>');
    expect(stemHtml).toContain('&lt;script&gt;x&lt;/script&gt;');

    expect(
      stripLatexMarkup('$\\color{#FF5555}{\\left(\\frac{总利润}{总营收}\\right)} + \\sqrt{x}$'),
    ).toBe('(总利润/总营收) + √x');
  });
});
