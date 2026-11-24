/** 题目性质分类：错题 / 好题 / 经典母题 */
export type QuestionType = 'mistake' | 'gem' | 'template';

/** 熟练度三档：生疏 / 模糊 / 已掌握 */
export type MasteryLevel = 'unfamiliar' | 'vague' | 'mastered';

/** 刷题展示模式：自测（先题后解）/ 直看（题解同屏） */
export type ReviewMode = 'self_test' | 'direct';

/** 界面配色主题 */
export type ThemeMode = 'dark' | 'light';

/** 题型目录树节点 */
export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  /** 该题型的通用思维链口诀或破题套路 */
  chainTip?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

/** 题干或解析配图（压缩后的 DataURL） */
export interface QuestionImage {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  caption?: string;
}

/** 题目结构形态：普通单题 / 一拖N 材料组合题 */
export type QuestionEntryKind = 'single' | 'material';

/** 材料组合题（一拖N）中的单道小题 */
export interface SubQuestionItem {
  id: string;
  /** 小题标签，如 "第1题" */
  label?: string;
  /** 小题题干与 A/B/C/D 选项 */
  stemText: string;
  /** 该小题专属配图（可选，与共用材料图独立） */
  images: QuestionImage[];
  /** 错选答案（可选） */
  myWrongChoice?: string;
  /** 正确答案（可选，留空时自动从该小题解析提取） */
  correctAnswer?: string;
  /** 该小题的 AI 复盘 Markdown */
  analysisMarkdown: string;
  /** 该小题的个人笔记（可选） */
  personalNote?: string;
}

/** 单道题目实体 */
export interface QuestionItem {
  id: string;
  folderId: string;
  questionType: QuestionType;
  /** 题目结构形态：未指定时视为 'single'（100% 兼容历史题库） */
  entryKind?: QuestionEntryKind;
  /** 简短标题或题干首句摘要 */
  title: string;
  /** 原题文本；当 entryKind === 'material' 时作为共用大材料文本 */
  stemText: string;
  /** 原题附图（支持图推多图/资料分析共用统计图表） */
  images: QuestionImage[];
  /** 当 entryKind === 'material' 时存放多道小题 */
  subQuestions?: SubQuestionItem[];
  /** 用户错选答案（可选，如 B） */
  myWrongChoice?: string;
  /** 正确答案（可选，如 A） */
  correctAnswer?: string;
  /** AI 复盘 Markdown 全文 */
  analysisMarkdown: string;
  /** 用户自己的考场复盘笔记 */
  personalNote: string;
  tags: string[];
  mastery: MasteryLevel;
  starred: boolean;
  reviewCount: number;
  lastReviewedAt?: number;
  /** 下次到期复习时间戳（毫秒） */
  nextReviewAt: number;
  isSeedDemo?: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

/** 应用全量持久化快照（也是内嵌进自举 HTML 与全量 JSON 备份的数据结构） */
export interface AppStateSnapshot {
  version: number;
  exportedAt: number;
  theme: ThemeMode;
  reviewMode: ReviewMode;
  folders: FolderNode[];
  questions: QuestionItem[];
}

/** 轻量进度同步包（不含图片与题干长文，仅同步熟练度、复习记录与个人笔记） */
export interface ProgressOnlyPatch {
  kind: 'exam-review-progress-patch';
  version: number;
  exportedAt: number;
  items: Array<{
    id: string;
    mastery: MasteryLevel;
    starred: boolean;
    personalNote: string;
    reviewCount: number;
    lastReviewedAt?: number;
    nextReviewAt: number;
    updatedAt: number;
  }>;
}

/** 题库筛选条件 */
export interface ReviewFilter {
  /** null 表示全题库；否则包含该目录及其所有子孙目录 */
  folderId: string | null;
  scope: 'all' | 'due' | 'mistake' | 'gem' | 'template' | 'unmastered' | 'starred';
  searchQuery: string;
}
