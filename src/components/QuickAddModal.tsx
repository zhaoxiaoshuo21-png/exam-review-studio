import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  FilePenLine,
  ImagePlus,
  Loader2,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  compressImageFile,
  extractClipboardImages,
  stripLatexMarkup,
} from '../core';
import type { QuestionDraftInput } from '../types/contracts';
import type {
  FolderNode,
  MasteryLevel,
  QuestionImage,
  QuestionItem,
  QuestionType,
} from '../types/schema';
import { MarkdownView } from './MarkdownView';

export interface FolderSelectOption {
  id: string;
  label: string;
  depth: number;
  folder: FolderNode;
}

/**
 * 将层级目录树拍平为带缩进前缀的下拉选项列表。
 */
export function buildFolderOptions(folders: FolderNode[]): FolderSelectOption[] {
  const active = folders.filter((f) => !f.deletedAt);
  const byParent = new Map<string | null, FolderNode[]>();

  for (const folder of active) {
    const key = folder.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(folder);
    byParent.set(key, list);
  }

  for (const list of byParent.values()) {
    list.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  const result: FolderSelectOption[] = [];
  const visited = new Set<string>();

  const walk = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    for (const node of children) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      const prefix = depth > 0 ? `${'　'.repeat(depth)}└ ` : '';
      result.push({
        id: node.id,
        label: `${prefix}${node.name}`,
        depth,
        folder: node,
      });
      walk(node.id, depth + 1);
    }
  };

  walk(null, 0);

  for (const node of active) {
    if (!visited.has(node.id)) {
      result.push({
        id: node.id,
        label: node.name,
        depth: 0,
        folder: node,
      });
    }
  }

  return result;
}

/**
 * 批量压缩通过文件选择器或拖拽传入的图片文件。
 */
export async function compressImageFiles(files: FileList | File[]): Promise<QuestionImage[]> {
  const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
  if (imageFiles.length === 0) return [];
  return Promise.all(imageFiles.map((file) => compressImageFile(file)));
}

const TITLE_PREFIX_RE =
  /^(?:第\s*\d+\s*题|[（(\[【]\s*(?:单选|多选|不定项|判断|填空|简答|资料|言语|图推|逻辑)?题?\s*[)）\]】]|(?:单选|多选|不定项)题\s*[:：]?|\d+\s*[.、．)）])\s*/;

/**
 * 从题干或解析正文自动提取干净的短标题：
 * 清洗 LaTeX 与题号前缀，并在自然句读处断句避免生硬切半词。
 */
export function deriveAutoTitle(stemText: string, analysisMarkdown: string): string {
  const cleanLine = (rawLine: string): string => {
    let s = stripLatexMarkup(rawLine)
      .replace(/^#+\s*/, '')
      .replace(/^[>\-*•○]+\s*/, '')
      .replace(/[*=`]/g, '')
      .trim();

    for (let i = 0; i < 3; i += 1) {
      const stripped = s.replace(TITLE_PREFIX_RE, '').trim();
      if (stripped === s) break;
      s = stripped;
    }
    return s;
  };

  const stemLines = stemText
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  let candidate = stemLines[0] ?? '';

  if (!candidate) {
    const analysisLines = analysisMarkdown
      .split(/\r?\n/)
      .map(cleanLine)
      .filter((line) => line && !/^[一二三四五六七八九十百]+[、.]\s*【.+】$/.test(line));
    candidate =
      analysisLines[0] ??
      analysisMarkdown
        .split(/\r?\n/)
        .map(cleanLine)
        .filter(Boolean)[0] ??
      '';
  }

  if (!candidate) return '未命名复盘题';
  if (candidate.length <= 28) return candidate;

  // 优先在 10~28 字范围内按句号/问号/叹号/分号/冒号断句
  const sentenceBreakMatches = Array.from(
    candidate.slice(0, 29).matchAll(/[。？！；：?!:]/g),
  );
  const validSentenceBreak = sentenceBreakMatches.find((m) => (m.index ?? 0) >= 8);
  if (validSentenceBreak && validSentenceBreak.index !== undefined) {
    return candidate.slice(0, validSentenceBreak.index).trim();
  }

  // 其次取 28 字内最后一个自然逗号/顿号（>= 8 字）
  const clauseMatches = Array.from(
    candidate.slice(0, 29).matchAll(/[，,、]/g),
  );
  const lastClauseBreak = [...clauseMatches]
    .reverse()
    .find((m) => (m.index ?? 0) >= 8);
  if (lastClauseBreak && lastClauseBreak.index !== undefined) {
    return candidate.slice(0, lastClauseBreak.index).trim();
  }

  // 若无标点，尽量避开常见虚词/括号中间切半
  const softSearchWindow = candidate.slice(16, 28);
  const boundaryIdx = softSearchWindow.search(/[\s（(的与和及在中]/);
  if (boundaryIdx >= 0) {
    const cutAt = 16 + boundaryIdx + (softSearchWindow[boundaryIdx] === '的' ? 1 : 0);
    return `${candidate.slice(0, cutAt).trim()}…`;
  }

  return `${candidate.slice(0, 26).trim()}…`;
}

const BLOCK_HTML_TAG_RE = /<(?:p|div|li|br|h[1-6])\b/i;

function serializeHtmlNode(
  node: Node,
  listDepth: number,
  inPre: boolean,
): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (inPre) return text;
    return text.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === 'script' || tag === 'style' || tag === 'noscript') {
    return '';
  }

  if (tag === 'br') {
    return '\n';
  }

  if (tag === 'pre') {
    const content = Array.from(el.childNodes)
      .map((child) => serializeHtmlNode(child, listDepth, true))
      .join('');
    return `\n${content.replace(/^\n+|\n+$/g, '')}\n`;
  }

  if (tag === 'ul' || tag === 'ol') {
    const isOrdered = tag === 'ol';
    const startAttr = Number(el.getAttribute('start'));
    let itemNum =
      isOrdered && Number.isFinite(startAttr) && startAttr > 0
        ? Math.floor(startAttr)
        : 1;
    const lines: string[] = [];

    for (const child of Array.from(el.children)) {
      if (child.tagName.toLowerCase() === 'li') {
        const prefix = isOrdered ? `${itemNum}. ` : '- ';
        itemNum += 1;
        const indent = '  '.repeat(listDepth);
        const inlineParts: string[] = [];
        const nestedParts: string[] = [];

        for (const liChild of Array.from(child.childNodes)) {
          if (
            liChild.nodeType === Node.ELEMENT_NODE &&
            ['ul', 'ol'].includes((liChild as HTMLElement).tagName.toLowerCase())
          ) {
            nestedParts.push(serializeHtmlNode(liChild, listDepth + 1, false));
          } else {
            inlineParts.push(serializeHtmlNode(liChild, listDepth + 1, false));
          }
        }

        const leadText = inlineParts
          .join('')
          .replace(/^\s+|\s+$/g, '')
          .replace(/\n{2,}/g, '\n');

        if (leadText) {
          lines.push(`${indent}${prefix}${leadText}`);
        }
        for (const nested of nestedParts) {
          const trimmedNested = nested.replace(/^\n+|\n+$/g, '');
          if (trimmedNested) lines.push(trimmedNested);
        }
      } else {
        const extra = serializeHtmlNode(child, listDepth, false).trim();
        if (extra) lines.push(extra);
      }
    }

    return lines.length > 0 ? `\n${lines.join('\n')}\n` : '';
  }

  const inner = Array.from(el.childNodes)
    .map((child) => serializeHtmlNode(child, listDepth, inPre))
    .join('');

  if (tag === 'p' || /^h[1-6]$/.test(tag) || tag === 'blockquote') {
    const trimmed = inner.trim();
    return trimmed ? `\n${trimmed}\n\n` : '';
  }

  if (
    tag === 'div' ||
    tag === 'section' ||
    tag === 'article' ||
    tag === 'tr' ||
    tag === 'li'
  ) {
    const trimmed = inner.trim();
    return trimmed ? `\n${trimmed}\n` : '';
  }

  if (tag === 'td' || tag === 'th') {
    const trimmed = inner.trim();
    return trimmed ? `${trimmed} ` : '';
  }

  return inner;
}

/**
 * 仅当剪贴板不含图片、`text/plain` 明显丢失了换行（>80字且无换行）
 * 且 `text/html` 含块级标签时，将 HTML 解析为保留结构与换行的干净文本。
 */
export function extractStructuredPasteText(
  clipboardData: DataTransfer | null,
): string | null {
  if (!clipboardData || typeof DOMParser === 'undefined') return null;

  const hasImage =
    Array.from(clipboardData.items ?? []).some(
      (item) => item.kind === 'file' && item.type.startsWith('image/'),
    ) ||
    Array.from(clipboardData.files ?? []).some((file) =>
      file.type.startsWith('image/'),
    );
  if (hasImage) return null;

  const plain = clipboardData.getData('text/plain') ?? '';
  if (plain.includes('\n') || plain.includes('\r')) return null;
  if (plain.trim().length <= 80) return null;

  const html = clipboardData.getData('text/html') ?? '';
  if (!html || !BLOCK_HTML_TAG_RE.test(html)) return null;

  try {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const rawText = serializeHtmlNode(parsed.body, 0, false);
    const cleaned = rawText
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!cleaned || !cleaned.includes('\n')) return null;
    if (cleaned.length < plain.trim().length * 0.2) return null;
    return cleaned;
  } catch {
    return null;
  }
}

export function handleStructuredTextareaPaste(
  e: React.ClipboardEvent<HTMLTextAreaElement>,
  applyNextValue: (nextValue: string) => void,
): void {
  const structured = extractStructuredPasteText(e.clipboardData);
  if (structured === null) return;

  e.preventDefault();
  const target = e.currentTarget;
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  const nextValue =
    target.value.slice(0, start) + structured + target.value.slice(end);

  applyNextValue(nextValue);

  const nextCursor = start + structured.length;
  window.requestAnimationFrame(() => {
    target.selectionStart = nextCursor;
    target.selectionEnd = nextCursor;
  });
}

export interface QuickAddModalProps {
  isOpen: boolean;
  folders: FolderNode[];
  defaultFolderId: string | null;
  editingQuestion: QuestionItem | null;
  onClose: () => void;
  onSave: (draft: QuestionDraftInput) => void;
}

const QUESTION_TYPE_OPTIONS: Array<{ value: QuestionType; label: string }> = [
  { value: 'mistake', label: '错题' },
  { value: 'gem', label: '好题' },
  { value: 'template', label: '经典母题' },
];

const MASTERY_OPTIONS: Array<{ value: MasteryLevel; label: string }> = [
  { value: 'unfamiliar', label: '生疏' },
  { value: 'vague', label: '模糊' },
  { value: 'mastered', label: '已掌握' },
];

export const QuickAddModal: React.FC<QuickAddModalProps> = ({
  isOpen,
  folders,
  defaultFolderId,
  editingQuestion,
  onClose,
  onSave,
}) => {
  const folderOptions = useMemo(() => buildFolderOptions(folders), [folders]);

  const [folderId, setFolderId] = useState('');
  const [questionType, setQuestionType] = useState<QuestionType>('mistake');
  const [mastery, setMastery] = useState<MasteryLevel>('unfamiliar');
  const [starred, setStarred] = useState(false);
  const [title, setTitle] = useState('');
  const [myWrongChoice, setMyWrongChoice] = useState('');
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [stemText, setStemText] = useState('');
  const [analysisMarkdown, setAnalysisMarkdown] = useState('');
  const [personalNote, setPersonalNote] = useState('');
  const [images, setImages] = useState<QuestionImage[]>([]);

  const [analysisTab, setAnalysisTab] = useState<'edit' | 'preview'>('edit');
  const [isDragging, setIsDragging] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const fallbackFolderId =
      (defaultFolderId && folderOptions.some((o) => o.id === defaultFolderId)
        ? defaultFolderId
        : folderOptions[0]?.id) ?? '';

    if (editingQuestion) {
      setFolderId(
        folderOptions.some((o) => o.id === editingQuestion.folderId)
          ? editingQuestion.folderId
          : fallbackFolderId,
      );
      setQuestionType(editingQuestion.questionType);
      setMastery(editingQuestion.mastery);
      setStarred(editingQuestion.starred);
      setTitle(editingQuestion.title);
      setMyWrongChoice(editingQuestion.myWrongChoice ?? '');
      setCorrectAnswer(editingQuestion.correctAnswer ?? '');
      setTagsText(editingQuestion.tags.join(', '));
      setStemText(editingQuestion.stemText);
      setAnalysisMarkdown(editingQuestion.analysisMarkdown);
      setPersonalNote(editingQuestion.personalNote);
      setImages(editingQuestion.images);
    } else {
      setFolderId(fallbackFolderId);
      setQuestionType('mistake');
      setMastery('unfamiliar');
      setStarred(false);
      setTitle('');
      setMyWrongChoice('');
      setCorrectAnswer('');
      setTagsText('');
      setStemText('');
      setAnalysisMarkdown('');
      setPersonalNote('');
      setImages([]);
    }

    setAnalysisTab('edit');
    setIsDragging(false);
    setIsCompressing(false);
    setPasteNotice(null);
    setErrorMsg(null);
  }, [isOpen, editingQuestion, defaultFolderId, folderOptions]);

  // 弹窗打开时全局监听 Ctrl+V 剪贴板图片粘贴
  useEffect(() => {
    if (!isOpen) return;

    const handleWindowPaste = async (e: ClipboardEvent) => {
      const data = e.clipboardData;
      if (!data) return;
      const hasImage =
        Array.from(data.items ?? []).some(
          (item) => item.kind === 'file' && item.type.startsWith('image/'),
        ) || Array.from(data.files ?? []).some((f) => f.type.startsWith('image/'));

      if (!hasImage) return;

      e.preventDefault();
      setIsCompressing(true);
      setErrorMsg(null);
      try {
        const compressed = await extractClipboardImages(data);
        if (compressed.length > 0) {
          setImages((prev) => [...prev, ...compressed]);
          setPasteNotice(`已粘贴并压缩 ${compressed.length} 张原题截图`);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : '剪贴板图片处理失败');
      } finally {
        setIsCompressing(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('paste', handleWindowPaste);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('paste', handleWindowPaste);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!pasteNotice) return;
    const timer = window.setTimeout(() => setPasteNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [pasteNotice]);

  if (!isOpen) return null;

  const appendCompressedFiles = async (files: FileList | File[]) => {
    setIsCompressing(true);
    setErrorMsg(null);
    try {
      const next = await compressImageFiles(files);
      if (next.length > 0) {
        setImages((prev) => [...prev, ...next]);
        setPasteNotice(`已添加并压缩 ${next.length} 张图片`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '图片压缩失败');
    } finally {
      setIsCompressing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await appendCompressedFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await appendCompressedFiles(e.dataTransfer.files);
    }
  };

  const handleRemoveImage = (imageId: string) => {
    setImages((prev) => prev.filter((img) => img.id !== imageId));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderId) {
      setErrorMsg('请先选择一个归属题型目录');
      return;
    }
    if (!stemText.trim() && !analysisMarkdown.trim() && images.length === 0) {
      setErrorMsg('请至少填写原题文本、AI 解析或上传一张原题截图');
      return;
    }

    const parsedTags = Array.from(
      new Set(
        tagsText
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    );

    const resolvedTitle =
      title.trim() || deriveAutoTitle(stemText, analysisMarkdown);

    onSave({
      id: editingQuestion?.id,
      folderId,
      questionType,
      title: resolvedTitle,
      stemText: stemText.trim(),
      images,
      myWrongChoice: myWrongChoice.trim() || undefined,
      correctAnswer: correctAnswer.trim() || undefined,
      analysisMarkdown: analysisMarkdown.trim(),
      personalNote: personalNote.trim(),
      tags: parsedTags,
      mastery,
      starred,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-2 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={editingQuestion ? '编辑题目' : '录入新题'}
    >
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-900/[0.08] bg-white shadow-2xl dark:border-white/[0.07] dark:bg-[#14161B]">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-slate-900/[0.08] px-4 py-3.5 dark:border-white/[0.07] sm:px-6">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-[#181B22] dark:text-[#F5F6FA] sm:text-lg">
              {editingQuestion ? '编辑复盘题目' : '快速录一题'}
            </h2>
            <span className="hidden rounded-md bg-black/[0.045] px-2 py-0.5 text-[11px] font-medium text-[#5B6270] dark:bg-white/[0.06] dark:text-[#949BA8] sm:inline-block">
              弹窗内直接 Ctrl+V 可粘贴截图
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#88909E] transition hover:bg-black/[0.045] hover:text-[#181B22] dark:text-[#656C7A] dark:hover:bg-white/[0.06] dark:hover:text-[#F5F6FA]"
            aria-label="关闭弹窗"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 表单主体 */}
        <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          {errorMsg && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-300">
              {errorMsg}
            </div>
          )}

          {/* 第一排：目录、性质、熟练度、收藏 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                归属题型目录
              </label>
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-900/[0.1] bg-[#F7F6F2] px-2.5 text-sm text-[#181B22] focus:border-slate-900/30 focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:focus:border-white/25"
              >
                {folderOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                题目性质
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-900/[0.08] bg-[#F7F6F2] p-1 dark:border-white/[0.07] dark:bg-[#0D0E11]">
                {QUESTION_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setQuestionType(opt.value)}
                    className={`rounded-md py-1 text-xs font-medium transition ${
                      questionType === opt.value
                        ? 'bg-[#181B22] text-white dark:bg-[#F5F6FA] dark:text-[#0D0E11]'
                        : 'text-[#5B6270] hover:text-[#181B22] dark:text-[#949BA8] dark:hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                初始熟练度
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-900/[0.08] bg-[#F7F6F2] p-1 dark:border-white/[0.07] dark:bg-[#0D0E11]">
                {MASTERY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMastery(opt.value)}
                    className={`rounded-md py-1 text-xs font-medium transition ${
                      mastery === opt.value
                        ? 'bg-[#181B22] text-white dark:bg-[#F5F6FA] dark:text-[#0D0E11]'
                        : 'text-[#5B6270] hover:text-[#181B22] dark:text-[#949BA8] dark:hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setStarred((prev) => !prev)}
                className={`flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition ${
                  starred
                    ? 'border-amber-500/45 bg-amber-50 text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/12 dark:text-amber-300'
                    : 'border-slate-900/[0.08] bg-[#F7F6F2] text-[#5B6270] hover:bg-black/[0.04] dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#949BA8] dark:hover:bg-white/[0.06]'
                }`}
              >
                <Star className={`h-3.5 w-3.5 ${starred ? 'fill-current' : ''}`} />
                {starred ? '已星标收藏' : '加入收藏'}
              </button>
            </div>
          </div>

          {/* 第二排：标题、错选、正解、标签 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="sm:col-span-5">
              <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                标题（可选，留空自动从题干/解析提取）
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：二十大·建设现代化产业体系"
                className="h-9 w-full rounded-lg border border-slate-900/[0.1] bg-[#F7F6F2] px-3 text-sm text-[#181B22] placeholder:text-[#88909E] focus:border-slate-900/30 focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:col-span-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                  错选答案
                </label>
                <input
                  type="text"
                  value={myWrongChoice}
                  onChange={(e) => setMyWrongChoice(e.target.value)}
                  placeholder="如 B"
                  className="h-9 w-full rounded-lg border border-slate-900/[0.1] bg-[#F7F6F2] px-2.5 text-sm text-[#181B22] placeholder:text-[#88909E] focus:border-slate-900/30 focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                  正确答案
                </label>
                <input
                  type="text"
                  value={correctAnswer}
                  onChange={(e) => setCorrectAnswer(e.target.value)}
                  placeholder="如 A"
                  className="h-9 w-full rounded-lg border border-slate-900/[0.1] bg-[#F7F6F2] px-2.5 text-sm text-[#181B22] placeholder:text-[#88909E] focus:border-slate-900/30 focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
                />
              </div>
            </div>

            <div className="sm:col-span-4">
              <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                标签（逗号分隔）
              </label>
              <input
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="如 政治理论, 对称轴, 高频易错"
                className="h-9 w-full rounded-lg border border-slate-900/[0.1] bg-[#F7F6F2] px-3 text-sm text-[#181B22] placeholder:text-[#88909E] focus:border-slate-900/30 focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
              />
            </div>
          </div>

          {/* 原题附图拖拽/粘贴区 */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                原题截图 / 图表（支持全局 Ctrl+V 粘贴、拖拽或选图，自动 WebP 压缩）
              </label>
              {pasteNotice && (
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {pasteNotice}
                </span>
              )}
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`rounded-xl border border-dashed p-3 transition ${
                isDragging
                  ? 'border-[#C93B3B] bg-[#C93B3B]/[0.05] dark:border-[#F06A6A] dark:bg-[#F06A6A]/[0.08]'
                  : 'border-slate-900/[0.14] bg-[#F7F6F2]/80 dark:border-white/[0.1] dark:bg-[#0D0E11]/70'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isCompressing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-900/[0.1] bg-white px-3 py-1.5 text-xs font-medium text-[#181B22] transition hover:bg-slate-50 dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#E6E8EE] dark:hover:bg-[#232730]"
                >
                  {isCompressing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5 text-[#C93B3B] dark:text-[#F06A6A]" />
                  )}
                  选择图片文件
                </button>
                <span className="inline-flex items-center gap-1 text-xs text-[#88909E] dark:text-[#656C7A]">
                  <Upload className="h-3.5 w-3.5" />
                  或直接按 Ctrl+V 粘贴截图 / 拖入图片到这里
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              {images.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {images.map((img, idx) => (
                    <div
                      key={img.id}
                      className="group relative overflow-hidden rounded-lg border border-slate-900/[0.08] bg-white dark:border-white/[0.08] dark:bg-[#14161B]"
                    >
                      <img
                        src={img.dataUrl}
                        alt={img.caption || `原题截图 ${idx + 1}`}
                        className="h-24 w-full bg-white object-contain p-1 dark:bg-[#0D0E11]"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(img.id)}
                        className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-red-600"
                        title="删除该图片"
                        aria-label={`删除图片 ${idx + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <div className="border-t border-slate-900/[0.06] px-2 py-1 text-[10px] text-[#5B6270] dark:border-white/[0.06] dark:text-[#949BA8]">
                        图 {idx + 1} · {img.width}×{img.height}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 原题文本 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
              原题文本（题干与选项，支持直接从刷题网站复制粘贴）
            </label>
            <textarea
              rows={4}
              value={stemText}
              onChange={(e) => setStemText(e.target.value)}
              onPaste={(e) => handleStructuredTextareaPaste(e, setStemText)}
              placeholder="粘贴题干与 A/B/C/D 选项（纯图形推理题可只贴截图，此处简写说明即可）"
              className="w-full rounded-xl border border-slate-900/[0.1] bg-[#F7F6F2] px-3 py-2 text-sm leading-relaxed text-[#181B22] placeholder:text-[#88909E] focus:border-slate-900/30 focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
            />
          </div>

          {/* AI 解析 Markdown（编辑 / 图2预览双标签） */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                AI 解析 Markdown（支持富文本粘贴自动还原换行、`$\color...\textbf$ ` 与 `**重点**`）
              </label>
              <div className="inline-flex rounded-lg border border-slate-900/[0.08] bg-[#F7F6F2] p-0.5 dark:border-white/[0.07] dark:bg-[#0D0E11]">
                <button
                  type="button"
                  onClick={() => setAnalysisTab('edit')}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    analysisTab === 'edit'
                      ? 'bg-white text-[#181B22] shadow-sm dark:bg-[#1E2128] dark:text-[#F5F6FA]'
                      : 'text-[#5B6270] dark:text-[#949BA8]'
                  }`}
                >
                  <FilePenLine className="h-3 w-3" />
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => setAnalysisTab('preview')}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    analysisTab === 'preview'
                      ? 'bg-white text-[#181B22] shadow-sm dark:bg-[#1E2128] dark:text-[#F5F6FA]'
                      : 'text-[#5B6270] dark:text-[#949BA8]'
                  }`}
                >
                  <Eye className="h-3 w-3" />
                  图2效果预览
                </button>
              </div>
            </div>

            {analysisTab === 'edit' ? (
              <textarea
                rows={8}
                value={analysisMarkdown}
                onChange={(e) => setAnalysisMarkdown(e.target.value)}
                onPaste={(e) => handleStructuredTextareaPaste(e, setAnalysisMarkdown)}
                placeholder={'一、【底层核心概念（说人话）】\n...\n\n二、【考场第一反应（应该怎么想）】\n...\n\n三、【实战解题与选项拆解】\n- **核心关键词**：...'}
                className="w-full rounded-xl border border-slate-900/[0.1] bg-[#F7F6F2] px-3 py-2.5 font-mono text-xs leading-relaxed text-[#181B22] placeholder:text-[#88909E] focus:border-slate-900/30 focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
              />
            ) : (
              <div className="min-h-[190px] rounded-xl border border-slate-900/[0.08] bg-[#F7F6F2] p-4 dark:border-white/[0.07] dark:bg-[#0D0E11]">
                <MarkdownView
                  markdown={analysisMarkdown}
                  placeholder="暂无 AI 解析内容，切换回「编辑」标签粘贴或输入 Markdown。"
                />
              </div>
            )}
          </div>

          {/* 个人考场笔记 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
              个人考场笔记（易错坑 / 考场提醒）
            </label>
            <textarea
              rows={2}
              value={personalNote}
              onChange={(e) => setPersonalNote(e.target.value)}
              placeholder="例如：看到“实体经济”先锁定二十大现代化产业体系着力点，别和“创新驱动”混选。"
              className="w-full rounded-xl border border-slate-900/[0.1] bg-[#F7F6F2] px-3 py-2 text-sm text-[#181B22] placeholder:text-[#88909E] focus:border-slate-900/30 focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
            />
          </div>

          {/* 底部提交栏 */}
          <div className="flex items-center justify-end gap-2.5 border-t border-slate-900/[0.08] pt-3 dark:border-white/[0.07]">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-900/[0.1] bg-white px-4 py-2 text-sm font-medium text-[#5B6270] transition hover:bg-black/[0.03] dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#E6E8EE] dark:hover:bg-[#232730]"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isCompressing}
              className="rounded-lg bg-[#181B22] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#2C313D] disabled:opacity-50 dark:bg-[#F5F6FA] dark:text-[#0D0E11] dark:hover:bg-white"
            >
              {editingQuestion ? '保存修改' : '保存到题库'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
