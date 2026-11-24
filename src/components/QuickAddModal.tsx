import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  FilePenLine,
  ImagePlus,
  Layers,
  Loader2,
  Plus,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  compressImageFile,
  extractClipboardImages,
  extractCorrectAnswer,
  parseMaterialPack,
  stripLatexMarkup,
} from '../core';
import type { QuestionDraftInput } from '../types/contracts';
import type {
  FolderNode,
  MasteryLevel,
  QuestionEntryKind,
  QuestionImage,
  QuestionItem,
  QuestionType,
  SubQuestionItem,
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

  const sentenceBreakMatches = Array.from(
    candidate.slice(0, 29).matchAll(/[。？！；：?!:]/g),
  );
  const validSentenceBreak = sentenceBreakMatches.find((m) => (m.index ?? 0) >= 8);
  if (validSentenceBreak && validSentenceBreak.index !== undefined) {
    return candidate.slice(0, validSentenceBreak.index).trim();
  }

  const clauseMatches = Array.from(
    candidate.slice(0, 29).matchAll(/[，,、]/g),
  );
  const lastClauseBreak = [...clauseMatches]
    .reverse()
    .find((m) => (m.index ?? 0) >= 8);
  if (lastClauseBreak && lastClauseBreak.index !== undefined) {
    return candidate.slice(0, lastClauseBreak.index).trim();
  }

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

export interface ImageDropZoneProps {
  label: string;
  images: QuestionImage[];
  isCompressing: boolean;
  isPasteTarget?: boolean;
  showPasteTargetControl?: boolean;
  hintText?: string;
  onActivatePasteTarget?: () => void;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveImage: (imageId: string) => void;
}

export const ImageDropZone: React.FC<ImageDropZoneProps> = ({
  label,
  images,
  isCompressing,
  isPasteTarget = false,
  showPasteTargetControl = false,
  hintText = '或直接按 Ctrl+V 粘贴截图 / 拖入图片到这里',
  onActivatePasteTarget,
  onAddFiles,
  onRemoveImage,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
            {label}
          </label>
          {showPasteTargetControl && (
            isPasteTarget ? (
              <span className="rounded-full bg-[#C93B3B]/12 px-2 py-0.5 text-[10px] font-semibold text-[#C93B3B] dark:bg-[#F06A6A]/18 dark:text-[#F06A6A]">
                当前 Ctrl+V 贴图目标
              </span>
            ) : (
              <button
                type="button"
                onClick={onActivatePasteTarget}
                className="rounded-full border border-slate-900/[0.1] bg-white px-2 py-0.5 text-[10px] font-medium text-[#5B6270] hover:border-slate-900/25 hover:text-[#181B22] dark:border-white/[0.1] dark:bg-[#1B1E25] dark:text-[#949BA8] dark:hover:text-white"
              >
                激活 Ctrl+V 贴此区
              </button>
            )
          )}
        </div>
      </div>

      <div
        onClick={() => onActivatePasteTarget?.()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          onActivatePasteTarget?.();
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onAddFiles(e.dataTransfer.files);
          }
        }}
        className={`rounded-xl border border-dashed p-3 transition ${
          isDragging || isPasteTarget
            ? 'border-[#C93B3B]/70 bg-[#C93B3B]/[0.03] dark:border-[#F06A6A]/65 dark:bg-[#F06A6A]/[0.05]'
            : 'border-slate-900/[0.14] bg-[#F7F6F2]/80 dark:border-white/[0.1] dark:bg-[#0D0E11]/70'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onActivatePasteTarget?.();
              inputRef.current?.click();
            }}
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
            {hintText}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onAddFiles(e.target.files);
                e.target.value = '';
              }
            }}
            className="hidden"
          />
        </div>

        {images.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {images.map((img, idx) => (
              <div
                key={img.id}
                onClick={(e) => e.stopPropagation()}
                className="group relative overflow-hidden rounded-lg border border-slate-900/[0.08] bg-white dark:border-white/[0.08] dark:bg-[#14161B]"
              >
                <img
                  src={img.dataUrl}
                  alt={img.caption || `附图 ${idx + 1}`}
                  className="h-24 w-full bg-white object-contain p-1 dark:bg-[#0D0E11]"
                />
                <button
                  type="button"
                  onClick={() => onRemoveImage(img.id)}
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
  );
};

function makeSubId(): string {
  return `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function createEmptySubQuestion(index: number): SubQuestionItem {
  return {
    id: makeSubId(),
    label: `第${index}题`,
    stemText: '',
    images: [],
    myWrongChoice: '',
    correctAnswer: '',
    analysisMarkdown: '',
    personalNote: '',
  };
}

function isDataAnalysisFolder(folders: FolderNode[], folderId: string): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let curr = byId.get(folderId);
  const visited = new Set<string>();
  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    if (curr.name.includes('资料')) return true;
    curr = curr.parentId ? byId.get(curr.parentId) : undefined;
  }
  return false;
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
  const [entryKind, setEntryKind] = useState<QuestionEntryKind>('single');
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

  // 材料组合题（一拖N）状态
  const [subQuestions, setSubQuestions] = useState<SubQuestionItem[]>([]);
  const [activeSubId, setActiveSubId] = useState<string>('');
  const [pasteTarget, setPasteTarget] = useState<'material' | string>('material');
  const [isPackSplitterOpen, setIsPackSplitterOpen] = useState(false);
  const [packRawText, setPackRawText] = useState('');
  const [subAnalysisTab, setSubAnalysisTab] = useState<'edit' | 'preview'>('edit');

  const [analysisTab, setAnalysisTab] = useState<'edit' | 'preview'>('edit');
  const [isCompressing, setIsCompressing] = useState(false);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const autoDetectedAnswer = useMemo(
    () => extractCorrectAnswer(analysisMarkdown) ?? '',
    [analysisMarkdown],
  );

  const activeSub = useMemo(
    () => subQuestions.find((s) => s.id === activeSubId) ?? subQuestions[0] ?? null,
    [subQuestions, activeSubId],
  );

  const activeSubAutoAnswer = useMemo(
    () => (activeSub ? extractCorrectAnswer(activeSub.analysisMarkdown) ?? '' : ''),
    [activeSub],
  );

  const showDataAnalysisHint = useMemo(
    () => entryKind === 'single' && isDataAnalysisFolder(folders, folderId),
    [entryKind, folders, folderId],
  );

  useEffect(() => {
    if (!isOpen) return;

    const fallbackFolderId =
      (defaultFolderId && folderOptions.some((o) => o.id === defaultFolderId)
        ? defaultFolderId
        : folderOptions[0]?.id) ?? '';

    if (editingQuestion) {
      const isMat =
        editingQuestion.entryKind === 'material' ||
        (editingQuestion.subQuestions?.length ?? 0) > 0;
      const initialSubs =
        isMat && editingQuestion.subQuestions && editingQuestion.subQuestions.length > 0
          ? editingQuestion.subQuestions.map((s) => ({
              ...s,
              images: [...(s.images ?? [])],
              personalNote: s.personalNote ?? '',
            }))
          : [createEmptySubQuestion(1), createEmptySubQuestion(2)];

      setFolderId(
        folderOptions.some((o) => o.id === editingQuestion.folderId)
          ? editingQuestion.folderId
          : fallbackFolderId,
      );
      setQuestionType(editingQuestion.questionType);
      setEntryKind(isMat ? 'material' : 'single');
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
      setSubQuestions(initialSubs);
      setActiveSubId(initialSubs[0]?.id ?? '');
    } else {
      const initialSubs = [createEmptySubQuestion(1), createEmptySubQuestion(2)];
      setFolderId(fallbackFolderId);
      setQuestionType('mistake');
      setEntryKind('single');
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
      setSubQuestions(initialSubs);
      setActiveSubId(initialSubs[0].id);
    }

    setPasteTarget('material');
    setIsPackSplitterOpen(false);
    setPackRawText('');
    setSubAnalysisTab('edit');
    setAnalysisTab('edit');
    setIsCompressing(false);
    setPasteNotice(null);
    setErrorMsg(null);
  }, [isOpen, editingQuestion, defaultFolderId, folderOptions]);

  // 弹窗打开时全局监听 Ctrl+V 剪贴板图片粘贴，依据 pasteTarget 准确落入对应附图区
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
          if (entryKind === 'single' || pasteTarget === 'material') {
            setImages((prev) => [...prev, ...compressed]);
            setPasteNotice(
              entryKind === 'material'
                ? `已粘贴并压缩 ${compressed.length} 张共用材料配图`
                : `已粘贴并压缩 ${compressed.length} 张原题截图`,
            );
          } else {
            const targetSub =
              subQuestions.find((s) => s.id === pasteTarget) ??
              subQuestions.find((s) => s.id === activeSubId) ??
              subQuestions[0];
            if (targetSub) {
              setSubQuestions((prev) =>
                prev.map((s) =>
                  s.id === targetSub.id
                    ? { ...s, images: [...s.images, ...compressed] }
                    : s,
                ),
              );
              setPasteNotice(
                `已给「${targetSub.label || '当前小题'}」粘贴 ${compressed.length} 张专属截图`,
              );
            }
          }
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
  }, [isOpen, entryKind, pasteTarget, subQuestions, activeSubId, onClose]);

  useEffect(() => {
    if (!pasteNotice) return;
    const timer = window.setTimeout(() => setPasteNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [pasteNotice]);

  if (!isOpen) return null;

  const switchEntryKind = (nextKind: QuestionEntryKind) => {
    setEntryKind(nextKind);
    setErrorMsg(null);
    if (nextKind === 'material') {
      if (subQuestions.length === 0) {
        const fresh = [createEmptySubQuestion(1), createEmptySubQuestion(2)];
        setSubQuestions(fresh);
        setActiveSubId(fresh[0].id);
      } else if (!subQuestions.some((s) => s.id === activeSubId)) {
        setActiveSubId(subQuestions[0].id);
      }
      setPasteTarget('material');
    }
  };

  const appendFilesToMain = async (files: FileList | File[]) => {
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

  const appendFilesToSub = async (subId: string, files: FileList | File[]) => {
    setIsCompressing(true);
    setErrorMsg(null);
    try {
      const next = await compressImageFiles(files);
      if (next.length > 0) {
        setSubQuestions((prev) =>
          prev.map((s) =>
            s.id === subId ? { ...s, images: [...s.images, ...next] } : s,
          ),
        );
        setPasteNotice(`已添加并压缩 ${next.length} 张小题截图`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '图片压缩失败');
    } finally {
      setIsCompressing(false);
    }
  };

  const updateActiveSub = (patch: Partial<SubQuestionItem>) => {
    if (!activeSub) return;
    setSubQuestions((prev) =>
      prev.map((s) => (s.id === activeSub.id ? { ...s, ...patch } : s)),
    );
  };

  const handleAddSubQuestion = () => {
    const nextItem = createEmptySubQuestion(subQuestions.length + 1);
    setSubQuestions((prev) => [...prev, nextItem]);
    setActiveSubId(nextItem.id);
    if (pasteTarget !== 'material') {
      setPasteTarget(nextItem.id);
    }
    setSubAnalysisTab('edit');
  };

  const handleDeleteSubQuestion = (subId: string) => {
    if (subQuestions.length <= 1) return;
    const idx = subQuestions.findIndex((s) => s.id === subId);
    const remaining = subQuestions.filter((s) => s.id !== subId);
    setSubQuestions(remaining);
    const fallbackSub = remaining[Math.max(0, idx - 1)] ?? remaining[0];
    setActiveSubId(fallbackSub.id);
    if (pasteTarget === subId) {
      setPasteTarget(fallbackSub.id);
    }
  };

  const handleSplitMaterialPack = () => {
    if (!packRawText.trim()) return;
    const packed = parseMaterialPack(packRawText);
    if (packed.materialStemText.trim()) {
      setStemText(packed.materialStemText.trim());
    }
    if (packed.subItems.length > 0) {
      const mapped: SubQuestionItem[] = packed.subItems.map((item, idx) => ({
        id: makeSubId(),
        label: item.indexLabel || `第${idx + 1}题`,
        stemText: item.stemText,
        images: [...(item.images ?? [])],
        myWrongChoice: '',
        correctAnswer:
          item.correctAnswer || extractCorrectAnswer(item.analysisMarkdown) || '',
        analysisMarkdown: item.analysisMarkdown,
        personalNote: '',
      }));
      setSubQuestions(mapped);
      setActiveSubId(mapped[0].id);
      setPasteNotice(
        `已自动拆出${packed.materialStemText ? '共用材料与 ' : ''}${mapped.length} 道小题`,
      );
      setIsPackSplitterOpen(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderId) {
      setErrorMsg('请先选择一个归属题型目录');
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

    if (entryKind === 'material') {
      const cleanedSubs: SubQuestionItem[] = subQuestions
        .map((sub, idx) => {
          const autoAns = extractCorrectAnswer(sub.analysisMarkdown) ?? '';
          const finalAns =
            sub.correctAnswer?.trim().toUpperCase() || autoAns || undefined;
          const finalWrong =
            sub.myWrongChoice?.trim().toUpperCase() || undefined;
          return {
            id: sub.id || makeSubId(),
            label: sub.label?.trim() || `第${idx + 1}题`,
            stemText: sub.stemText.trim(),
            images: sub.images,
            myWrongChoice: finalWrong,
            correctAnswer: finalAns,
            analysisMarkdown: sub.analysisMarkdown.trim(),
            personalNote: sub.personalNote?.trim() || '',
          };
        })
        .filter(
          (sub) =>
            sub.stemText ||
            sub.analysisMarkdown ||
            sub.images.length > 0 ||
            sub.personalNote,
        );

      if (cleanedSubs.length === 0) {
        setErrorMsg('材料组合题至少需要填写 1 道有效小题的题干、解析或截图');
        return;
      }

      if (!stemText.trim() && images.length === 0 && cleanedSubs.length === 0) {
        setErrorMsg('请填写共用材料内容或至少 1 道小题');
        return;
      }

      const resolvedTitle =
        title.trim() ||
        deriveAutoTitle(
          stemText || cleanedSubs[0]?.stemText || '',
          cleanedSubs[0]?.analysisMarkdown || '',
        );

      onSave({
        id: editingQuestion?.id,
        folderId,
        questionType,
        entryKind: 'material',
        title: resolvedTitle,
        stemText: stemText.trim(),
        images,
        subQuestions: cleanedSubs,
        analysisMarkdown: '',
        personalNote: '',
        tags: parsedTags,
        mastery,
        starred,
      });
      return;
    }

    if (!stemText.trim() && !analysisMarkdown.trim() && images.length === 0) {
      setErrorMsg('请至少填写原题文本、AI 解析或上传一张原题截图');
      return;
    }

    const resolvedTitle =
      title.trim() || deriveAutoTitle(stemText, analysisMarkdown);

    const finalCorrect =
      correctAnswer.trim().toUpperCase() || autoDetectedAnswer || undefined;
    const finalWrong = myWrongChoice.trim().toUpperCase() || undefined;

    onSave({
      id: editingQuestion?.id,
      folderId,
      questionType,
      entryKind: 'single',
      title: resolvedTitle,
      stemText: stemText.trim(),
      images,
      myWrongChoice: finalWrong,
      correctAnswer: finalCorrect,
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

          {/* 题型结构自选栏 */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-slate-900/[0.08] bg-[#F7F6F2]/80 px-3 py-2.5 dark:border-white/[0.07] dark:bg-[#0D0E11]/75">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#181B22] dark:text-[#E6E8EE]">
                <Layers className="h-3.5 w-3.5 text-[#C93B3B] dark:text-[#F06A6A]" />
                题型结构
              </span>
              <div className="inline-flex rounded-lg border border-slate-900/[0.08] bg-white p-0.5 dark:border-white/[0.08] dark:bg-[#14161B]">
                <button
                  type="button"
                  onClick={() => switchEntryKind('single')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                    entryKind === 'single'
                      ? 'bg-[#181B22] text-white dark:bg-[#F5F6FA] dark:text-[#0D0E11]'
                      : 'text-[#5B6270] hover:text-[#181B22] dark:text-[#949BA8] dark:hover:text-white'
                  }`}
                >
                  普通单题
                </button>
                <button
                  type="button"
                  onClick={() => switchEntryKind('material')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                    entryKind === 'material'
                      ? 'bg-[#181B22] text-white dark:bg-[#F5F6FA] dark:text-[#0D0E11]'
                      : 'text-[#5B6270] hover:text-[#181B22] dark:text-[#949BA8] dark:hover:text-white'
                  }`}
                >
                  材料组合题（一拖N）
                </button>
              </div>
              {showDataAnalysisHint && (
                <button
                  type="button"
                  onClick={() => switchEntryKind('material')}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 transition hover:bg-amber-500/20 dark:bg-amber-400/12 dark:text-amber-300"
                >
                  <Sparkles className="h-3 w-3" />
                  资料分析一拖五？可切「材料组合题」
                </button>
              )}
            </div>

            {pasteNotice && (
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {pasteNotice}
              </span>
            )}
          </div>

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

          {entryKind === 'single' ? (
            <>
              {/* 单题：标题、错选、正解、标签 */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                <div className="sm:col-span-4">
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

                <div className="grid grid-cols-2 gap-2 sm:col-span-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                      错选答案
                    </label>
                    <input
                      type="text"
                      value={myWrongChoice}
                      onChange={(e) => setMyWrongChoice(e.target.value)}
                      placeholder="可选，复盘时直接点击左栏选项即可自测"
                      className="h-9 w-full rounded-lg border border-slate-900/[0.1] bg-[#F7F6F2] px-2.5 text-sm text-[#181B22] placeholder:text-[#88909E] focus:border-slate-900/30 focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <label className="text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                        正确答案
                      </label>
                      {autoDetectedAnswer && !correctAnswer.trim() && (
                        <span className="rounded bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                          自动识别: {autoDetectedAnswer}
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={correctAnswer}
                      onChange={(e) => setCorrectAnswer(e.target.value)}
                      placeholder={
                        autoDetectedAnswer
                          ? `已从解析自动识别：${autoDetectedAnswer}（可留空）`
                          : '留空将自动从 AI 解析提取'
                      }
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

              <ImageDropZone
                label="原题截图 / 图表（支持全局 Ctrl+V 粘贴、拖拽或选图，自动 WebP 压缩）"
                images={images}
                isCompressing={isCompressing}
                onAddFiles={appendFilesToMain}
                onRemoveImage={(id) =>
                  setImages((prev) => prev.filter((img) => img.id !== id))
                }
              />

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

              {/* AI 解析 Markdown */}
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
            </>
          ) : (
            <>
              {/* 材料组合题：套题标题与标签 */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                <div className="sm:col-span-7">
                  <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                    套题总标题（可选，留空自动从共用材料或第1题提取）
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="例如：2025年某行业营收利润资料分析（一拖五）"
                    className="h-9 w-full rounded-lg border border-slate-900/[0.1] bg-[#F7F6F2] px-3 text-sm text-[#181B22] placeholder:text-[#88909E] focus:border-slate-900/30 focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
                  />
                </div>
                <div className="sm:col-span-5">
                  <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                    标签（逗号分隔）
                  </label>
                  <input
                    type="text"
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder="如 资料分析, 综合分析, 一拖五"
                    className="h-9 w-full rounded-lg border border-slate-900/[0.1] bg-[#F7F6F2] px-3 text-sm text-[#181B22] placeholder:text-[#88909E] focus:border-slate-900/30 focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
                  />
                </div>
              </div>

              {/* A. 共用大材料区 */}
              <section className="space-y-3 rounded-xl border border-slate-900/[0.08] bg-[#F7F6F2]/55 p-3.5 dark:border-white/[0.07] dark:bg-[#0D0E11]/55">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#181B22] dark:text-[#F5F6FA]">
                    A. 共用大材料区（供下方所有小题共用）
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsPackSplitterOpen((prev) => !prev)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-900/[0.1] bg-white px-2.5 py-1 text-[11px] font-medium text-[#181B22] transition hover:bg-slate-50 dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#E6E8EE]"
                  >
                    <Sparkles className="h-3 w-3 text-[#C93B3B] dark:text-[#F06A6A]" />
                    从整篇长文一键拆出材料与小题
                    {isPackSplitterOpen ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </button>
                </div>

                {isPackSplitterOpen && (
                  <div className="space-y-2 rounded-xl border border-slate-900/[0.1] bg-white p-3 dark:border-white/[0.08] dark:bg-[#14161B]">
                    <p className="text-[11px] text-[#5B6270] dark:text-[#949BA8]">
                      粘贴包含「【材料】… 第1题 … 第2题 …」的整篇长文，点击按钮自动填充上方共用材料与下方第 1~N 小题：
                    </p>
                    <textarea
                      rows={5}
                      value={packRawText}
                      onChange={(e) => setPackRawText(e.target.value)}
                      onPaste={(e) => handleStructuredTextareaPaste(e, setPackRawText)}
                      placeholder={'【材料】2025年某行业...\n\n第1题\n...\n\n第2题\n...'}
                      className="w-full rounded-lg border border-slate-900/[0.1] bg-[#F7F6F2] px-3 py-2 font-mono text-xs text-[#181B22] focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE]"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsPackSplitterOpen(false)}
                        className="rounded-lg border border-slate-900/[0.1] px-3 py-1 text-xs text-[#5B6270] dark:border-white/[0.08] dark:text-[#949BA8]"
                      >
                        收起
                      </button>
                      <button
                        type="button"
                        disabled={!packRawText.trim()}
                        onClick={handleSplitMaterialPack}
                        className="rounded-lg bg-[#181B22] px-3 py-1 text-xs font-semibold text-white disabled:opacity-45 dark:bg-[#F5F6FA] dark:text-[#0D0E11]"
                      >
                        一键拆入材料与小题
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                    共用材料文本（背景文字 / 统计口径说明）
                  </label>
                  <textarea
                    rows={4}
                    value={stemText}
                    onChange={(e) => setStemText(e.target.value)}
                    onPaste={(e) => handleStructuredTextareaPaste(e, setStemText)}
                    placeholder="粘贴文字材料正文（纯统计图表材料可只传下方材料图片）"
                    className="w-full rounded-xl border border-slate-900/[0.1] bg-white px-3 py-2 text-sm leading-relaxed text-[#181B22] placeholder:text-[#88909E] focus:border-slate-900/30 focus:outline-none dark:border-white/[0.08] dark:bg-[#14161B] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
                  />
                </div>

                <ImageDropZone
                  label="共用材料截图 / 统计图表（柱状图 / 折线图 / 表格，支持多图）"
                  images={images}
                  isCompressing={isCompressing}
                  showPasteTargetControl
                  isPasteTarget={pasteTarget === 'material'}
                  onActivatePasteTarget={() => setPasteTarget('material')}
                  onAddFiles={appendFilesToMain}
                  onRemoveImage={(id) =>
                    setImages((prev) => prev.filter((img) => img.id !== id))
                  }
                />
              </section>

              {/* B. 小题管理区 */}
              <section className="space-y-3 rounded-xl border border-slate-900/[0.08] bg-[#F7F6F2]/55 p-3.5 dark:border-white/[0.07] dark:bg-[#0D0E11]/55">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#181B22] dark:text-[#F5F6FA]">
                    B. 小题管理区（共 {subQuestions.length} 小题）
                  </span>
                  {activeSub && subQuestions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeleteSubQuestion(activeSub.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:bg-[#14161B] dark:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                      删除当前小题
                    </button>
                  )}
                </div>

                {/* 小题标签切换条 */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {subQuestions.map((sub, idx) => {
                    const isActive = activeSub?.id === sub.id;
                    const ans =
                      sub.correctAnswer?.trim() ||
                      extractCorrectAnswer(sub.analysisMarkdown) ||
                      '';
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => {
                          setActiveSubId(sub.id);
                          setSubAnalysisTab('edit');
                          if (pasteTarget !== 'material') {
                            setPasteTarget(sub.id);
                          }
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                          isActive
                            ? 'border-[#181B22] bg-[#181B22] text-white dark:border-[#F5F6FA] dark:bg-[#F5F6FA] dark:text-[#0D0E11]'
                            : 'border-slate-900/[0.1] bg-white text-[#5B6270] hover:text-[#181B22] dark:border-white/[0.08] dark:bg-[#14161B] dark:text-[#949BA8] dark:hover:text-white'
                        }`}
                      >
                        <span>{sub.label?.trim() || `第${idx + 1}题`}</span>
                        {ans && (
                          <span
                            className={`text-[10px] ${
                              isActive
                                ? 'text-emerald-300 dark:text-emerald-700'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {ans}
                          </span>
                        )}
                        {sub.images.length > 0 && (
                          <span className="text-[10px] opacity-75">
                            · {sub.images.length}图
                          </span>
                        )}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={handleAddSubQuestion}
                    className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-900/20 px-2.5 py-1 text-xs font-medium text-[#5B6270] transition hover:border-slate-900/40 hover:text-[#181B22] dark:border-white/20 dark:text-[#949BA8] dark:hover:border-white/40 dark:hover:text-white"
                  >
                    <Plus className="h-3 w-3" />
                    添加小题
                  </button>
                </div>

                {/* 当前小题编辑表单 */}
                {activeSub && (
                  <div className="space-y-3 rounded-xl border border-slate-900/[0.08] bg-white p-3.5 dark:border-white/[0.07] dark:bg-[#14161B]">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                      <div className="sm:col-span-4">
                        <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                          小题标签
                        </label>
                        <input
                          type="text"
                          value={activeSub.label ?? ''}
                          onChange={(e) => updateActiveSub({ label: e.target.value })}
                          placeholder="如 第1题"
                          className="h-9 w-full rounded-lg border border-slate-900/[0.1] bg-[#F7F6F2] px-2.5 text-sm text-[#181B22] focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE]"
                        />
                      </div>

                      <div className="sm:col-span-4">
                        <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                          错选答案
                        </label>
                        <input
                          type="text"
                          value={activeSub.myWrongChoice ?? ''}
                          onChange={(e) =>
                            updateActiveSub({ myWrongChoice: e.target.value })
                          }
                          placeholder="可选，复盘时直接点击左栏选项即可自测"
                          className="h-9 w-full rounded-lg border border-slate-900/[0.1] bg-[#F7F6F2] px-2.5 text-sm text-[#181B22] placeholder:text-[#88909E] focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
                        />
                      </div>

                      <div className="sm:col-span-4">
                        <div className="mb-1 flex items-center justify-between gap-1">
                          <label className="text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                            正确答案
                          </label>
                          {activeSubAutoAnswer && !activeSub.correctAnswer?.trim() && (
                            <span className="rounded bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                              自动识别: {activeSubAutoAnswer}
                            </span>
                          )}
                        </div>
                        <input
                          type="text"
                          value={activeSub.correctAnswer ?? ''}
                          onChange={(e) =>
                            updateActiveSub({ correctAnswer: e.target.value })
                          }
                          placeholder={
                            activeSubAutoAnswer
                              ? `已从解析自动识别：${activeSubAutoAnswer}（可留空）`
                              : '留空将自动从小题解析提取'
                          }
                          className="h-9 w-full rounded-lg border border-slate-900/[0.1] bg-[#F7F6F2] px-2.5 text-sm text-[#181B22] placeholder:text-[#88909E] focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                        小题题干与 A/B/C/D 选项
                      </label>
                      <textarea
                        rows={4}
                        value={activeSub.stemText}
                        onChange={(e) => updateActiveSub({ stemText: e.target.value })}
                        onPaste={(e) =>
                          handleStructuredTextareaPaste(e, (nextVal) =>
                            updateActiveSub({ stemText: nextVal }),
                          )
                        }
                        placeholder="粘贴该小题题干与 A/B/C/D 选项"
                        className="w-full rounded-xl border border-slate-900/[0.1] bg-[#F7F6F2] px-3 py-2 text-sm leading-relaxed text-[#181B22] placeholder:text-[#88909E] focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
                      />
                    </div>

                    <ImageDropZone
                      label={`「${activeSub.label || '当前小题'}」专属截图（可选，与共用材料图独立）`}
                      images={activeSub.images}
                      isCompressing={isCompressing}
                      showPasteTargetControl
                      isPasteTarget={pasteTarget === activeSub.id}
                      onActivatePasteTarget={() => setPasteTarget(activeSub.id)}
                      onAddFiles={(files) => appendFilesToSub(activeSub.id, files)}
                      onRemoveImage={(imgId) =>
                        updateActiveSub({
                          images: activeSub.images.filter((img) => img.id !== imgId),
                        })
                      }
                    />

                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label className="text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                          小题 AI 解析 Markdown
                        </label>
                        <div className="inline-flex rounded-lg border border-slate-900/[0.08] bg-[#F7F6F2] p-0.5 dark:border-white/[0.07] dark:bg-[#0D0E11]">
                          <button
                            type="button"
                            onClick={() => setSubAnalysisTab('edit')}
                            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                              subAnalysisTab === 'edit'
                                ? 'bg-white text-[#181B22] shadow-sm dark:bg-[#1E2128] dark:text-[#F5F6FA]'
                                : 'text-[#5B6270] dark:text-[#949BA8]'
                            }`}
                          >
                            <FilePenLine className="h-3 w-3" />
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={() => setSubAnalysisTab('preview')}
                            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                              subAnalysisTab === 'preview'
                                ? 'bg-white text-[#181B22] shadow-sm dark:bg-[#1E2128] dark:text-[#F5F6FA]'
                                : 'text-[#5B6270] dark:text-[#949BA8]'
                            }`}
                          >
                            <Eye className="h-3 w-3" />
                            图2效果预览
                          </button>
                        </div>
                      </div>

                      {subAnalysisTab === 'edit' ? (
                        <textarea
                          rows={6}
                          value={activeSub.analysisMarkdown}
                          onChange={(e) =>
                            updateActiveSub({ analysisMarkdown: e.target.value })
                          }
                          onPaste={(e) =>
                            handleStructuredTextareaPaste(e, (nextVal) =>
                              updateActiveSub({ analysisMarkdown: nextVal }),
                            )
                          }
                          placeholder="粘贴该小题的 AI 复盘解析（支持公式 \\frac 与 **高亮**）"
                          className="w-full rounded-xl border border-slate-900/[0.1] bg-[#F7F6F2] px-3 py-2 font-mono text-xs leading-relaxed text-[#181B22] placeholder:text-[#88909E] focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
                        />
                      ) : (
                        <div className="min-h-[160px] rounded-xl border border-slate-900/[0.08] bg-[#F7F6F2] p-4 dark:border-white/[0.07] dark:bg-[#0D0E11]">
                          <MarkdownView
                            markdown={activeSub.analysisMarkdown}
                            placeholder="暂无小题 AI 解析内容。"
                          />
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                        小题笔记（可选）
                      </label>
                      <textarea
                        rows={2}
                        value={activeSub.personalNote ?? ''}
                        onChange={(e) =>
                          updateActiveSub({ personalNote: e.target.value })
                        }
                        placeholder="记录该小题的计算技巧或坑点..."
                        className="w-full rounded-xl border border-slate-900/[0.1] bg-[#F7F6F2] px-3 py-2 text-sm text-[#181B22] placeholder:text-[#88909E] focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
                      />
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

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
              {editingQuestion
                ? '保存修改'
                : entryKind === 'material'
                  ? `保存材料组合题（${subQuestions.length} 小题）`
                  : '保存到题库'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
