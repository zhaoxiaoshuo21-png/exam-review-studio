import type {
  AppStateSnapshot,
  FolderNode,
  ProgressOnlyPatch,
  QuestionItem,
} from '../types/schema';
import {
  isValidSnapshot,
  readEmbeddedSnapshotFromDocument,
} from './htmlExporter';
import { createSeedSnapshot } from './seedData';

const IDB_NAME = 'ExamReviewStudioDB';
const IDB_VERSION = 1;
const IDB_STORE_NAME = 'snapshots';
const IDB_SNAPSHOT_KEY = 'primary';
const LOCAL_STORAGE_KEY = 'exam_review_studio_snapshot_v1';

let memorySnapshotStore: AppStateSnapshot | null = null;

export function resetMemoryStorageForTests(): void {
  memorySnapshotStore = null;
}

function openExamDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readFromIndexedDB(): Promise<AppStateSnapshot | null> {
  const db = await openExamDatabase();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.get(IDB_SNAPSHOT_KEY);
      req.onsuccess = () => {
        const val: unknown = req.result;
        resolve(isValidSnapshot(val) ? val : null);
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
      tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      try {
        db.close();
      } catch {
        // 忽略关闭异常
      }
      resolve(null);
    }
  });
}

async function writeToIndexedDB(snapshot: AppStateSnapshot): Promise<boolean> {
  const db = await openExamDatabase();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.put(snapshot, IDB_SNAPSHOT_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
      tx.onabort = () => {
        db.close();
        resolve(false);
      };
    } catch {
      try {
        db.close();
      } catch {
        // 忽略关闭异常
      }
      resolve(false);
    }
  });
}

function readFromLocalStorage(): AppStateSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeToLocalStorage(snapshot: AppStateSnapshot): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

function clearLocalStorageSafely(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // 忽略清理异常
  }
}

async function readLocalSnapshot(): Promise<AppStateSnapshot | null> {
  const idbSnapshot = await readFromIndexedDB();
  if (idbSnapshot) return idbSnapshot;

  const lsSnapshot = readFromLocalStorage();
  if (lsSnapshot) return lsSnapshot;

  return memorySnapshotStore;
}

/**
 * 持久化全量快照，按 IndexedDB -> localStorage -> 内存三层自动降级。
 */
export async function saveSnapshot(snapshot: AppStateSnapshot): Promise<void> {
  memorySnapshotStore = snapshot;

  const idbOk = await writeToIndexedDB(snapshot);
  if (idbOk) {
    // 尝试同步一份到 localStorage 提高极端环境下可读性；若超容则移除旧缓存防脏读
    if (!writeToLocalStorage(snapshot)) {
      clearLocalStorageSafely();
    }
    return;
  }

  writeToLocalStorage(snapshot);
}

interface TimestampedEntity {
  id: string;
  updatedAt: number;
  deletedAt?: number;
}

function pickNewerEntity<T extends TimestampedEntity>(localItem: T, incomingItem: T): T {
  const localEffective = Math.max(localItem.updatedAt ?? 0, localItem.deletedAt ?? 0);
  const incomingEffective = Math.max(
    incomingItem.updatedAt ?? 0,
    incomingItem.deletedAt ?? 0,
  );

  if (incomingEffective > localEffective) {
    return incomingItem;
  }
  if (localEffective > incomingEffective) {
    return localItem;
  }

  // 时间戳完全相同时，优先保留软删除墓碑避免已删条目复活，否则保留本地
  const localDeleted = localItem.deletedAt ?? 0;
  const incomingDeleted = incomingItem.deletedAt ?? 0;
  if (incomingDeleted > localDeleted) {
    return incomingItem;
  }
  return localItem;
}

function mergeEntityArrays<T extends TimestampedEntity>(
  localItems: T[],
  incomingItems: T[],
): T[] {
  const merged = new Map<string, T>();

  for (const item of localItems) {
    merged.set(item.id, item);
  }

  for (const item of incomingItems) {
    const existing = merged.get(item.id);
    if (!existing) {
      merged.set(item.id, item);
    } else {
      merged.set(item.id, pickNewerEntity(existing, item));
    }
  }

  return Array.from(merged.values());
}

/**
 * 按 id 与 updatedAt（含 deletedAt 软删除标记比较）无损合并本地与导入/内嵌快照。
 */
export function mergeSnapshots(
  local: AppStateSnapshot,
  incoming: AppStateSnapshot,
): AppStateSnapshot {
  const mergedFolders = mergeEntityArrays<FolderNode>(
    local.folders,
    incoming.folders,
  ).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);

  const mergedQuestions = mergeEntityArrays<QuestionItem>(
    local.questions,
    incoming.questions,
  );

  const useIncomingSettings = (incoming.exportedAt ?? 0) > (local.exportedAt ?? 0);

  return {
    version: Math.max(local.version ?? 1, incoming.version ?? 1),
    exportedAt: Math.max(local.exportedAt ?? 0, incoming.exportedAt ?? 0),
    theme: useIncomingSettings ? incoming.theme : local.theme,
    reviewMode: useIncomingSettings ? incoming.reviewMode : local.reviewMode,
    folders: mergedFolders,
    questions: mergedQuestions,
  };
}

/**
 * 启动加载初始化快照：
 * 1. 读取 `<script id="EXAM_REVIEW_EMBEDDED_DATA">` 内嵌快照与本地存储快照
 * 2. 若两者均存在则执行无损合并并回写，确保随身 HTML 携带新题且保留手机端最新进度
 * 3. 若均不存在则生成内置公考示范种子快照
 */
export async function loadInitialSnapshot(): Promise<AppStateSnapshot> {
  const embedded = readEmbeddedSnapshotFromDocument();
  const local = await readLocalSnapshot();

  if (embedded && local) {
    const merged = mergeSnapshots(local, embedded);
    await saveSnapshot(merged);
    return merged;
  }

  if (embedded) {
    await saveSnapshot(embedded);
    return embedded;
  }

  if (local) {
    memorySnapshotStore = local;
    return local;
  }

  const seed = createSeedSnapshot();
  await saveSnapshot(seed);
  return seed;
}

/**
 * 导出轻量进度同步包（仅含熟练度、收藏、个人笔记与复习计数，不含图片与题干长文）。
 */
export function exportProgressPatch(snapshot: AppStateSnapshot): ProgressOnlyPatch {
  const items = snapshot.questions
    .filter((q) => !q.deletedAt)
    .map((q) => ({
      id: q.id,
      mastery: q.mastery,
      starred: q.starred,
      personalNote: q.personalNote,
      reviewCount: q.reviewCount,
      ...(q.lastReviewedAt !== undefined ? { lastReviewedAt: q.lastReviewedAt } : {}),
      nextReviewAt: q.nextReviewAt,
      updatedAt: q.updatedAt,
    }));

  return {
    kind: 'exam-review-progress-patch',
    version: snapshot.version,
    exportedAt: Date.now(),
    items,
  };
}

/**
 * 将轻量进度同步包合并到当前快照中，仅在 patch 条目 updatedAt 更晚时更新对应题目。
 */
export function applyProgressPatch(
  snapshot: AppStateSnapshot,
  patch: ProgressOnlyPatch,
): { snapshot: AppStateSnapshot; updatedCount: number } {
  if (
    !patch ||
    patch.kind !== 'exam-review-progress-patch' ||
    !Array.isArray(patch.items)
  ) {
    throw new Error('无效的进度同步包格式，请确认选择了正确的进度同步 JSON 文件。');
  }

  const patchMap = new Map<string, ProgressOnlyPatch['items'][number]>();
  for (const item of patch.items) {
    if (!item || typeof item.id !== 'string') continue;
    const existing = patchMap.get(item.id);
    if (!existing || item.updatedAt > existing.updatedAt) {
      patchMap.set(item.id, item);
    }
  }

  let updatedCount = 0;
  const nextQuestions = snapshot.questions.map((question) => {
    if (question.deletedAt) return question;
    const incoming = patchMap.get(question.id);
    if (!incoming || incoming.updatedAt <= question.updatedAt) {
      return question;
    }

    updatedCount += 1;
    return {
      ...question,
      mastery: incoming.mastery,
      starred: incoming.starred,
      personalNote: incoming.personalNote,
      reviewCount: incoming.reviewCount,
      lastReviewedAt: incoming.lastReviewedAt,
      nextReviewAt: incoming.nextReviewAt,
      updatedAt: incoming.updatedAt,
    };
  });

  if (updatedCount === 0) {
    return { snapshot, updatedCount: 0 };
  }

  return {
    snapshot: {
      ...snapshot,
      exportedAt: Date.now(),
      questions: nextQuestions,
    },
    updatedCount,
  };
}

/**
 * 清空内置示范题（为未删除的 `isSeedDemo: true` 示例题写入 `deletedAt`/`updatedAt` 软删除墓碑，
 * 保留用户自录题目与目录树，确保跨端合并快照时已清空的示例题不会复活）。
 */
export function clearDemoQuestions(snapshot: AppStateSnapshot): AppStateSnapshot {
  const hasActiveDemo = snapshot.questions.some(
    (q) => q.isSeedDemo && !q.deletedAt,
  );
  if (!hasActiveDemo) {
    return snapshot;
  }

  const now = Date.now();
  const nextQuestions = snapshot.questions.map((q) => {
    if (q.isSeedDemo && !q.deletedAt) {
      return {
        ...q,
        deletedAt: now,
        updatedAt: now,
      };
    }
    return q;
  });

  return {
    ...snapshot,
    exportedAt: now,
    questions: nextQuestions,
  };
}
