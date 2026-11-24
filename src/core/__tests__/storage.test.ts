import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyProgressPatch,
  clearDemoQuestions,
  createSeedSnapshot,
  exportProgressPatch,
  loadInitialSnapshot,
  mergeSnapshots,
  resetMemoryStorageForTests,
  saveSnapshot,
} from '../index';
import type { AppStateSnapshot } from '../../types/schema';

const CLOSING_SCRIPT = '<' + '/script>';

describe('storage', () => {
  beforeEach(() => {
    resetMemoryStorageForTests();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('prefers IndexedDB (ExamReviewStudioDB) when available before localStorage/memory', async () => {
    const storeMap = new Map<string, unknown>();
    let openedDbName = '';

    const mockObjectStore = {
      put: (val: unknown, key: string) => {
        storeMap.set(key, val);
      },
      get: (key: string) => {
        const req: { result?: unknown; onsuccess?: () => void; onerror?: () => void } = {};
        queueMicrotask(() => {
          req.result = storeMap.get(key);
          req.onsuccess?.();
        });
        return req;
      },
    };

    const mockDb = {
      objectStoreNames: { contains: () => true },
      createObjectStore: vi.fn(),
      close: vi.fn(),
      transaction: () => {
        const tx: {
          objectStore: () => typeof mockObjectStore;
          oncomplete?: () => void;
          onerror?: () => void;
          onabort?: () => void;
        } = {
          objectStore: () => mockObjectStore,
        };
        queueMicrotask(() => tx.oncomplete?.());
        return tx;
      },
    };

    vi.stubGlobal('indexedDB', {
      open: (name: string) => {
        openedDbName = name;
        const req: {
          result: typeof mockDb;
          onupgradeneeded?: () => void;
          onsuccess?: () => void;
          onerror?: () => void;
          onblocked?: () => void;
        } = { result: mockDb };
        queueMicrotask(() => {
          req.onupgradeneeded?.();
          req.onsuccess?.();
        });
        return req;
      },
    });

    const seed = createSeedSnapshot();
    seed.questions[0].personalNote = 'IndexedDB 主存储写入成功';
    await saveSnapshot(seed);
    localStorage.clear();

    const loaded = await loadInitialSnapshot();
    expect(openedDbName).toBe('ExamReviewStudioDB');
    expect(loaded.questions[0].personalNote).toBe('IndexedDB 主存储写入成功');
  });

  it('falls back from IndexedDB to localStorage and then to in-memory storage', async () => {
    // 1. jsdom 默认无 indexedDB -> 降级到 localStorage
    const seed = createSeedSnapshot();
    seed.questions[0].personalNote = 'localStorage 降级写入成功';
    await saveSnapshot(seed);

    const loadedFromLs = await loadInitialSnapshot();
    expect(loadedFromLs.questions[0].personalNote).toBe('localStorage 降级写入成功');

    // 2. 模拟 localStorage 也抛出 QuotaExceededError/SecurityError -> 降级到内存存储
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    const memSnap = createSeedSnapshot();
    memSnap.questions[0].personalNote = '内存兜底保存成功';
    await saveSnapshot(memSnap);

    const loadedFromMemory = await loadInitialSnapshot();
    expect(loadedFromMemory.questions[0].personalNote).toBe('内存兜底保存成功');
  });

  it('merges local and incoming snapshots by id, updatedAt, and deletedAt tombstones', () => {
    const base = createSeedSnapshot();
    const local: AppStateSnapshot = structuredClone(base);
    const incoming: AppStateSnapshot = structuredClone(base);

    // 本地修改第 1 题进度且时间戳更新
    local.questions[0].mastery = 'mastered';
    local.questions[0].updatedAt = base.questions[0].updatedAt + 5000;

    // 远端软删除第 2 题且时间戳更新
    incoming.questions[1].deletedAt = base.questions[1].updatedAt + 8000;
    incoming.questions[1].updatedAt = base.questions[1].updatedAt + 8000;

    // 远端新增第 3 题
    incoming.questions.push({
      ...base.questions[0],
      id: 'q-new-3',
      title: '新导入题目',
      isSeedDemo: false,
      createdAt: 999999,
      updatedAt: 999999,
    });

    const merged = mergeSnapshots(local, incoming);
    expect(merged.questions).toHaveLength(3);
    expect(merged.questions.find((q) => q.id === 'seed-q-1')?.mastery).toBe('mastered');
    expect(merged.questions.find((q) => q.id === 'seed-q-2')?.deletedAt).toBeDefined();
    expect(merged.questions.find((q) => q.id === 'q-new-3')?.title).toBe('新导入题目');
  });

  it('loads embedded script snapshot and merges lossless with newer local progress', async () => {
    const local = createSeedSnapshot();
    local.questions[0].mastery = 'mastered';
    local.questions[0].personalNote = '手机端刚复习掌握';
    local.questions[0].updatedAt = local.questions[0].updatedAt + 10_000;
    await saveSnapshot(local);

    const embedded = createSeedSnapshot();
    embedded.questions.push({
      ...embedded.questions[0],
      id: 'pc-added-q',
      title: '电脑端新增题',
      isSeedDemo: false,
      createdAt: Date.now() + 20_000,
      updatedAt: Date.now() + 20_000,
    });

    document.body.innerHTML = `<script id="EXAM_REVIEW_EMBEDDED_DATA" type="application/json">${JSON.stringify(
      embedded,
    )}${CLOSING_SCRIPT}`;

    const initial = await loadInitialSnapshot();
    expect(initial.questions).toHaveLength(3);
    expect(initial.questions.find((q) => q.id === 'seed-q-1')?.personalNote).toBe(
      '手机端刚复习掌握',
    );
    expect(initial.questions.find((q) => q.id === 'pc-added-q')?.title).toBe(
      '电脑端新增题',
    );
  });

  it('exports compact progress patch and applies only newer updates', () => {
    const local = createSeedSnapshot();
    const patchSource = structuredClone(local);

    patchSource.questions[0].mastery = 'mastered';
    patchSource.questions[0].reviewCount = 3;
    patchSource.questions[0].personalNote = '手机刷题新笔记';
    patchSource.questions[0].updatedAt = local.questions[0].updatedAt + 60_000;

    // 第 2 题保持旧时间戳，不应覆盖
    patchSource.questions[1].mastery = 'unfamiliar';
    patchSource.questions[1].updatedAt = local.questions[1].updatedAt - 1000;

    const patch = exportProgressPatch(patchSource);
    expect(patch.kind).toBe('exam-review-progress-patch');
    expect(patch.items).toHaveLength(2);
    // 确认轻量同步包不包含图片或题干
    expect('images' in patch.items[0]).toBe(false);
    expect('stemText' in patch.items[0]).toBe(false);

    const { snapshot: updated, updatedCount } = applyProgressPatch(local, patch);
    expect(updatedCount).toBe(1);
    expect(updated.questions[0].mastery).toBe('mastered');
    expect(updated.questions[0].personalNote).toBe('手机刷题新笔记');
    expect(updated.questions[1].mastery).toBe(local.questions[1].mastery);
  });

  it('soft-deletes only isSeedDemo questions with deletedAt tombstones and prevents resurrection on merge', () => {
    const oldSeed = createSeedSnapshot();
    const withUser = structuredClone(oldSeed);
    withUser.questions.push({
      ...withUser.questions[0],
      id: 'user-q-1',
      title: '用户自录真题',
      isSeedDemo: false,
    });

    // 纯示例题清空后活跃题数为 0，全部带有 deletedAt 墓碑，再次调用保持原样不重复改写
    const clearedSeedOnly = clearDemoQuestions(oldSeed);
    expect(clearedSeedOnly.questions.filter((q) => !q.deletedAt)).toHaveLength(0);
    expect(clearedSeedOnly.questions.every((q) => typeof q.deletedAt === 'number')).toBe(
      true,
    );
    expect(clearDemoQuestions(clearedSeedOnly)).toBe(clearedSeedOnly);

    // 与旧版未删除示例题的快照双向合并时，示例题仍保持 deletedAt 不复活
    const mergedFromOld = mergeSnapshots(clearedSeedOnly, oldSeed);
    const mergedToOld = mergeSnapshots(oldSeed, clearedSeedOnly);
    expect(mergedFromOld.questions.filter((q) => !q.deletedAt)).toHaveLength(0);
    expect(mergedToOld.questions.filter((q) => !q.deletedAt)).toHaveLength(0);
    expect(mergedFromOld.questions.every((q) => typeof q.deletedAt === 'number')).toBe(
      true,
    );

    // 包含用户自录题时仅软删除示例题，用户题与目录完整保留
    const clearedWithUser = clearDemoQuestions(withUser);
    expect(clearedWithUser.folders).toHaveLength(withUser.folders.length);
    const activeQuestions = clearedWithUser.questions.filter((q) => !q.deletedAt);
    expect(activeQuestions).toHaveLength(1);
    expect(activeQuestions[0].id).toBe('user-q-1');
  });

  it('preserves material questions with subQuestions and sub-images across mergeSnapshots', () => {
    const local = createSeedSnapshot();
    const incoming = structuredClone(local);

    incoming.questions.push({
      ...local.questions[0],
      id: 'mat-q-1',
      entryKind: 'material',
      title: '2025年工业经济资料分析（一拖二）',
      stemText: '共用文字材料与图表数据',
      images: [
        {
          id: 'mat-img-1',
          dataUrl: 'data:image/png;base64,bWF0ZXJpYWw=',
          width: 800,
          height: 400,
        },
      ],
      subQuestions: [
        {
          id: 'sub-1',
          label: '第1题',
          stemText: '第一小题题干\nA. 10\nB. 20',
          images: [
            {
              id: 'sub-img-1',
              dataUrl: 'data:image/png;base64,c3ViMQ==',
              width: 300,
              height: 200,
            },
          ],
          correctAnswer: 'A',
          analysisMarkdown: '第一小题解析',
          personalNote: '第一小题笔记',
        },
        {
          id: 'sub-2',
          label: '第2题',
          stemText: '第二小题题干\nA. 上升\nB. 下降',
          images: [],
          correctAnswer: 'B',
          analysisMarkdown: '第二小题解析',
        },
      ],
      isSeedDemo: false,
      createdAt: Date.now() + 1000,
      updatedAt: Date.now() + 1000,
    });

    const merged = mergeSnapshots(local, incoming);
    const mat = merged.questions.find((q) => q.id === 'mat-q-1');
    expect(mat?.entryKind).toBe('material');
    expect(mat?.images).toHaveLength(1);
    expect(mat?.subQuestions).toHaveLength(2);
    expect(mat?.subQuestions?.[0].images[0].dataUrl).toBe('data:image/png;base64,c3ViMQ==');
    expect(mat?.subQuestions?.[0].personalNote).toBe('第一小题笔记');
    expect(mat?.subQuestions?.[1].correctAnswer).toBe('B');
  });
});
