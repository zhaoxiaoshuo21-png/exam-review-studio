import type {
  AppStateSnapshot,
  FolderNode,
  MasteryLevel,
  ProgressOnlyPatch,
  QuestionImage,
  QuestionItem,
  QuestionType,
  ReviewFilter,
  ReviewMode,
  ThemeMode,
} from './schema';

/** 批量拆题单条预览结果 */
export interface ParsedBatchItem {
  tempId: string;
  indexLabel: string;
  suggestedTitle: string;
  stemText: string;
  analysisMarkdown: string;
  correctAnswer?: string;
  images: QuestionImage[];
}

/** 核心引擎层必须由 src/core/* 导出的统一契约 */
export interface CoreEngineContracts {
  loadInitialSnapshot: () => Promise<AppStateSnapshot>;
  saveSnapshot: (snapshot: AppStateSnapshot) => Promise<void>;
  mergeSnapshots: (local: AppStateSnapshot, incoming: AppStateSnapshot) => AppStateSnapshot;
  exportProgressPatch: (snapshot: AppStateSnapshot) => ProgressOnlyPatch;
  applyProgressPatch: (snapshot: AppStateSnapshot, patch: ProgressOnlyPatch) => {
    snapshot: AppStateSnapshot;
    updatedCount: number;
  };
  compressImageFile: (blob: Blob) => Promise<QuestionImage>;
  extractClipboardImages: (clipboardData: DataTransfer | null) => Promise<QuestionImage[]>;
  renderAnalysisHtml: (markdown: string) => string;
  parseBatchAnalysis: (rawText: string) => ParsedBatchItem[];
  exportSelfContainedHtml: (
    snapshot: AppStateSnapshot,
    filename?: string,
  ) => { ok: boolean; reason?: string; html?: string; sizeBytes?: number };
  buildSelfContainedHtmlString: (
    docHtml: string,
    snapshot: AppStateSnapshot,
  ) => string;
  computeNextReviewAt: (mastery: MasteryLevel, prevReviewCount: number, now?: number) => number;
  createSeedSnapshot: () => AppStateSnapshot;
}

/** ui-review 组件 Props 契约 */
export interface FolderTreeProps {
  folders: FolderNode[];
  questions: QuestionItem[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (parentId: string | null, name: string, chainTip?: string) => void;
  onUpdateFolder: (folderId: string, patch: { name?: string; chainTip?: string; parentId?: string | null }) => void;
  onDeleteFolder: (folderId: string) => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

export interface ReviewDeckProps {
  questions: QuestionItem[];
  folders: FolderNode[];
  currentIndex: number;
  reviewMode: ReviewMode;
  autoAdvanceOnRate: boolean;
  onChangeIndex: (index: number) => void;
  onChangeReviewMode: (mode: ReviewMode) => void;
  onToggleAutoAdvance: (enabled: boolean) => void;
  onRateMastery: (questionId: string, mastery: MasteryLevel) => void;
  onToggleStar: (questionId: string) => void;
  onUpdateQuestionInline: (
    questionId: string,
    patch: Partial<Pick<QuestionItem, 'analysisMarkdown' | 'personalNote' | 'title' | 'stemText'>>,
  ) => void;
  onOpenEditModal: (question: QuestionItem) => void;
  onDeleteQuestion: (questionId: string) => void;
  onOpenQuickAdd: () => void;
}

export interface MarkdownViewProps {
  markdown: string;
  editable?: boolean;
  onSaveMarkdown?: (nextMarkdown: string) => void;
  placeholder?: string;
}

export interface ImageLightboxProps {
  images: QuestionImage[];
  initialIndex: number;
  isOpen: boolean;
  onClose: () => void;
}

export interface QuestionListProps {
  questions: QuestionItem[];
  folders: FolderNode[];
  currentQuestionId?: string;
  onSelectQuestion: (questionId: string) => void;
  onEditQuestion: (question: QuestionItem) => void;
  onDeleteQuestion: (questionId: string) => void;
  onToggleStar: (questionId: string) => void;
}

/** ui-capture 组件 Props 契约（供对照引用） */
export interface TopBarProps {
  filter: ReviewFilter;
  viewMode: 'review' | 'list';
  theme: ThemeMode;
  totalCount: number;
  dueCount: number;
  onChangeFilter: (next: ReviewFilter) => void;
  onChangeViewMode: (mode: 'review' | 'list') => void;
  onToggleTheme: () => void;
  onOpenMobileFolders: () => void;
  onOpenQuickAdd: () => void;
  onOpenBatchImport: () => void;
  onOpenExportSync: () => void;
}

export type QuestionDraftInput = {
  id?: string;
  folderId: string;
  questionType: QuestionType;
  title: string;
  stemText: string;
  images: QuestionImage[];
  myWrongChoice?: string;
  correctAnswer?: string;
  analysisMarkdown: string;
  personalNote: string;
  tags: string[];
  mastery: MasteryLevel;
  starred: boolean;
};
