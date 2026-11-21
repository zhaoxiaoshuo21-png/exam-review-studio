import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyProgressPatch,
  clearDemoQuestions,
  computeNextReviewAt,
  getDescendantFolderIds,
  loadInitialSnapshot,
  mergeSnapshots,
  saveSnapshot,
} from './core';
import { BatchImportModal } from './components/BatchImportModal';
import { ExportSyncModal } from './components/ExportSyncModal';
import { FolderTree } from './components/FolderTree';
import { QuestionList } from './components/QuestionList';
import { QuickAddModal } from './components/QuickAddModal';
import { ReviewDeck } from './components/ReviewDeck';
import { TopBar, type AppearanceSettings } from './components/TopBar';
import type { QuestionDraftInput } from './types/contracts';
import type {
  AppStateSnapshot,
  FolderNode,
  MasteryLevel,
  ProgressOnlyPatch,
  QuestionItem,
  ReviewFilter,
  ReviewMode,
} from './types/schema';

interface ToastState {
  id: number;
  message: string;
  tone: 'success' | 'info' | 'error';
}

const APPEARANCE_STORAGE_KEY = 'exam_review_appearance_v2';
const SIDEBAR_STORAGE_KEY = 'exam_review_desktop_sidebar_v2';

const DEFAULT_APPEARANCE: AppearanceSettings = {
  fontFamily: 'sans',
  fontSize: 'md',
  imgMode: 'original',
};

function readSavedAppearance(): AppearanceSettings {
  try {
    const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>;
    return {
      fontFamily:
        parsed.fontFamily === 'serif' || parsed.fontFamily === 'note'
          ? parsed.fontFamily
          : 'sans',
      fontSize:
        parsed.fontSize === 'sm' || parsed.fontSize === 'lg' ? parsed.fontSize : 'md',
      imgMode:
        parsed.imgMode === 'soft' || parsed.imgMode === 'invert'
          ? parsed.imgMode
          : 'original',
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function readSavedSidebarOpen(): boolean {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return raw === 'false' ? false : true;
  } catch {
    return true;
  }
}

function applyAppearanceDataset(settings: AppearanceSettings): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.font = settings.fontFamily;
  document.documentElement.dataset.fontSize = settings.fontSize;
  document.documentElement.dataset.imgMode = settings.imgMode;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function filterAndSortQuestions(
  questions: QuestionItem[],
  folders: FolderNode[],
  filter: ReviewFilter,
  now: number,
): QuestionItem[] {
  const activeFolders = folders.filter((f) => !f.deletedAt);
  const folderNameMap = new Map<string, string>(
    activeFolders.map((f) => [f.id, f.name]),
  );

  const allowedFolderIds =
    filter.folderId !== null
      ? new Set(getDescendantFolderIds(activeFolders, filter.folderId))
      : null;

  const query = filter.searchQuery.trim().toLowerCase();

  const matched = questions.filter((q) => {
    if (q.deletedAt) return false;
    if (allowedFolderIds && !allowedFolderIds.has(q.folderId)) return false;

    switch (filter.scope) {
      case 'due':
        if (q.nextReviewAt > now) return false;
        break;
      case 'mistake':
        if (q.questionType !== 'mistake') return false;
        break;
      case 'gem':
        if (q.questionType !== 'gem') return false;
        break;
      case 'template':
        if (q.questionType !== 'template') return false;
        break;
      case 'unmastered':
        if (q.mastery === 'mastered') return false;
        break;
      case 'starred':
        if (!q.starred) return false;
        break;
      case 'all':
      default:
        break;
    }

    if (query) {
      const folderName = folderNameMap.get(q.folderId) ?? '';
      const haystack = [
        q.title,
        q.stemText,
        q.analysisMarkdown,
        q.personalNote,
        q.tags.join(' '),
        folderName,
      ]
        .join('\n')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });

  // 今日到期题目优先，同桶内按创建时间升序保持稳定顺序
  return matched.sort((a, b) => {
    const aDue = a.nextReviewAt <= now ? 0 : 1;
    const bDue = b.nextReviewAt <= now ? 0 : 1;
    if (aDue !== bDue) return aDue - bDue;
    if (aDue === 0 && a.nextReviewAt !== b.nextReviewAt) {
      return a.nextReviewAt - b.nextReviewAt;
    }
    return a.createdAt - b.createdAt;
  });
}

function questionMatchesFilter(
  q: QuestionItem,
  folders: FolderNode[],
  filter: ReviewFilter,
  now: number,
): boolean {
  return filterAndSortQuestions([q], folders, filter, now).length > 0;
}

export function App(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<AppStateSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>({
    folderId: null,
    scope: 'all',
    searchQuery: '',
  });
  const [viewMode, setViewMode] = useState<'review' | 'list'>('review');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [autoAdvanceOnRate, setAutoAdvanceOnRate] = useState(true);
  const [isMobileFoldersOpen, setIsMobileFoldersOpen] = useState(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState<boolean>(() =>
    readSavedSidebarOpen(),
  );
  const [appearance, setAppearance] = useState<AppearanceSettings>(() =>
    readSavedAppearance(),
  );

  const [quickAddState, setQuickAddState] = useState<{
    isOpen: boolean;
    editingQuestion: QuestionItem | null;
  }>({ isOpen: false, editingQuestion: null });
  const [isBatchImportOpen, setIsBatchImportOpen] = useState(false);
  const [isExportSyncOpen, setIsExportSyncOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const hydratedRef = useRef(false);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingJumpIdRef = useRef<string | null>(null);
  const toastCounterRef = useRef(0);

  const showToast = useCallback(
    (message: string, tone: ToastState['tone'] = 'success') => {
      toastCounterRef.current += 1;
      setToast({ id: toastCounterRef.current, message, tone });
    },
    [],
  );

  // 同步排印与护眼偏好到 html dataset 并持久化到 localStorage
  useEffect(() => {
    applyAppearanceDataset(appearance);
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
    } catch {
      // 忽略受限环境存储异常
    }
  }, [appearance]);

  // 持久化桌面端侧栏折叠偏好
  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIDEBAR_STORAGE_KEY,
        String(isDesktopSidebarOpen),
      );
    } catch {
      // 忽略受限环境存储异常
    }
  }, [isDesktopSidebarOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 初始加载快照
  useEffect(() => {
    let active = true;
    loadInitialSnapshot()
      .then((initial) => {
        if (!active) return;
        setSnapshot(initial);
        document.documentElement.classList.toggle('dark', initial.theme === 'dark');
        hydratedRef.current = true;
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : '加载本地题库失败');
      });

    return () => {
      active = false;
    };
  }, []);

  // 同步 HTML dark 类并串行防抖保存快照
  useEffect(() => {
    if (!snapshot || !hydratedRef.current) return;
    document.documentElement.classList.toggle('dark', snapshot.theme === 'dark');

    const snapshotToSave = snapshot;
    const timer = window.setTimeout(() => {
      saveChainRef.current = saveChainRef.current
        .then(() => saveSnapshot(snapshotToSave))
        .catch(() => {
          // 存储层内部已做降级处理，这里避免未捕获异常
        });
    }, 60);

    return () => window.clearTimeout(timer);
  }, [snapshot]);

  // 关闭/刷新页面前尽力刷出最新快照
  useEffect(() => {
    const flushOnUnload = () => {
      if (snapshot && hydratedRef.current) {
        void saveSnapshot(snapshot);
      }
    };
    window.addEventListener('beforeunload', flushOnUnload);
    return () => window.removeEventListener('beforeunload', flushOnUnload);
  }, [snapshot]);

  const activeFolders = useMemo(
    () => (snapshot ? snapshot.folders.filter((f) => !f.deletedAt) : []),
    [snapshot],
  );

  const activeQuestions = useMemo(
    () => (snapshot ? snapshot.questions.filter((q) => !q.deletedAt) : []),
    [snapshot],
  );

  const nowTs = Date.now();

  const dueCount = useMemo(
    () => activeQuestions.filter((q) => q.nextReviewAt <= nowTs).length,
    [activeQuestions, nowTs],
  );

  const filteredQuestions = useMemo(() => {
    if (!snapshot) return [];
    return filterAndSortQuestions(snapshot.questions, snapshot.folders, filter, Date.now());
  }, [snapshot, filter]);

  // 当新增/批量导入需要跳转到指定新题时，在列表更新后定位到它
  useEffect(() => {
    const jumpId = pendingJumpIdRef.current;
    if (!jumpId) return;
    const idx = filteredQuestions.findIndex((q) => q.id === jumpId);
    if (idx >= 0) {
      setCurrentIndex(idx);
      pendingJumpIdRef.current = null;
    }
  }, [filteredQuestions]);

  // 当前索引越界保护
  const safeIndex = useMemo(() => {
    if (filteredQuestions.length === 0) return 0;
    return Math.max(0, Math.min(currentIndex, filteredQuestions.length - 1));
  }, [currentIndex, filteredQuestions.length]);

  useEffect(() => {
    if (safeIndex !== currentIndex) {
      setCurrentIndex(safeIndex);
    }
  }, [safeIndex, currentIndex]);

  const handleFilterChange = useCallback((next: ReviewFilter) => {
    setFilter(next);
    setCurrentIndex(0);
  }, []);

  const handleToggleTheme = useCallback(() => {
    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        theme: prev.theme === 'dark' ? 'light' : 'dark',
      };
    });
  }, []);

  const handleToggleDesktopSidebar = useCallback(() => {
    setIsDesktopSidebarOpen((prev) => !prev);
  }, []);

  const handleChangeReviewMode = useCallback((mode: ReviewMode) => {
    setSnapshot((prev) => (prev ? { ...prev, reviewMode: mode } : prev));
  }, []);

  const handleSelectFolder = useCallback((folderId: string | null) => {
    setFilter((prev) => ({ ...prev, folderId }));
    setCurrentIndex(0);
  }, []);

  const handleCreateFolder = useCallback(
    (parentId: string | null, name: string, chainTip?: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const now = Date.now();
      setSnapshot((prev) => {
        if (!prev) return prev;
        const siblings = prev.folders.filter(
          (f) => !f.deletedAt && (f.parentId ?? null) === parentId,
        );
        const maxOrder = siblings.reduce((m, s) => Math.max(m, s.order), 0);
        const newFolder: FolderNode = {
          id: makeId('fld'),
          name: trimmed,
          parentId,
          chainTip: chainTip?.trim() || undefined,
          order: maxOrder + 1,
          createdAt: now,
          updatedAt: now,
        };
        return {
          ...prev,
          folders: [...prev.folders, newFolder],
        };
      });
      showToast(`已新建目录「${trimmed}」`);
    },
    [showToast],
  );

  const handleUpdateFolder = useCallback(
    (
      folderId: string,
      patch: { name?: string; chainTip?: string; parentId?: string | null },
    ) => {
      const now = Date.now();
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          folders: prev.folders.map((f) =>
            f.id === folderId
              ? {
                  ...f,
                  ...(patch.name !== undefined ? { name: patch.name.trim() || f.name } : {}),
                  ...(patch.chainTip !== undefined
                    ? { chainTip: patch.chainTip.trim() || undefined }
                    : {}),
                  ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
                  updatedAt: now,
                }
              : f,
          ),
        };
      });
      showToast('已更新目录信息');
    },
    [showToast],
  );

  const handleDeleteFolder = useCallback(
    (folderId: string) => {
      const now = Date.now();
      setSnapshot((prev) => {
        if (!prev) return prev;
        const active = prev.folders.filter((f) => !f.deletedAt);
        const target = active.find((f) => f.id === folderId);
        if (!target) return prev;

        const deleteIds = new Set(getDescendantFolderIds(active, folderId));
        const remainingRoots = active.filter(
          (f) => !deleteIds.has(f.id) && f.parentId === null,
        );
        const fallbackFolderId =
          target.parentId && !deleteIds.has(target.parentId)
            ? target.parentId
            : remainingRoots[0]?.id ??
              active.find((f) => !deleteIds.has(f.id))?.id ??
              '';

        return {
          ...prev,
          folders: prev.folders.map((f) =>
            deleteIds.has(f.id) ? { ...f, deletedAt: now, updatedAt: now } : f,
          ),
          questions: prev.questions.map((q) =>
            !q.deletedAt && deleteIds.has(q.folderId) && fallbackFolderId
              ? { ...q, folderId: fallbackFolderId, updatedAt: now }
              : q,
          ),
        };
      });

      setFilter((prev) =>
        prev.folderId === folderId ? { ...prev, folderId: null } : prev,
      );
      showToast('已删除目录（原目录下题目已安全保留）', 'info');
    },
    [showToast],
  );

  const handleRateMastery = useCallback(
    (questionId: string, mastery: MasteryLevel) => {
      if (!snapshot) return;
      const now = Date.now();
      const oldIdx = filteredQuestions.findIndex((q) => q.id === questionId);

      const nextQuestions = snapshot.questions.map((q) => {
        if (q.id !== questionId) return q;
        const nextReviewAt = computeNextReviewAt(mastery, q.reviewCount, now);
        return {
          ...q,
          mastery,
          reviewCount: q.reviewCount + 1,
          lastReviewedAt: now,
          nextReviewAt,
          updatedAt: now,
        };
      });

      const nextSnapshot: AppStateSnapshot = {
        ...snapshot,
        questions: nextQuestions,
      };
      setSnapshot(nextSnapshot);

      if (autoAdvanceOnRate && oldIdx >= 0) {
        const nextFiltered = filterAndSortQuestions(
          nextQuestions,
          snapshot.folders,
          filter,
          now,
        );
        if (nextFiltered.length === 0) {
          setCurrentIndex(0);
        } else if (nextFiltered[oldIdx]?.id === questionId) {
          setCurrentIndex(Math.min(oldIdx + 1, nextFiltered.length - 1));
        } else {
          setCurrentIndex(Math.min(oldIdx, nextFiltered.length - 1));
        }
      }

      const labelMap: Record<MasteryLevel, string> = {
        unfamiliar: '生疏（明天复习）',
        vague: '模糊（3天后复习）',
        mastered: '已掌握（按间隔巩固）',
      };
      showToast(`已标记为${labelMap[mastery]}`);
    },
    [snapshot, filteredQuestions, autoAdvanceOnRate, filter, showToast],
  );

  const handleToggleStar = useCallback((questionId: string) => {
    const now = Date.now();
    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: prev.questions.map((q) =>
          q.id === questionId ? { ...q, starred: !q.starred, updatedAt: now } : q,
        ),
      };
    });
  }, []);

  const handleUpdateQuestionInline = useCallback(
    (
      questionId: string,
      patch: Partial<
        Pick<QuestionItem, 'analysisMarkdown' | 'personalNote' | 'title' | 'stemText'>
      >,
    ) => {
      const now = Date.now();
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          questions: prev.questions.map((q) =>
            q.id === questionId ? { ...q, ...patch, updatedAt: now } : q,
          ),
        };
      });
      showToast('已保存题目修改');
    },
    [showToast],
  );

  const handleDeleteQuestion = useCallback(
    (questionId: string) => {
      const now = Date.now();
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          questions: prev.questions.map((q) =>
            q.id === questionId ? { ...q, deletedAt: now, updatedAt: now } : q,
          ),
        };
      });
      showToast('已删除该题目', 'info');
    },
    [showToast],
  );

  const handleSaveQuickAdd = useCallback(
    (draft: QuestionDraftInput) => {
      if (!snapshot) return;
      const now = Date.now();
      let targetId = draft.id;
      let targetQuestion: QuestionItem;

      if (draft.id) {
        const existing = snapshot.questions.find((q) => q.id === draft.id);
        if (existing) {
          const masteryChanged = existing.mastery !== draft.mastery;
          targetQuestion = {
            ...existing,
            folderId: draft.folderId,
            questionType: draft.questionType,
            title: draft.title,
            stemText: draft.stemText,
            images: draft.images,
            myWrongChoice: draft.myWrongChoice,
            correctAnswer: draft.correctAnswer,
            analysisMarkdown: draft.analysisMarkdown,
            personalNote: draft.personalNote,
            tags: draft.tags,
            mastery: draft.mastery,
            starred: draft.starred,
            nextReviewAt: masteryChanged
              ? draft.mastery === 'unfamiliar'
                ? now
                : computeNextReviewAt(draft.mastery, existing.reviewCount, now)
              : existing.nextReviewAt,
            updatedAt: now,
          };
          setSnapshot((prev) =>
            prev
              ? {
                  ...prev,
                  questions: prev.questions.map((q) =>
                    q.id === existing.id ? targetQuestion : q,
                  ),
                }
              : prev,
          );
          targetId = existing.id;
          showToast('已更新题目内容');
        } else {
          return;
        }
      } else {
        targetId = makeId('q');
        targetQuestion = {
          id: targetId,
          folderId: draft.folderId,
          questionType: draft.questionType,
          title: draft.title,
          stemText: draft.stemText,
          images: draft.images,
          myWrongChoice: draft.myWrongChoice,
          correctAnswer: draft.correctAnswer,
          analysisMarkdown: draft.analysisMarkdown,
          personalNote: draft.personalNote,
          tags: draft.tags,
          mastery: draft.mastery,
          starred: draft.starred,
          reviewCount: 0,
          nextReviewAt:
            draft.mastery === 'unfamiliar'
              ? now
              : computeNextReviewAt(draft.mastery, 0, now),
          createdAt: now,
          updatedAt: now,
        };
        setSnapshot((prev) =>
          prev ? { ...prev, questions: [...prev.questions, targetQuestion] } : prev,
        );
        showToast('已录入新题到题库');
      }

      if (!questionMatchesFilter(targetQuestion, snapshot.folders, filter, now)) {
        setFilter((prev) => ({
          folderId:
            prev.folderId &&
            !getDescendantFolderIds(activeFolders, prev.folderId).includes(
              targetQuestion.folderId,
            )
              ? null
              : prev.folderId,
          scope: 'all',
          searchQuery: '',
        }));
      }

      if (targetId) {
        pendingJumpIdRef.current = targetId;
      }
      setQuickAddState({ isOpen: false, editingQuestion: null });
      setViewMode('review');
    },
    [snapshot, filter, activeFolders, showToast],
  );

  const handleImportBatch = useCallback(
    (drafts: QuestionDraftInput[]) => {
      if (!snapshot || drafts.length === 0) return;
      const now = Date.now();
      const created: QuestionItem[] = drafts.map((draft, idx) => ({
        id: `${makeId('q')}_${idx}`,
        folderId: draft.folderId,
        questionType: draft.questionType,
        title: draft.title,
        stemText: draft.stemText,
        images: draft.images,
        myWrongChoice: draft.myWrongChoice,
        correctAnswer: draft.correctAnswer,
        analysisMarkdown: draft.analysisMarkdown,
        personalNote: draft.personalNote,
        tags: draft.tags,
        mastery: draft.mastery,
        starred: draft.starred,
        reviewCount: 0,
        nextReviewAt:
          draft.mastery === 'unfamiliar'
            ? now + idx
            : computeNextReviewAt(draft.mastery, 0, now + idx),
        createdAt: now + idx,
        updatedAt: now + idx,
      }));

      setSnapshot((prev) =>
        prev ? { ...prev, questions: [...prev.questions, ...created] } : prev,
      );

      const firstNew = created[0];
      setFilter({
        folderId: firstNew.folderId,
        scope: 'all',
        searchQuery: '',
      });
      pendingJumpIdRef.current = firstNew.id;
      setIsBatchImportOpen(false);
      setViewMode('review');
      showToast(`已批量导入 ${created.length} 道题，已跳转到第 1 道新题`);
    },
    [snapshot, showToast],
  );

  const handleSelectQuestionFromList = useCallback(
    (questionId: string) => {
      const idx = filteredQuestions.findIndex((q) => q.id === questionId);
      if (idx >= 0) {
        setCurrentIndex(idx);
      }
      setViewMode('review');
    },
    [filteredQuestions],
  );

  const handleReplaceSnapshot = useCallback(
    (next: AppStateSnapshot, message: string) => {
      setSnapshot(next);
      setFilter({ folderId: null, scope: 'all', searchQuery: '' });
      setCurrentIndex(0);
      showToast(message);
    },
    [showToast],
  );

  const handleMergeSnapshot = useCallback(
    (incoming: AppStateSnapshot) => {
      setSnapshot((prev) => (prev ? mergeSnapshots(prev, incoming) : incoming));
      showToast('已无损合并备份数据');
    },
    [showToast],
  );

  const handleApplyProgressPatch = useCallback(
    (patch: ProgressOnlyPatch) => {
      if (!snapshot) return;
      const { snapshot: next, updatedCount } = applyProgressPatch(snapshot, patch);
      setSnapshot(next);
      showToast(`进度包合并完成，共更新 ${updatedCount} 道题`);
    },
    [snapshot, showToast],
  );

  const handleClearDemoQuestions = useCallback(() => {
    setSnapshot((prev) => (prev ? clearDemoQuestions(prev) : prev));
    setCurrentIndex(0);
    showToast('已清空内置示范题', 'info');
  }, [showToast]);

  const handleOpenQuickAdd = useCallback(() => {
    setQuickAddState({ isOpen: true, editingQuestion: null });
  }, []);

  const handleOpenEditModal = useCallback((question: QuestionItem) => {
    setQuickAddState({ isOpen: true, editingQuestion: question });
  }, []);

  const handleCloseQuickAdd = useCallback(() => {
    setQuickAddState({ isOpen: false, editingQuestion: null });
  }, []);

  const handleCloseBatchImport = useCallback(() => {
    setIsBatchImportOpen(false);
  }, []);

  const handleCloseExportSync = useCallback(() => {
    setIsExportSyncOpen(false);
  }, []);

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0D0E11] p-6 text-[#E6E8EE]">
        <div className="max-w-md rounded-2xl border border-red-500/30 bg-[#14161B] p-6 text-center">
          <h1 className="text-lg font-bold text-[#F06A6A]">初始化题库失败</h1>
          <p className="mt-2 text-sm text-[#949BA8]">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F6F2] text-sm text-[#5B6270] dark:bg-[#0D0E11] dark:text-[#949BA8]">
        正在加载备考复盘本...
      </div>
    );
  }

  const currentQuestion = filteredQuestions[safeIndex];

  return (
    <div className="flex min-h-screen flex-col bg-[#F7F6F2] text-[#181B22] dark:bg-[#0D0E11] dark:text-[#E6E8EE]">
      <TopBar
        filter={filter}
        viewMode={viewMode}
        theme={snapshot.theme}
        totalCount={activeQuestions.length}
        dueCount={dueCount}
        onChangeFilter={handleFilterChange}
        onChangeViewMode={setViewMode}
        onToggleTheme={handleToggleTheme}
        onOpenMobileFolders={() => setIsMobileFoldersOpen(true)}
        onOpenQuickAdd={handleOpenQuickAdd}
        onOpenBatchImport={() => setIsBatchImportOpen(true)}
        onOpenExportSync={() => setIsExportSyncOpen(true)}
        isDesktopSidebarOpen={isDesktopSidebarOpen}
        onToggleDesktopSidebar={handleToggleDesktopSidebar}
        appearance={appearance}
        onChangeAppearance={setAppearance}
      />

      <div className="mx-auto flex w-full max-w-[1680px] flex-1">
        <div className={isDesktopSidebarOpen ? 'contents' : 'contents lg:hidden'}>
          <FolderTree
            folders={activeFolders}
            questions={activeQuestions}
            selectedFolderId={filter.folderId}
            onSelectFolder={handleSelectFolder}
            onCreateFolder={handleCreateFolder}
            onUpdateFolder={handleUpdateFolder}
            onDeleteFolder={handleDeleteFolder}
            isMobileOpen={isMobileFoldersOpen}
            onCloseMobile={() => setIsMobileFoldersOpen(false)}
          />
        </div>

        <main
          className={`min-w-0 flex-1 ${
            viewMode === 'review'
              ? 'px-2.5 py-2 sm:px-4 lg:p-0'
              : 'px-3 py-4 sm:px-6 lg:px-8 lg:py-6'
          }`}
        >
          {viewMode === 'review' ? (
            <ReviewDeck
              questions={filteredQuestions}
              folders={activeFolders}
              currentIndex={safeIndex}
              reviewMode={snapshot.reviewMode}
              autoAdvanceOnRate={autoAdvanceOnRate}
              onChangeIndex={setCurrentIndex}
              onChangeReviewMode={handleChangeReviewMode}
              onToggleAutoAdvance={setAutoAdvanceOnRate}
              onRateMastery={handleRateMastery}
              onToggleStar={handleToggleStar}
              onUpdateQuestionInline={handleUpdateQuestionInline}
              onOpenEditModal={handleOpenEditModal}
              onDeleteQuestion={handleDeleteQuestion}
              onOpenQuickAdd={handleOpenQuickAdd}
            />
          ) : (
            <QuestionList
              questions={filteredQuestions}
              folders={activeFolders}
              currentQuestionId={currentQuestion?.id}
              onSelectQuestion={handleSelectQuestionFromList}
              onEditQuestion={handleOpenEditModal}
              onDeleteQuestion={handleDeleteQuestion}
              onToggleStar={handleToggleStar}
            />
          )}
        </main>
      </div>

      <QuickAddModal
        isOpen={quickAddState.isOpen}
        folders={activeFolders}
        defaultFolderId={filter.folderId}
        editingQuestion={quickAddState.editingQuestion}
        onClose={handleCloseQuickAdd}
        onSave={handleSaveQuickAdd}
      />

      <BatchImportModal
        isOpen={isBatchImportOpen}
        folders={activeFolders}
        defaultFolderId={filter.folderId}
        onClose={handleCloseBatchImport}
        onImportBatch={handleImportBatch}
      />

      <ExportSyncModal
        isOpen={isExportSyncOpen}
        snapshot={snapshot}
        onClose={handleCloseExportSync}
        onReplaceSnapshot={handleReplaceSnapshot}
        onMergeSnapshot={handleMergeSnapshot}
        onApplyProgressPatch={handleApplyProgressPatch}
        onClearDemoQuestions={handleClearDemoQuestions}
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-16 left-1/2 z-[60] -translate-x-1/2 rounded-full border px-4 py-2 text-xs font-medium shadow-lg backdrop-blur sm:bottom-6 ${
            toast.tone === 'error'
              ? 'border-red-400/50 bg-red-600/95 text-white'
              : toast.tone === 'info'
                ? 'border-slate-900/10 bg-[#181B22]/95 text-white dark:border-white/10 dark:bg-[#1E2128]/95'
                : 'border-emerald-500/30 bg-[#181B22]/95 text-white dark:border-emerald-400/25 dark:bg-[#14161B]/95 dark:text-emerald-300'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
