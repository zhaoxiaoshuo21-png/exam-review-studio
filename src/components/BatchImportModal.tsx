import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ClipboardPaste,
  FileStack,
  ImagePlus,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import {
  extractClipboardImages,
  extractCorrectAnswer,
  parseBatchAnalysis,
  parseMaterialPack,
} from '../core';
import type { ParsedBatchItem, QuestionDraftInput } from '../types/contracts';
import type {
  FolderNode,
  MasteryLevel,
  QuestionImage,
  QuestionType,
  SubQuestionItem,
} from '../types/schema';
import {
  ImageDropZone,
  buildFolderOptions,
  compressImageFiles,
  deriveAutoTitle,
  handleStructuredTextareaPaste,
} from './QuickAddModal';

export interface BatchImportModalProps {
  isOpen: boolean;
  folders: FolderNode[];
  defaultFolderId: string | null;
  onClose: () => void;
  onImportBatch: (items: QuestionDraftInput[]) => void;
}

const SAMPLE_HINT = `【材料】2025年某行业总营收 10198.5 亿元，总利润 197.6 亿元……

第1题
该行业平均每家企业利润约为多少亿元？
一、【核心考点】
**比例同构**
答案：A

第2题
以下说法能够从上述资料推出的是：
一、【实战拆解】
正确项：C`;

export const BatchImportModal: React.FC<BatchImportModalProps> = ({
  isOpen,
  folders,
  defaultFolderId,
  onClose,
  onImportBatch,
}) => {
  const folderOptions = useMemo(() => buildFolderOptions(folders), [folders]);

  const [rawText, setRawText] = useState('');
  const [folderId, setFolderId] = useState('');
  const [questionType, setQuestionType] = useState<QuestionType>('mistake');
  const [mastery, setMastery] = useState<MasteryLevel>('unfamiliar');
  const [importMode, setImportMode] = useState<'independent' | 'material'>('independent');

  // 材料合并模式状态
  const [materialTitle, setMaterialTitle] = useState('');
  const [materialStemOverride, setMaterialStemOverride] = useState<string | null>(null);
  const [materialImages, setMaterialImages] = useState<QuestionImage[]>([]);
  const [pasteTarget, setPasteTarget] = useState<'material' | 'card'>('card');

  const [activeCardIdx, setActiveCardIdx] = useState(0);
  const [imagesByIndex, setImagesByIndex] = useState<Record<number, QuestionImage[]>>({});
  const [skippedIndices, setSkippedIndices] = useState<Set<number>>(new Set());
  const [isCompressing, setIsCompressing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const cardFileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetIdxRef = useRef<number>(0);

  const parsedPack = useMemo(() => {
    if (!rawText.trim()) return { materialStemText: '', subItems: [] as ParsedBatchItem[] };
    if (importMode === 'material') {
      return parseMaterialPack(rawText);
    }
    return {
      materialStemText: '',
      subItems: parseBatchAnalysis(rawText),
    };
  }, [rawText, importMode]);

  const parsedItems: ParsedBatchItem[] = parsedPack.subItems;
  const effectiveMaterialStem =
    materialStemOverride !== null ? materialStemOverride : parsedPack.materialStemText;

  const visibleCards = useMemo(
    () =>
      parsedItems
        .map((item, idx) => ({ item, idx }))
        .filter(({ idx }) => !skippedIndices.has(idx)),
    [parsedItems, skippedIndices],
  );

  useEffect(() => {
    if (!isOpen) return;
    const fallbackFolderId =
      (defaultFolderId && folderOptions.some((o) => o.id === defaultFolderId)
        ? defaultFolderId
        : folderOptions[0]?.id) ?? '';
    setRawText('');
    setFolderId(fallbackFolderId);
    setQuestionType('mistake');
    setMastery('unfamiliar');
    setImportMode('independent');
    setMaterialTitle('');
    setMaterialStemOverride(null);
    setMaterialImages([]);
    setPasteTarget('card');
    setActiveCardIdx(0);
    setImagesByIndex({});
    setSkippedIndices(new Set());
    setIsCompressing(false);
    setNotice(null);
  }, [isOpen, defaultFolderId, folderOptions]);

  useEffect(() => {
    if (visibleCards.length === 0) return;
    if (!visibleCards.some((c) => c.idx === activeCardIdx)) {
      setActiveCardIdx(visibleCards[0].idx);
    }
  }, [visibleCards, activeCardIdx]);

  // 弹窗打开时全局监听 Ctrl+V：依据模式和 pasteTarget 贴入共用材料区或选中预览卡
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const data = e.clipboardData;
      if (!data) return;
      const hasImage =
        Array.from(data.items ?? []).some(
          (item) => item.kind === 'file' && item.type.startsWith('image/'),
        ) || Array.from(data.files ?? []).some((f) => f.type.startsWith('image/'));

      if (!hasImage) return;

      if (importMode === 'material' && pasteTarget === 'material') {
        e.preventDefault();
        setIsCompressing(true);
        try {
          const compressed = await extractClipboardImages(data);
          if (compressed.length > 0) {
            setMaterialImages((prev) => [...prev, ...compressed]);
            setNotice(`已给「共用材料」补贴 ${compressed.length} 张配图`);
          }
        } finally {
          setIsCompressing(false);
        }
        return;
      }

      if (visibleCards.length === 0) return;

      e.preventDefault();
      const targetIdx = visibleCards.some((c) => c.idx === activeCardIdx)
        ? activeCardIdx
        : visibleCards[0].idx;

      setIsCompressing(true);
      try {
        const compressed = await extractClipboardImages(data);
        if (compressed.length > 0) {
          setImagesByIndex((prev) => ({
            ...prev,
            [targetIdx]: [...(prev[targetIdx] ?? []), ...compressed],
          }));
          const label = parsedItems[targetIdx]?.indexLabel ?? `第 ${targetIdx + 1} 题`;
          setNotice(`已给「${label}」补贴 ${compressed.length} 张截图`);
        }
      } finally {
        setIsCompressing(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('paste', handlePaste);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isOpen,
    importMode,
    pasteTarget,
    activeCardIdx,
    visibleCards,
    parsedItems,
    onClose,
  ]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!isOpen) return null;

  const handleCardUploadClick = (idx: number) => {
    uploadTargetIdxRef.current = idx;
    setActiveCardIdx(idx);
    setPasteTarget('card');
    cardFileInputRef.current?.click();
  };

  const handleCardFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const targetIdx = uploadTargetIdxRef.current;
    setIsCompressing(true);
    try {
      const next = await compressImageFiles(files);
      if (next.length > 0) {
        setImagesByIndex((prev) => ({
          ...prev,
          [targetIdx]: [...(prev[targetIdx] ?? []), ...next],
        }));
      }
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleMaterialFiles = async (files: FileList | File[]) => {
    setIsCompressing(true);
    try {
      const next = await compressImageFiles(files);
      if (next.length > 0) {
        setMaterialImages((prev) => [...prev, ...next]);
        setNotice(`已为共用材料添加 ${next.length} 张配图`);
      }
    } finally {
      setIsCompressing(false);
    }
  };

  const handleRemoveCardImage = (cardIdx: number, imgId: string) => {
    setImagesByIndex((prev) => ({
      ...prev,
      [cardIdx]: (prev[cardIdx] ?? []).filter((img) => img.id !== imgId),
    }));
  };

  const handleExcludeCard = (cardIdx: number) => {
    setSkippedIndices((prev) => {
      const next = new Set(prev);
      next.add(cardIdx);
      return next;
    });
  };

  const handleImportAll = () => {
    if (!folderId || visibleCards.length === 0) return;

    if (importMode === 'material') {
      const subQuestions: SubQuestionItem[] = visibleCards.map(({ item, idx }, subPos) => {
        const subImages = [...item.images, ...(imagesByIndex[idx] ?? [])];
        const autoAns =
          item.correctAnswer || extractCorrectAnswer(item.analysisMarkdown) || undefined;
        return {
          id: `sub_${Date.now().toString(36)}_${subPos}`,
          label: item.indexLabel || `第${subPos + 1}题`,
          stemText: item.stemText,
          images: subImages,
          correctAnswer: autoAns,
          analysisMarkdown: item.analysisMarkdown,
          personalNote: '',
        };
      });

      const resolvedTitle =
        materialTitle.trim() ||
        deriveAutoTitle(
          effectiveMaterialStem || subQuestions[0]?.stemText || '',
          subQuestions[0]?.analysisMarkdown || '',
        );

      const combinedDraft: QuestionDraftInput = {
        folderId,
        questionType,
        entryKind: 'material',
        title: resolvedTitle,
        stemText: effectiveMaterialStem.trim(),
        images: materialImages,
        subQuestions,
        analysisMarkdown: '',
        personalNote: '',
        tags: [],
        mastery,
        starred: false,
      };
      onImportBatch([combinedDraft]);
      return;
    }

    const drafts: QuestionDraftInput[] = visibleCards.map(({ item, idx }) => ({
      folderId,
      questionType,
      entryKind: 'single',
      title: item.suggestedTitle || `${item.indexLabel}`,
      stemText: item.stemText,
      images: [...item.images, ...(imagesByIndex[idx] ?? [])],
      correctAnswer:
        item.correctAnswer || extractCorrectAnswer(item.analysisMarkdown) || undefined,
      analysisMarkdown: item.analysisMarkdown,
      personalNote: '',
      tags: [],
      mastery,
      starred: false,
    }));
    onImportBatch(drafts);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-2 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="批量解析拆题导入"
    >
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-900/[0.08] bg-white shadow-2xl dark:border-white/[0.07] dark:bg-[#14161B]">
        {/* 顶栏 */}
        <div className="flex items-center justify-between border-b border-slate-900/[0.08] px-4 py-3.5 dark:border-white/[0.07] sm:px-6">
          <div className="flex items-center gap-2.5">
            <FileStack className="h-5 w-5 text-[#5B6270] dark:text-[#949BA8]" />
            <div>
              <h2 className="text-base font-semibold text-[#181B22] dark:text-[#F5F6FA] sm:text-lg">
                批量 AI 解析拆题导入
              </h2>
              <p className="hidden text-xs text-[#5B6270] dark:text-[#949BA8] sm:block">
                粘贴含「第1题」「第2题」…的长文自动拆卡；支持独立导入或合并为 1 套材料组合题（一拖N）
              </p>
            </div>
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

        {/* 统一配置栏 */}
        <div className="space-y-2.5 border-b border-slate-900/[0.08] bg-[#F7F6F2]/75 px-4 py-3 dark:border-white/[0.07] dark:bg-[#0D0E11]/70 sm:px-6">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                导入结构模式
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-900/[0.08] bg-white p-1 dark:border-white/[0.07] dark:bg-[#14161B]">
                <button
                  type="button"
                  onClick={() => {
                    setImportMode('independent');
                    setPasteTarget('card');
                  }}
                  className={`rounded-md py-1 text-xs font-medium transition ${
                    importMode === 'independent'
                      ? 'bg-[#181B22] text-white dark:bg-[#F5F6FA] dark:text-[#0D0E11]'
                      : 'text-[#5B6270] dark:text-[#949BA8]'
                  }`}
                >
                  各自独立成题
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImportMode('material');
                    setPasteTarget('material');
                  }}
                  className={`rounded-md px-1.5 py-1 text-xs font-medium transition ${
                    importMode === 'material'
                      ? 'bg-[#181B22] text-white dark:bg-[#F5F6FA] dark:text-[#0D0E11]'
                      : 'text-[#5B6270] dark:text-[#949BA8]'
                  }`}
                >
                  合并为材料组合题
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                统一归属题型目录
              </label>
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-900/[0.1] bg-white px-2.5 text-sm text-[#181B22] focus:border-slate-900/30 focus:outline-none dark:border-white/[0.08] dark:bg-[#14161B] dark:text-[#E6E8EE]"
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
                统一题目性质
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-900/[0.08] bg-white p-1 dark:border-white/[0.07] dark:bg-[#14161B]">
                {(
                  [
                    { value: 'mistake', label: '错题' },
                    { value: 'gem', label: '好题' },
                    { value: 'template', label: '母题' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setQuestionType(opt.value)}
                    className={`rounded-md py-1 text-xs font-medium transition ${
                      questionType === opt.value
                        ? 'bg-[#181B22] text-white dark:bg-[#F5F6FA] dark:text-[#0D0E11]'
                        : 'text-[#5B6270] dark:text-[#949BA8]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                统一初始熟练度
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-900/[0.08] bg-white p-1 dark:border-white/[0.07] dark:bg-[#14161B]">
                {(
                  [
                    { value: 'unfamiliar', label: '生疏' },
                    { value: 'vague', label: '模糊' },
                    { value: 'mastered', label: '已掌握' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMastery(opt.value)}
                    className={`rounded-md py-1 text-xs font-medium transition ${
                      mastery === opt.value
                        ? 'bg-[#181B22] text-white dark:bg-[#F5F6FA] dark:text-[#0D0E11]'
                        : 'text-[#5B6270] dark:text-[#949BA8]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 主体左右双栏 */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12">
          {/* 左栏：批量文本粘贴区 */}
          <div className="flex flex-col border-b border-slate-900/[0.08] p-4 dark:border-white/[0.07] lg:col-span-5 lg:border-b-0 lg:border-r">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#181B22] dark:text-[#E6E8EE]">
                1. 粘贴 AI 批量生成的解析长文
              </span>
              {rawText && (
                <button
                  type="button"
                  onClick={() => {
                    setRawText('');
                    setMaterialStemOverride(null);
                    setMaterialImages([]);
                    setImagesByIndex({});
                    setSkippedIndices(new Set());
                  }}
                  className="text-xs text-[#88909E] hover:text-red-500 dark:text-[#656C7A]"
                >
                  清空重贴
                </button>
              )}
            </div>
            <textarea
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                if (skippedIndices.size > 0) setSkippedIndices(new Set());
              }}
              onPaste={(e) =>
                handleStructuredTextareaPaste(e, (nextVal) => {
                  setRawText(nextVal);
                  if (skippedIndices.size > 0) setSkippedIndices(new Set());
                })
              }
              placeholder={SAMPLE_HINT}
              className="min-h-[200px] flex-1 resize-none rounded-xl border border-slate-900/[0.1] bg-[#F7F6F2] p-3 font-mono text-xs leading-relaxed text-[#181B22] placeholder:text-[#88909E] focus:border-slate-900/30 focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#0D0E11] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A]"
            />
          </div>

          {/* 右栏：共用材料配置（合并模式）+ 实时拆题预览卡 */}
          <div className="flex min-h-0 flex-col p-4 lg:col-span-7">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#181B22] dark:text-[#E6E8EE]">
                  {importMode === 'material'
                    ? `2. 共用材料与小题预览（共 ${visibleCards.length} 小题）`
                    : `2. 实时拆题预览（共 ${visibleCards.length} 题）`}
                </span>
                {isCompressing && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在压缩截图...
                  </span>
                )}
              </div>
              {notice ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {notice}
                </span>
              ) : (
                visibleCards.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-[#5B6270] dark:text-[#949BA8]">
                    <ClipboardPaste className="h-3.5 w-3.5 text-[#C93B3B] dark:text-[#F06A6A]" />
                    点选目标区或卡片后按 Ctrl+V 即可补贴截图
                  </span>
                )
              )}
            </div>

            <input
              ref={cardFileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleCardFileChange}
              className="hidden"
            />

            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {importMode === 'material' && (
                <div className="space-y-2.5 rounded-xl border border-slate-900/[0.1] bg-[#F7F6F2]/75 p-3 dark:border-white/[0.08] dark:bg-[#0D0E11]/75">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                      套题标题（可选，留空自动提取）
                    </label>
                    <input
                      type="text"
                      value={materialTitle}
                      onChange={(e) => setMaterialTitle(e.target.value)}
                      placeholder="例如：2025年某行业资料分析（一拖五）"
                      className="h-8 w-full rounded-lg border border-slate-900/[0.1] bg-white px-2.5 text-xs text-[#181B22] focus:outline-none dark:border-white/[0.08] dark:bg-[#14161B] dark:text-[#E6E8EE]"
                    />
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="text-xs font-medium text-[#5B6270] dark:text-[#949BA8]">
                        共用材料文本（已自动从长文首段提取，可微调）
                      </label>
                      {materialStemOverride !== null && (
                        <button
                          type="button"
                          onClick={() => setMaterialStemOverride(null)}
                          className="text-[11px] text-[#5B6270] hover:text-[#181B22] dark:text-[#949BA8]"
                        >
                          恢复自动提取
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={3}
                      value={effectiveMaterialStem}
                      onChange={(e) => setMaterialStemOverride(e.target.value)}
                      onPaste={(e) =>
                        handleStructuredTextareaPaste(e, (nextVal) =>
                          setMaterialStemOverride(nextVal),
                        )
                      }
                      placeholder="若长文以【材料】或文字段开头会在此自动显示；也可手动补全"
                      className="w-full rounded-lg border border-slate-900/[0.1] bg-white px-2.5 py-1.5 text-xs leading-relaxed text-[#181B22] focus:outline-none dark:border-white/[0.08] dark:bg-[#14161B] dark:text-[#E6E8EE]"
                    />
                  </div>

                  <ImageDropZone
                    label="共用材料配图（统计图表/表格截图）"
                    images={materialImages}
                    isCompressing={isCompressing}
                    showPasteTargetControl
                    isPasteTarget={pasteTarget === 'material'}
                    onActivatePasteTarget={() => setPasteTarget('material')}
                    onAddFiles={handleMaterialFiles}
                    onRemoveImage={(imgId) =>
                      setMaterialImages((prev) =>
                        prev.filter((img) => img.id !== imgId),
                      )
                    }
                  />
                </div>
              )}

              {visibleCards.length === 0 ? (
                <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-slate-900/[0.12] bg-[#F7F6F2]/70 p-6 text-center text-xs text-[#88909E] dark:border-white/[0.1] dark:bg-[#0D0E11]/60 dark:text-[#656C7A]">
                  在左侧粘贴 AI 批量回复（例如含「第1题」「第2题」），这里会自动拆成独立卡片。
                </div>
              ) : (
                <div className="space-y-2.5">
                  {visibleCards.map(({ item, idx }) => {
                    const selected =
                      idx === activeCardIdx &&
                      (importMode === 'independent' || pasteTarget === 'card');
                    const cardImages = [...item.images, ...(imagesByIndex[idx] ?? [])];
                    return (
                      <div
                        key={`${item.tempId}-${idx}`}
                        onClick={() => {
                          setActiveCardIdx(idx);
                          setPasteTarget('card');
                        }}
                        className={`cursor-pointer rounded-xl border p-3 transition ${
                          selected
                            ? 'border-[#181B22] bg-[#F7F6F2] ring-1 ring-[#181B22]/25 dark:border-[#F5F6FA]/70 dark:bg-[#1B1E25] dark:ring-white/25'
                            : 'border-slate-900/[0.08] bg-[#F7F6F2]/55 hover:border-slate-900/20 dark:border-white/[0.07] dark:bg-[#0D0E11]/70 dark:hover:border-white/15'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded bg-[#181B22] px-1.5 py-0.5 text-[11px] font-semibold text-white dark:bg-[#232730]">
                                {item.indexLabel}
                              </span>
                              {item.correctAnswer && (
                                <span className="rounded bg-emerald-500/12 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                  正解：{item.correctAnswer}
                                </span>
                              )}
                              {selected && (
                                <span className="rounded bg-[#C93B3B]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#C93B3B] dark:bg-[#F06A6A]/15 dark:text-[#F06A6A]">
                                  已选中 · 可 Ctrl+V 贴图
                                </span>
                              )}
                            </div>
                            <h3 className="mt-1 truncate text-sm font-semibold text-[#181B22] dark:text-[#F5F6FA]">
                              {item.suggestedTitle || '未识别标题'}
                            </h3>
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCardUploadClick(idx);
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-900/[0.1] bg-white px-2 py-1 text-[11px] font-medium text-[#181B22] hover:bg-slate-50 dark:border-white/[0.08] dark:bg-[#14161B] dark:text-[#E6E8EE]"
                            >
                              <ImagePlus className="h-3 w-3 text-[#C93B3B] dark:text-[#F06A6A]" />
                              贴图
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExcludeCard(idx);
                              }}
                              title="剔除此条"
                              className="rounded-md p-1 text-[#88909E] hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[#5B6270] dark:text-[#949BA8]">
                          {item.stemText || item.analysisMarkdown}
                        </p>

                        {cardImages.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {cardImages.map((img, imgIdx) => (
                              <div
                                key={img.id}
                                onClick={(e) => e.stopPropagation()}
                                className="relative h-14 w-20 overflow-hidden rounded-md border border-slate-900/[0.08] bg-white dark:border-white/[0.08] dark:bg-[#14161B]"
                              >
                                <img
                                  src={img.dataUrl}
                                  alt={`附图 ${imgIdx + 1}`}
                                  className="h-full w-full object-contain"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRemoveCardImage(idx, img.id)}
                                  className="absolute right-0.5 top-0.5 rounded-full bg-black/75 p-0.5 text-white hover:bg-red-600"
                                  aria-label="删除附图"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部动作栏 */}
        <div className="flex items-center justify-between border-t border-slate-900/[0.08] px-4 py-3 dark:border-white/[0.07] sm:px-6">
          <span className="text-xs text-[#5B6270] dark:text-[#949BA8]">
            {importMode === 'material'
              ? '导入后将合并为 1 套材料组合题并立即打开第 1 小题'
              : '导入后将自动跳转到第一道新题开始复盘'}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-900/[0.1] bg-white px-4 py-2 text-sm font-medium text-[#5B6270] hover:bg-black/[0.03] dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#E6E8EE]"
            >
              取消
            </button>
            <button
              type="button"
              disabled={visibleCards.length === 0 || !folderId || isCompressing}
              onClick={handleImportAll}
              className="rounded-lg bg-[#181B22] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#2C313D] disabled:cursor-not-allowed disabled:opacity-45 dark:bg-[#F5F6FA] dark:text-[#0D0E11] dark:hover:bg-white"
            >
              {importMode === 'material'
                ? `合并导入为 1 套材料组合题（含 ${visibleCards.length} 小题）`
                : `全部导入题库（${visibleCards.length} 题）`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
