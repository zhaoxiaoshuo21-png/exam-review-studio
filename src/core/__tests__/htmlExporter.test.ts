import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSelfContainedHtmlString,
  createSeedSnapshot,
  exportSelfContainedHtml,
  isViteDevMode,
  parseEmbeddedSnapshotFromHtml,
} from '../index';

const CLOSING_SCRIPT = '<' + '/script>';

describe('htmlExporter', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('builds self-contained HTML with cleared #root, preserved assets, and escaped JSON', () => {
    const seed = createSeedSnapshot();
    seed.questions[0].personalNote = `包含危险闭合标签 ${CLOSING_SCRIPT} 和 <img src=x>`;

    const baseHtml = [
      '<!doctype html>',
      '<html lang="zh-CN" class="dark">',
      '<head><style>body { background: #111214; }</style></head>',
      '<body>',
      '<div id="root"><div>已渲染的旧 DOM</div></div>',
      '<script id="EXAM_REVIEW_EMBEDDED_DATA" type="application/json">null' + CLOSING_SCRIPT,
      '<script type="module">window.__APP_LOADED__ = true;' + CLOSING_SCRIPT,
      '</body>',
      '</html>',
    ].join('\n');

    const output = buildSelfContainedHtmlString(baseHtml, seed);

    expect(output.toLowerCase()).toMatch(/^<!doctype html>/);
    expect(output).toContain('<div id="root"></div>');
    expect(output).not.toContain('已渲染的旧 DOM');
    expect(output).toContain('body { background: #111214; }');
    expect(output).toContain('window.__APP_LOADED__ = true;');
    expect(output).toContain('\\u003c/script\\u003e');
    expect(output).not.toContain(`包含危险闭合标签 ${CLOSING_SCRIPT}`);

    const parsedBack = parseEmbeddedSnapshotFromHtml(output);
    expect(parsedBack).not.toBeNull();
    expect(parsedBack?.questions[0].personalNote).toBe(
      `包含危险闭合标签 ${CLOSING_SCRIPT} 和 <img src=x>`,
    );
    expect(parsedBack?.questions).toHaveLength(2);
  });

  it('inserts EXAM_REVIEW_EMBEDDED_DATA when missing and toggles light/dark theme class', () => {
    const seed = createSeedSnapshot();
    seed.theme = 'light';

    const minimalHtml =
      '<!doctype html><html lang="zh-CN" class="dark"><head></head><body><div id="root">x</div><script type="module">1' +
      CLOSING_SCRIPT +
      '</body></html>';

    const output = buildSelfContainedHtmlString(minimalHtml, seed);
    expect(output).not.toContain('<html lang="zh-CN" class="dark"');
    const parsedBack = parseEmbeddedSnapshotFromHtml(output);
    expect(parsedBack?.theme).toBe('light');
  });

  it('detects Vite dev mode and blocks HTML export with guidance message', () => {
    const devScript = document.createElement('script');
    devScript.type = 'module';
    devScript.src = '/src/main.tsx';
    document.body.appendChild(devScript);

    expect(isViteDevMode()).toBe(true);

    const seed = createSeedSnapshot();
    const res = exportSelfContainedHtml(seed);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('npm run build');
  });

  it('exports self-contained HTML and triggers download outside Vite dev mode', () => {
    document.body.innerHTML =
      '<div id="root"><span>live</span></div>' +
      '<script id="EXAM_REVIEW_EMBEDDED_DATA" type="application/json">null' +
      CLOSING_SCRIPT;

    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const seed = createSeedSnapshot();
    const res = exportSelfContainedHtml(seed, 'custom-export.html');

    expect(res.ok).toBe(true);
    expect(res.sizeBytes).toBeGreaterThan(200);
    expect(res.html).toContain('<div id="root"></div>');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const roundTrip = parseEmbeddedSnapshotFromHtml(res.html!);
    expect(roundTrip?.questions).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it('losslessly round-trips material questions with subQuestions and sub-images through self-contained HTML', () => {
    const seed = createSeedSnapshot();
    seed.questions.push({
      ...seed.questions[0],
      id: 'mat-export-1',
      entryKind: 'material',
      title: '一拖五判断推理组合题',
      stemText: '给定共用逻辑约束条件',
      subQuestions: [
        {
          id: 'sub-a',
          label: '第1题',
          stemText: '小题1题干\nA. 甲\nB. 乙',
          images: [
            {
              id: 'sub-a-img',
              dataUrl: 'data:image/png;base64,c3ViQQ==',
              width: 400,
              height: 220,
            },
          ],
          correctAnswer: 'A',
          analysisMarkdown: '包含安全边界 </script> 与 $\\frac{1}{2}$',
        },
      ],
      isSeedDemo: false,
    });

    const baseHtml =
      '<!doctype html><html lang="zh-CN" class="dark"><head></head><body><div id="root"></div><script id="EXAM_REVIEW_EMBEDDED_DATA" type="application/json">null' +
      CLOSING_SCRIPT +
      '</body></html>';

    const exportedHtml = buildSelfContainedHtmlString(baseHtml, seed);
    const restored = parseEmbeddedSnapshotFromHtml(exportedHtml);
    const mat = restored?.questions.find((q) => q.id === 'mat-export-1');

    expect(mat?.entryKind).toBe('material');
    expect(mat?.subQuestions).toHaveLength(1);
    expect(mat?.subQuestions?.[0].images[0].dataUrl).toBe('data:image/png;base64,c3ViQQ==');
    expect(mat?.subQuestions?.[0].analysisMarkdown).toBe(
      '包含安全边界 </script> 与 $\\frac{1}{2}$',
    );
  });
});
