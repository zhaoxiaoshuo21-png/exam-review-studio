import { describe, expect, it } from 'vitest';
import {
  computeNextReviewAt,
  createSeedSnapshot,
  getDescendantFolderIds,
} from '../index';
import type { FolderNode } from '../../types/schema';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('seedData', () => {
  it('computes spaced repetition intervals for unfamiliar, vague, and mastered', () => {
    const now = 1_700_000_000_000;
    expect(computeNextReviewAt('unfamiliar', 0, now)).toBe(now + 1 * DAY_MS);
    expect(computeNextReviewAt('vague', 2, now)).toBe(now + 3 * DAY_MS);
    expect(computeNextReviewAt('mastered', 0, now)).toBe(now + 7 * DAY_MS);
    expect(computeNextReviewAt('mastered', 1, now)).toBe(now + 15 * DAY_MS);
    expect(computeNextReviewAt('mastered', 2, now)).toBe(now + 30 * DAY_MS);
    expect(computeNextReviewAt('mastered', 10, now)).toBe(now + 30 * DAY_MS);
  });

  it('collects self and active descendants while ignoring soft-deleted subtrees and cycles', () => {
    const folders: FolderNode[] = [
      { id: 'root', name: '判断推理', parentId: null, order: 1, createdAt: 1, updatedAt: 1 },
      { id: 'c1', name: '图形推理', parentId: 'root', order: 1, createdAt: 1, updatedAt: 1 },
      { id: 'c2', name: '类比推理', parentId: 'root', order: 2, createdAt: 1, updatedAt: 1, deletedAt: 5 },
      { id: 'gc1', name: '对称性', parentId: 'c1', order: 1, createdAt: 1, updatedAt: 1 },
      { id: 'gc2', name: '已删除孙节点', parentId: 'c2', order: 1, createdAt: 1, updatedAt: 1 },
    ];

    expect(getDescendantFolderIds(folders, 'root')).toEqual(['root', 'c1', 'gc1']);
    expect(getDescendantFolderIds(folders, 'c2')).toEqual([]);
    expect(getDescendantFolderIds(folders, 'missing')).toEqual([]);

    const cyclic: FolderNode[] = [
      { id: 'a', name: 'A', parentId: 'b', order: 1, createdAt: 1, updatedAt: 1 },
      { id: 'b', name: 'B', parentId: 'a', order: 2, createdAt: 1, updatedAt: 1 },
    ];
    expect(getDescendantFolderIds(cyclic, 'a')).toEqual(['a', 'b']);
  });

  it('creates seed snapshot with civil-service folder tree and 2 demo questions', () => {
    const seed = createSeedSnapshot();
    expect(seed.theme).toBe('dark');
    expect(seed.reviewMode).toBe('self_test');

    const folderNames = seed.folders.map((f) => f.name);
    expect(folderNames).toEqual(
      expect.arrayContaining([
        '政治理论',
        '判断推理',
        '图形推理',
        '类比推理',
        '逻辑判断',
        '言语理解',
        '资料分析',
        '数量关系',
        '常识判断',
      ]),
    );

    const logicFolder = seed.folders.find((f) => f.name === '判断推理');
    const graphicFolder = seed.folders.find((f) => f.name === '图形推理');
    expect(graphicFolder?.parentId).toBe(logicFolder?.id);

    expect(seed.questions).toHaveLength(2);
    expect(seed.questions.every((q) => q.isSeedDemo === true)).toBe(true);

    const [q1, q2] = seed.questions;
    expect(q1.title).toBe('党的二十大报告：建设现代化产业体系');
    expect(q1.stemText).toContain('高质量发展是全面建设社会主义现代化国家的首要任务');
    expect(q1.stemText).toContain('①支持专精特新企业发展');
    expect(q1.stemText).toContain('⑤构建优质高效的服务业新体系');
    expect(q1.stemText).toContain('A. ①④⑤');
    expect(q1.myWrongChoice).toBe('B');
    expect(q1.correctAnswer).toBe('A');
    expect(q1.analysisMarkdown).toContain('一、【底层核心概念（说人话）】');
    expect(q1.analysisMarkdown).toContain('二、【考场第一反应（应该怎么想）】');
    expect(q1.analysisMarkdown).toContain('三、【实战解题与选项拆解】');

    expect(q2.images).toHaveLength(1);
    expect(q2.images[0].width).toBe(880);
    expect(q2.images[0].height).toBe(440);
    expect(q2.images[0].dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const base64Payload = q2.images[0].dataUrl.split(',')[1];
    const binary = atob(base64Payload);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const decodedSvg = new TextDecoder().decode(bytes);
    expect(decodedSvg).toContain('<svg');
    expect(decodedSvg).toContain('viewBox="0 0 880 440"');
    expect(decodedSvg).toContain('图 1');
    expect(decodedSvg).toContain('stroke="#E57373"');
  });
});
