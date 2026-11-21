import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Contrast,
  Eye,
  EyeOff,
  Maximize2,
  Pencil,
  Plus,
  Star,
  Tag,
  Trash2,
} from 'lucide-react';
import type { ReviewDeckProps } from '../types/contracts';
import type { FolderNode, MasteryLevel, QuestionType } from '../types/schema';
import MarkdownView from './MarkdownView';
import ImageLightbox from './ImageLightbox';

const QUESTION_TYPE_META: Record<QuestionType, { label: string; textClass: string }> = {
  mistake: {
    label: '错题',
    textClass: 'text-[#C93B3B] dark:text-[#F06A6A]',
  },
  gem: {
    label: '好题',
    textClass: 'text-amber-600 dark:text-amber-400',
  },
  template: {
    label: '母题',
    textClass: 'text-indigo-600 dark:text-indigo-300',
  },
};

const MASTERY_OPTIONS: Array<{
  value: MasteryLevel;
  label: string;
  hotkey: string;
  dotClass: string;
  activeClass: string;
}> = [
  {
    value: 'unfamiliar',
    label: '生疏',
    hotkey: '1',
    dotClass: 'bg-[#C93B3B] dark:bg-[#F06A6A]',
    activeClass:
      'border-[#C93B3B]/40 bg-[#C93B3B]/[0.09] text-[#C93B3B] dark:border-[#F06A6A]/45 dark:bg-[#F06A6A]/[0.14] dark:text-[#F06A6A]',
  },
  {
    value: 'vague',
    label: '模糊',
    hotkey: '2',
    dotClass: 'bg-amber-500 dark:bg-amber-400',
    activeClass:
      'border-amber-500/40 bg-amber-500/[0.09] text-amber-700 dark:border-amber-400/45 dark:bg-amber-400/[0.14] dark:text-amber-300',
  },
  {
    value: 'mastered',
    label: '已掌握',
    hotkey: '3',
    dotClass: 'bg-emerald-600 dark:bg-emerald-400',
    activeClass:
      'border-emerald-600/40 bg-emerald-600/[0.09] text-emerald-700 dark:border-emerald-400/45 dark:bg-emerald-400/[0.14] dark:text-emerald-300',
  },
];

type StemBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'statement'; marker: string; text: string }
  | { kind: 'option'; letter: string; text: string };

const OPTION_LINE_RE = /^\s*(?:\(([A-H])\)|（([A-H])）|([A-H])\s*[.、．)）:：])\s*(.+)$/i;
const STANDALONE_OPTION_LABEL_RE = /^[（(]?([A-H])[)）]?[.、．:：]?$/i;
const INLINE_OPTION_SPLIT_RE = /\s+(?=[B-H]\s*[.、．)）:：]\s*\S)/i;
const STATEMENT_START_RE = /^\s*([①②③④⑤⑥⑦⑧⑨⑩])\s*(.+)$/;
const CONSECUTIVE_CIRCLED_RE = /^[①②③④⑤⑥⑦⑧⑨⑩][\s、,，]*[①②③④⑤⑥⑦⑧⑨⑩]/;
const INLINE_STATEMENT_SPLIT_RE = /\s+(?=[②③④⑤⑥⑦⑧⑨⑩](?![①②③④⑤⑥⑦⑧⑨⑩]))/;

/**
 * 图 1 风格原题排印解析器：
 * 1) 兼容刷题网跨行选项（如单独一行的 A + 下一行的 ①④⑤）与标准 A./B./C./D. 选项；
 * 2) 保护 ①④⑤ 等连续圆圈数字组合以及选项区内内容，避免误劈分成陈述句；
 * 3) 将 ①②③④⑤ 独立陈述句排成清晰列，非选择题保持分段排印。
 */
function parseStemBlocks(stemText: string): StemBlock[] {
  if (!stemText.trim()) return [];
  const lines = stemText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const blocks: StemBlock[] = [];
  let inOptionsSection = false;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i];

    // 兼容跨行单字母标（如单独一行的 A / A. / （A））与其紧邻下一行选项正文合并
    const standaloneMatch = trimmed.match(STANDALONE_OPTION_LABEL_RE);
    if (standaloneMatch && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      if (!STANDALONE_OPTION_LABEL_RE.test(nextLine) && !OPTION_LINE_RE.test(nextLine)) {
        inOptionsSection = true;
        blocks.push({
          kind: 'option',
          letter: standaloneMatch[1].toUpperCase(),
          text: nextLine,
        });
        i += 1;
        continue;
      }
    }

    // 识别整行或单行并排的选项行（A. ... B. ...）
    if (OPTION_LINE_RE.test(trimmed)) {
      inOptionsSection = true;
      const chunks = trimmed.split(INLINE_OPTION_SPLIT_RE);
      for (const chunk of chunks) {
        const match = chunk.trim().match(OPTION_LINE_RE);
        if (match) {
          const letter = (match[1] || match[2] || match[3] || '').toUpperCase();
          const text = (match[4] || '').trim();
          blocks.push({ kind: 'option', letter, text });
        } else if (chunk.trim()) {
          blocks.push({ kind: 'paragraph', text: chunk.trim() });
        }
      }
      continue;
    }

    // 仅在未进入选项区且非连续组合数字（如 ①④⑤）时拆解 ①②③④⑤ 陈述句
    if (
      !inOptionsSection &&
      STATEMENT_START_RE.test(trimmed) &&
      !CONSECUTIVE_CIRCLED_RE.test(trimmed)
    ) {
      const chunks = trimmed.split(INLINE_STATEMENT_SPLIT_RE);
      for (const chunk of chunks) {
        const match = chunk.trim().match(STATEMENT_START_RE);
        if (match && !CONSECUTIVE_CIRCLED_RE.test(chunk.trim())) {
          blocks.push({ kind: 'statement', marker: match[1], text: match[2].trim() });
        } else if (chunk.trim()) {
          blocks.push({ kind: 'paragraph', text: chunk.trim() });
        }
      }
      continue;
    }

    blocks.push({ kind: 'paragraph', text: trimmed });
  }

  return blocks;
}

/**
 * 判断标题是否仅由题干开头自动截断派生，避免详情页标题与题干首句重复展示。
 */
function isRedundantTitle(title: string, stemText: string): boolean {
  const cleanedTitle = title
    .trim()
    .replace(/(?:…|\.{3,})+$/g, '')
    .replace(/\s+/g, '');
  if (cleanedTitle.length < 6) return false;

  const normalizedStem = stemText.replace(/\s+/g, '');
  if (!normalizedStem) return false;
  if (normalizedStem.startsWith(cleanedTitle)) return true;

  const strippedStem = stemText
    .trim()
    .replace(/^(?:[（(【\[]?(?:单选题|多选题|不定项选择题|判断题|填空题|简答题|单选|多选)[）)】\]]?|\d+[.、．)）])\s*/i, '')
    .replace(/\s+/g, '');
  return strippedStem.startsWith(cleanedTitle);
}

function normalizeAnswerLetter(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase();
  const match = trimmed.match(/^([A-H])(?:\b|[.、．)）\s]|$)/);
  return match ? match[1] : null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

function resolveFolderChain(
  folders: FolderNode[],
  folderId: string,
): { pathLabel: string; chainTip: string | null; tipFolderName: string | null } {
  const activeMap = new Map<string, FolderNode>();
  for (const folder of folders) {
    if (!folder.deletedAt) {
      activeMap.set(folder.id, folder);
    }
  }

  const segments: string[] = [];
  const visited = new Set<string>();
  let curr = activeMap.get(folderId);
  let chainTip: string | null = null;
  let tipFolderName: string | null = null;

  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    segments.unshift(curr.name);
    if (!chainTip && curr.chainTip && curr.chainTip.trim()) {
      chainTip = curr.chainTip.trim();
      tipFolderName = curr.name;
    }
    curr = curr.parentId ? activeMap.get(curr.parentId) : undefined;
  }

  return {
    pathLabel: segments.length > 0 ? segments.join(' / ') : '未分类',
    chainTip,
    tipFolderName,
  };
}

function formatDueText(nextReviewAt: number, reviewCount: number): string {
  const now = Date.now();
  if (nextReviewAt <= now) {
    return reviewCount > 0 ? `复习 ${reviewCount} 次 · 待复习` : '待首轮复盘';
  }
  const diffDays = Math.max(1, Math.ceil((nextReviewAt - now) / (24 * 60 * 60 * 1000)));
  return `复习 ${reviewCount} 次 · ${diffDays}天后`;
}

/**
 * 一体化极简复盘工作台（v2）：
 * 去除外层套框与厚重分割卡片，采用图 1 原题/选项排印、图 2 解析区、单图悬浮护眼反色胶囊、
 * 沉静磨砂自测遮罩以及低饱和微描边熟练度操作栏。
 */
export const ReviewDeck: React.FC<ReviewDeckProps> = ({
  questions,
  folders,
  currentIndex,
  reviewMode,
  autoAdvanceOnRate,
  onChangeIndex,
  onChangeReviewMode,
  onToggleAutoAdvance,
  onRateMastery,
  onToggleStar,
  onUpdateQuestionInline,
  onOpenEditModal,
  onDeleteQuestion,
  onOpenQuickAdd,
}) => {
  const safeIndex =
    questions.length > 0 ? Math.max(0, Math.min(currentIndex, questions.length - 1)) : 0;
  const question = questions.length > 0 ? questions[safeIndex] : undefined;

  const [isAnalysisOpen, setIsAnalysisOpen] = useState<boolean>(reviewMode === 'direct');
  const [isTipExpanded, setIsTipExpanded] = useState<boolean>(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState<boolean>(false);
  const [lightboxIndex, setLightboxIndex] = useState<number>(0);
  const [imgOverride, setImgOverride] = useState<Record<string, 'invert' | 'normal'>>({});
  const [globalDarkInvert, setGlobalDarkInvert] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    const root = document.documentElement;
    return root.classList.contains('dark') && root.dataset.imgMode === 'invert';
  });

  const [noteDraft, setNoteDraft] = useState<string>(question?.personalNote ?? '');
  const [noteSavedToast, setNoteSavedToast] = useState<boolean>(false);

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // 监听全局深浅色与 Aa 图片护眼设置变化，保证单图反色微胶囊状态实时同步
  useEffect(() => {
    const syncRootAttr = () => {
      const root = document.documentElement;
      setGlobalDarkInvert(
        root.classList.contains('dark') && root.dataset.imgMode === 'invert',
      );
    };
    syncRootAttr();
    const observer = new MutationObserver(syncRootAttr);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-img-mode'],
    });
    return () => observer.disconnect();
  }, []);

  // 切题或切换自测/直看模式时重置解析与弹窗状态
  useEffect(() => {
    setIsAnalysisOpen(reviewMode === 'direct');
    setConfirmDeleteId(null);
    setLightboxOpen(false);
    setImgOverride({});
  }, [question?.id, reviewMode]);

  useEffect(() => {
    setNoteDraft(question?.personalNote ?? '');
    setNoteSavedToast(false);
  }, [question?.id, question?.personalNote]);

  const folderInfo = useMemo(
    () => (question ? resolveFolderChain(folders, question.folderId) : null),
    [folders, question],
  );

  const stemBlocks = useMemo(
    () => (question ? parseStemBlocks(question.stemText) : []),
    [question],
  );

  const hasParsedOptions = useMemo(
    () => stemBlocks.some((b) => b.kind === 'option'),
    [stemBlocks],
  );

  // 全局键盘快捷键（非输入焦点且无模态弹窗打开时生效）
  useEffect(() => {
    if (!question) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (lightboxOpen) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        setIsAnalysisOpen((prev) => !prev);
      } else if (e.key === 'ArrowLeft') {
        if (safeIndex > 0) {
          e.preventDefault();
          onChangeIndex(safeIndex - 1);
        }
      } else if (e.key === 'ArrowRight') {
        if (safeIndex < questions.length - 1) {
          e.preventDefault();
          onChangeIndex(safeIndex + 1);
        }
      } else if (e.key === '1') {
        e.preventDefault();
        onRateMastery(question.id, 'unfamiliar');
      } else if (e.key === '2') {
        e.preventDefault();
        onRateMastery(question.id, 'vague');
      } else if (e.key === '3') {
        e.preventDefault();
        onRateMastery(question.id, 'mastered');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [question, safeIndex, questions.length, lightboxOpen, onChangeIndex, onRateMastery]);

  if (!question) {
    return (
      <div className="flex min-h-[380px] items-center justify-center p-6 lg:h-[calc(100vh-5.25rem)]">
        <div className="max-w-md rounded-2xl border border-dashed border-slate-900/[0.12] dark:border-white/[0.1] bg-white/80 dark:bg-white/[0.02] p-8 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/[0.04] dark:bg-white/[0.06] text-[#586070] dark:text-[#9AA3B2]">
            <BookOpen className="h-5 w-5" />
          </div>
          <h3 className="text-base font-semibold text-[#181B22] dark:text-[#F5F7FB]">
            当前筛选条件下暂无题目
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-[#586070] dark:text-[#9AA3B2]">
            可以切换左侧题型目录、调整顶部筛选范围，或立即录入一道新错题开始复盘。
          </p>
          <button
            type="button"
            onClick={onOpenQuickAdd}
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-[#F5F7FB] dark:text-[#0D0E11] dark:hover:bg-white transition-colors"
          >
            <Plus className="h-4 w-4" />
            立即录一题
          </button>
        </div>
      </div>
    );
  }

  const typeMeta = QUESTION_TYPE_META[question.questionType];
  const dueText = formatDueText(question.nextReviewAt, question.reviewCount);
  const progressPercent = Math.round(((safeIndex + 1) / questions.length) * 100);
  const isNoteDirty = noteDraft !== question.personalNote;
  const isConfirmingDelete = confirmDeleteId === question.id;

  const correctLetter = normalizeAnswerLetter(question.correctAnswer);
  const wrongLetter = normalizeAnswerLetter(question.myWrongChoice);

  const handleSaveNote = () => {
    if (!isNoteDirty) return;
    onUpdateQuestionInline(question.id, { personalNote: noteDraft });
    setNoteSavedToast(true);
    window.setTimeout(() => setNoteSavedToast(false), 1800);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (lightboxOpen || e.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    if (isEditableTarget(e.target)) {
      touchStartRef.current = null;
      return;
    }
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current || e.changedTouches.length === 0) return;
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const end = e.changedTouches[0];
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;

    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) {
      if (dx < 0 && safeIndex < questions.length - 1) {
        onChangeIndex(safeIndex + 1);
      } else if (dx > 0 && safeIndex > 0) {
        onChangeIndex(safeIndex - 1);
      }
    }
  };

  const openImageAt = (idx: number) => {
    setLightboxIndex(idx);
    setLightboxOpen(true);
  };

  const toggleImageInvert = (imgId: string) => {
    setImgOverride((prev) => {
      const current = prev[imgId];
      const currentlyInverted =
        current === 'invert' || (current === undefined && globalDarkInvert);
      return {
        ...prev,
        [imgId]: currentlyInverted ? 'normal' : 'invert',
      };
    });
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="flex flex-col lg:h-[calc(100vh-5.25rem)] lg:min-h-[520px] lg:overflow-hidden"
    >
      {/* 顶部极简控制行 */}
      <div className="shrink-0 border-b border-slate-900/[0.08] dark:border-white/[0.065] px-4 py-2.5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* 左侧：目录路径 + 进度 + 低调文字型标签 */}
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <span className="max-w-[190px] sm:max-w-xs truncate text-[#586070] dark:text-[#9AA3B2]">
              {folderInfo?.pathLabel ?? '未分类'}
            </span>
            <span className="text-slate-300 dark:text-white/15">·</span>
            <span className={`font-medium ${typeMeta.textClass}`}>{typeMeta.label}</span>
            <span className="text-slate-300 dark:text-white/15">·</span>
            <span className="font-medium tabular-nums text-[#181B22] dark:text-[#E6E8EE]">
              {safeIndex + 1} / {questions.length}
            </span>
            <span className="hidden sm:inline text-[#7C8594] dark:text-[#6F7787]">
              ({dueText})
            </span>
          </div>

          {/* 右侧：自测/直看分段开关、自动跳题开关、无框轻量图标按钮 */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <div
              role="group"
              aria-label="复盘展示模式"
              className="inline-flex rounded-lg bg-black/[0.04] p-0.5 dark:bg-white/[0.05]"
            >
              <button
                type="button"
                onClick={() => onChangeReviewMode('self_test')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  reviewMode === 'self_test'
                    ? 'bg-white text-[#181B22] shadow-sm dark:bg-[#232730] dark:text-[#F5F7FB]'
                    : 'text-[#586070] hover:text-[#181B22] dark:text-[#9AA3B2] dark:hover:text-[#E6E8EE]'
                }`}
              >
                自测
              </button>
              <button
                type="button"
                onClick={() => onChangeReviewMode('direct')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  reviewMode === 'direct'
                    ? 'bg-white text-[#181B22] shadow-sm dark:bg-[#232730] dark:text-[#F5F7FB]'
                    : 'text-[#586070] hover:text-[#181B22] dark:text-[#9AA3B2] dark:hover:text-[#E6E8EE]'
                }`}
              >
                直看
              </button>
            </div>

            <label
              className="hidden sm:inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[#586070] dark:text-[#9AA3B2] hover:bg-black/[0.03] dark:hover:bg-white/[0.04] select-none"
              title="标记熟练度后自动跳转到下一题"
            >
              <input
                type="checkbox"
                checked={autoAdvanceOnRate}
                onChange={(e) => onToggleAutoAdvance(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-[#C93B3B] dark:accent-[#F06A6A]"
              />
              切下一题自动跳转
            </label>

            <button
              type="button"
              onClick={() => onToggleStar(question.id)}
              title={question.starred ? '取消收藏' : '星标收藏'}
              aria-label={question.starred ? '取消收藏' : '星标收藏'}
              className={`rounded-md p-1.5 transition-colors ${
                question.starred
                  ? 'text-amber-500 dark:text-amber-400'
                  : 'text-[#7C8594] dark:text-[#6F7787] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-amber-500'
              }`}
            >
              <Star className={`h-4 w-4 ${question.starred ? 'fill-current' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => onOpenEditModal(question)}
              title="编辑题干与元数据"
              aria-label="编辑题干"
              className="rounded-md p-1.5 text-[#7C8594] dark:text-[#6F7787] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-[#181B22] dark:hover:text-[#E6E8EE] transition-colors"
            >
              <Pencil className="h-4 w-4" />
            </button>

            {isConfirmingDelete ? (
              <div className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/[0.08] px-1.5 py-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDeleteId(null);
                    onDeleteQuestion(question.id);
                  }}
                  className="rounded px-1.5 py-0.5 text-xs font-medium text-[#C93B3B] dark:text-[#F06A6A]"
                >
                  确认删除
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded px-1 py-0.5 text-xs text-[#586070] dark:text-[#9AA3B2]"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDeleteId(question.id)}
                title="删除此题"
                aria-label="删除此题"
                className="rounded-md p-1.5 text-[#7C8594] dark:text-[#6F7787] hover:bg-red-500/10 hover:text-[#C93B3B] dark:hover:text-[#F06A6A] transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2px 细进度线 */}
      <div className="h-[2px] w-full shrink-0 bg-slate-900/[0.05] dark:bg-white/[0.05]">
        <div
          style={{ width: `${progressPercent}%` }}
          className="h-full bg-[#C93B3B] dark:bg-[#F06A6A] transition-all duration-300"
        />
      </div>

      {/* 降噪微灰一行思维链口诀条 */}
      {folderInfo?.chainTip && (
        <div className="shrink-0 border-b border-slate-900/[0.05] dark:border-white/[0.04] bg-black/[0.025] dark:bg-white/[0.03] px-4 py-1.5 sm:px-6">
          <button
            type="button"
            onClick={() => setIsTipExpanded((prev) => !prev)}
            className="flex w-full items-center justify-between gap-2 text-left text-xs text-[#586070] dark:text-[#9AA3B2]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 font-medium text-[#7C8594] dark:text-[#6F7787]">
                {folderInfo.tipFolderName ? `${folderInfo.tipFolderName}口诀` : '口诀'}
              </span>
              <span className={isTipExpanded ? 'whitespace-pre-wrap' : 'truncate'}>
                {folderInfo.chainTip}
              </span>
            </span>
            <span className="shrink-0 text-[#7C8594] dark:text-[#6F7787]">
              {isTipExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </span>
          </button>
        </div>
      )}

      {/* 主视图：桌面端 1px 中线分割双栏独立滚动，移动端上下结构 */}
      <div className="flex-1 min-h-0 lg:overflow-hidden lg:grid lg:grid-cols-2 lg:divide-x lg:divide-slate-900/[0.08] dark:lg:divide-white/[0.065]">
        {/* 左栏：原题阅读区 */}
        <section
          aria-label="原题区"
          className="px-4 py-5 sm:px-6 lg:h-full lg:overflow-y-auto lg:px-8 lg:py-6 xl:px-10"
        >
          {/* 标题（自动隐藏与题干首句重复的派生标题）与作答对比 */}
          {(() => {
            const showTitle =
              Boolean(question.title.trim()) &&
              !isRedundantTitle(question.title, question.stemText);
            const showAnswerBadges =
              Boolean(question.myWrongChoice || question.correctAnswer) &&
              (!hasParsedOptions || !isAnalysisOpen);
            if (!showTitle && !showAnswerBadges) return null;

            return (
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                {showTitle ? (
                  <h1 className="text-base sm:text-lg font-bold tracking-tight text-[#14171F] dark:text-[#F5F7FB]">
                    {question.title}
                  </h1>
                ) : (
                  <span />
                )}

                {showAnswerBadges && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {isAnalysisOpen ? (
                      <>
                        {question.myWrongChoice && (
                          <span className="rounded-md bg-[#C93B3B]/10 px-2 py-0.5 font-medium text-[#C93B3B] dark:bg-[#F06A6A]/15 dark:text-[#F06A6A]">
                            错选 {question.myWrongChoice}
                          </span>
                        )}
                        {question.correctAnswer && (
                          <span className="rounded-md bg-emerald-600/10 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            正解 {question.correctAnswer}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[11px] text-[#7C8594] dark:text-[#6F7787]">
                        展开解析后核对选项
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* 图 1 风格原题文本与选项排印器（应用 .stem-prose 响应 Aa 设置） */}
          <div className="stem-prose space-y-3 select-text">
            {stemBlocks.length === 0 ? (
              <p className="text-sm text-[#7C8594] dark:text-[#6F7787]">
                （此题未录入文字题干，请查看下方附图）
              </p>
            ) : (
              (() => {
                const nodes: React.ReactNode[] = [];
                let i = 0;
                while (i < stemBlocks.length) {
                  const block = stemBlocks[i];
                  if (block.kind === 'statement') {
                    const group: Array<Extract<StemBlock, { kind: 'statement' }>> = [];
                    while (i < stemBlocks.length && stemBlocks[i].kind === 'statement') {
                      group.push(stemBlocks[i] as Extract<StemBlock, { kind: 'statement' }>);
                      i += 1;
                    }
                    nodes.push(
                      <div key={`stmt-${i}`} className="my-3 space-y-2 pl-0.5">
                        {group.map((st, idx) => (
                          <div key={`${st.marker}-${idx}`} className="flex items-baseline gap-2.5">
                            <span className="shrink-0 font-medium text-[#586070] dark:text-[#9AA3B2]">
                              {st.marker}
                            </span>
                            <span className="min-w-0 flex-1">{st.text}</span>
                          </div>
                        ))}
                      </div>,
                    );
                    continue;
                  }

                  if (block.kind === 'option') {
                    const options: Array<Extract<StemBlock, { kind: 'option' }>> = [];
                    while (i < stemBlocks.length && stemBlocks[i].kind === 'option') {
                      options.push(stemBlocks[i] as Extract<StemBlock, { kind: 'option' }>);
                      i += 1;
                    }
                    nodes.push(
                      <div key={`opts-${i}`} className="mt-4 space-y-2">
                        {options.map((opt) => {
                          const isCorrect =
                            isAnalysisOpen && correctLetter !== null && opt.letter === correctLetter;
                          const isWrong =
                            isAnalysisOpen &&
                            wrongLetter !== null &&
                            opt.letter === wrongLetter &&
                            opt.letter !== correctLetter;

                          return (
                            <div
                              key={opt.letter}
                              className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 transition-colors ${
                                isCorrect
                                  ? 'bg-emerald-600/[0.08] dark:bg-emerald-500/[0.11]'
                                  : isWrong
                                    ? 'bg-[#C93B3B]/[0.07] dark:bg-[#F06A6A]/[0.1]'
                                    : 'bg-black/[0.02] dark:bg-white/[0.025]'
                              }`}
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <span
                                  className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                                    isCorrect
                                      ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-[#0D0E11]'
                                      : isWrong
                                        ? 'bg-[#C93B3B] text-white dark:bg-[#F06A6A] dark:text-[#0D0E11]'
                                        : 'border border-slate-300/90 bg-white text-[#586070] dark:border-white/15 dark:bg-white/[0.05] dark:text-[#9AA3B2]'
                                  }`}
                                >
                                  {opt.letter}
                                </span>
                                <span
                                  className={`min-w-0 break-words ${
                                    isCorrect
                                      ? 'font-medium text-emerald-800 dark:text-emerald-200'
                                      : isWrong
                                        ? 'text-[#A82C2C] dark:text-[#F69898]'
                                        : ''
                                  }`}
                                >
                                  {opt.text}
                                </span>
                              </div>
                              {isCorrect && (
                                <span className="shrink-0 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                                  正解
                                </span>
                              )}
                              {isWrong && (
                                <span className="shrink-0 text-[11px] font-medium text-[#C93B3B] dark:text-[#F06A6A]">
                                  错选
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>,
                    );
                    continue;
                  }

                  nodes.push(
                    <p key={`p-${i}`} className="break-words">
                      {block.text}
                    </p>,
                  );
                  i += 1;
                }
                return nodes;
              })()
            )}
          </div>

          {/* 原题配图区：无厚外框，单图舒展展示 + 右上角悬浮毛玻璃护眼反色与放大胶囊 */}
          {question.images.length > 0 && (
            <div
              className={`mt-5 grid gap-3 ${
                question.images.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
              }`}
            >
              {question.images.map((img, idx) => {
                const override = imgOverride[img.id];
                const isInverted =
                  override === 'invert' || (override === undefined && globalDarkInvert);
                const imgFilterClass =
                  override === 'invert'
                    ? 'img-force-invert'
                    : override === 'normal'
                      ? ''
                      : 'review-img-adaptive';

                return (
                  <div key={img.id} className="group relative">
                    <div
                      onClick={() => openImageAt(idx)}
                      className="relative cursor-zoom-in overflow-hidden rounded-xl border border-slate-900/[0.06] dark:border-white/[0.06]"
                    >
                      <img
                        src={img.dataUrl}
                        alt={img.caption || `原题附图 ${idx + 1}`}
                        className={`block w-full bg-white object-contain ${imgFilterClass} ${
                          question.images.length === 1 ? 'max-h-[460px]' : 'max-h-60'
                        }`}
                      />

                      {/* 右上角悬浮毛玻璃微胶囊：护眼反色切换 + 放大看图 */}
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute top-2.5 right-2.5 z-10 inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/55 backdrop-blur-md px-1.5 py-1 text-[11px] text-white/90 shadow-sm"
                      >
                        <button
                          type="button"
                          onClick={() => toggleImageInvert(img.id)}
                          aria-pressed={isInverted}
                          title="切换护眼反色"
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors ${
                            isInverted
                              ? 'bg-white text-[#0D0E11] font-medium'
                              : 'text-white/85 hover:bg-white/15'
                          }`}
                        >
                          <Contrast className="h-3 w-3" />
                          <span>反色</span>
                        </button>
                        <span className="h-3 w-px bg-white/20" />
                        <button
                          type="button"
                          onClick={() => openImageAt(idx)}
                          title="放大看高清原图"
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-white/90 hover:bg-white/15 transition-colors"
                        >
                          <Maximize2 className="h-3 w-3" />
                          <span>放大</span>
                        </button>
                      </div>
                    </div>

                    {img.caption && (
                      <p className="mt-1.5 text-center text-xs text-[#7C8594] dark:text-[#6F7787]">
                        {img.caption}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 标签 */}
          {question.tags.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-900/[0.06] dark:border-white/[0.05] pt-3.5">
              {question.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-xs text-[#7C8594] dark:text-[#6F7787]"
                >
                  <Tag className="h-3 w-3" />
                  {tag}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* 右栏：AI 复盘精析 + 个人考场笔记 */}
        <section
          aria-label="复盘解析与笔记区"
          className="border-t border-slate-900/[0.08] dark:border-white/[0.065] px-4 py-5 pb-32 sm:px-6 lg:border-t-0 lg:h-full lg:overflow-y-auto lg:px-8 lg:py-6 lg:pb-8 xl:px-10"
        >
          {/* AI 复盘区 */}
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold tracking-wider text-[#7C8594] dark:text-[#6F7787] uppercase">
                AI 复盘精析
              </h2>
              {isAnalysisOpen && (
                <button
                  type="button"
                  onClick={() => setIsAnalysisOpen(false)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-[#7C8594] dark:text-[#6F7787] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-slate-900 dark:hover:text-[#E6E8EE] transition-colors"
                >
                  <EyeOff className="h-3 w-3" />
                  收起解析
                </button>
              )}
            </div>

            {isAnalysisOpen ? (
              <MarkdownView
                markdown={question.analysisMarkdown}
                editable
                onSaveMarkdown={(nextMarkdown) =>
                  onUpdateQuestionInline(question.id, { analysisMarkdown: nextMarkdown })
                }
                placeholder="暂无 AI 复盘解析，可点击右上角「编辑原文」自行补充。"
              />
            ) : (
              <button
                type="button"
                onClick={() => setIsAnalysisOpen(true)}
                className="group flex w-full flex-col items-center justify-center rounded-2xl border border-slate-900/[0.08] bg-white/75 px-6 py-14 text-center backdrop-blur-md transition-all hover:border-slate-900/20 hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.025] dark:hover:border-white/20 dark:hover:bg-white/[0.045]"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-slate-900/[0.08] bg-black/[0.03] text-[#586070] dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-[#9AA3B2] group-hover:scale-105 transition-transform">
                  <Eye className="h-4 w-4" />
                </div>
                <p className="text-sm sm:text-[15px] font-medium text-[#181B22] dark:text-[#F5F7FB]">
                  自测思考中——点击此处或按空格键展开 AI 复盘
                </p>
                <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-[#7C8594] dark:text-[#6F7787]">
                  <span>先在脑中过一遍解题思路，再按</span>
                  <kbd className="rounded border border-slate-900/15 bg-white px-1.5 py-0.5 font-mono text-[11px] text-[#586070] shadow-xs dark:border-white/15 dark:bg-white/[0.06] dark:text-[#9AA3B2]">
                    Space
                  </kbd>
                  <span>揭晓答案</span>
                </p>
              </button>
            )}
          </div>

          {/* 个人考场笔记区 */}
          <div className="mt-8 border-t border-slate-900/[0.08] dark:border-white/[0.065] pt-6">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold tracking-wider text-[#7C8594] dark:text-[#6F7787] uppercase">
                个人考场笔记
              </h2>
              <div className="flex items-center gap-2">
                {noteSavedToast && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5" />
                    已保存
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleSaveNote}
                  disabled={!isNoteDirty}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    isNoteDirty
                      ? 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-[#F5F7FB] dark:text-[#0D0E11]'
                      : 'text-[#7C8594] dark:text-[#6F7787] cursor-default'
                  }`}
                >
                  {isNoteDirty ? '保存笔记' : '已同步'}
                </button>
              </div>
            </div>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={handleSaveNote}
              rows={4}
              placeholder="记下当时为什么选错、踩了什么坑、下次见到同类关键词的第一反应..."
              className="w-full resize-y rounded-xl border border-slate-900/[0.08] dark:border-white/[0.07] bg-white/75 dark:bg-white/[0.025] p-3 text-sm leading-relaxed text-[#181B22] dark:text-[#E6E8EE] placeholder:text-[#7C8594] dark:placeholder:text-[#6F7787] focus:border-slate-500 dark:focus:border-white/25 focus:outline-none"
            />
          </div>
        </section>
      </div>

      {/* 克制低饱和熟练度与导航栏（移动端吸底固定，桌面端轻量驻底） */}
      <div className="safe-bottom fixed bottom-0 inset-x-0 z-30 border-t border-slate-900/[0.08] dark:border-white/[0.065] bg-[#F7F6F2]/92 dark:bg-[#0D0E11]/92 backdrop-blur-md px-3 py-2 sm:px-6 sm:py-2.5 lg:static lg:z-auto lg:shrink-0 lg:bg-transparent">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* 低饱和微描边熟练度按钮（6px 语义圆点 + 淡标快捷键） */}
          <div className="grid grid-cols-3 gap-1.5 sm:flex sm:items-center sm:gap-2">
            {MASTERY_OPTIONS.map((opt) => {
              const isCurrent = question.mastery === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onRateMastery(question.id, opt.value)}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 sm:px-3 sm:py-1.5 text-xs sm:text-[13px] font-medium transition-all ${
                    isCurrent
                      ? opt.activeClass
                      : 'border-slate-900/[0.09] bg-white/70 text-[#586070] hover:border-slate-900/20 hover:text-[#181B22] dark:border-white/[0.08] dark:bg-white/[0.025] dark:text-[#9AA3B2] dark:hover:border-white/20 dark:hover:text-[#E6E8EE]'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${opt.dotClass}`} />
                  <span>{opt.label}</span>
                  <span className="font-mono text-[10px] opacity-40">{opt.hotkey}</span>
                </button>
              );
            })}
          </div>

          {/* 轻量上一题 / 下一题 */}
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <label className="sm:hidden inline-flex items-center gap-1 text-[11px] text-[#586070] dark:text-[#9AA3B2]">
              <input
                type="checkbox"
                checked={autoAdvanceOnRate}
                onChange={(e) => onToggleAutoAdvance(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-[#C93B3B] dark:accent-[#F06A6A]"
              />
              自动下一题
            </label>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={safeIndex <= 0}
                onClick={() => onChangeIndex(safeIndex - 1)}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs sm:text-[13px] font-medium text-[#586070] dark:text-[#9AA3B2] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-[#181B22] dark:hover:text-[#E6E8EE] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                上一题
              </button>
              <button
                type="button"
                disabled={safeIndex >= questions.length - 1}
                onClick={() => onChangeIndex(safeIndex + 1)}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs sm:text-[13px] font-medium text-[#586070] dark:text-[#9AA3B2] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-[#181B22] dark:hover:text-[#E6E8EE] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                下一题
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 暗房质感看图灯箱 */}
      <ImageLightbox
        images={question.images}
        initialIndex={lightboxIndex}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
};

export default ReviewDeck;
