import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Layers,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { FolderTreeProps } from '../types/contracts';
import type { FolderNode } from '../types/schema';
import { getDescendantFolderIds } from '../core';

type EditorState =
  | { mode: 'create'; parentId: string | null; parentName: string | null }
  | { mode: 'edit'; folder: FolderNode }
  | null;

/**
 * 极简无缝题型目录树：
 * 桌面端仅以右侧 1px 细分割线与主画布衔接，移动端以抽屉滑出；
 * 行末使用极简细灰数字与 5px 柔和珊瑚红点提示待复习题目，行内操作默认隐藏、悬浮显现。
 */
export const FolderTree: React.FC<FolderTreeProps> = ({
  folders,
  questions,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  isMobileOpen,
  onCloseMobile,
}) => {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [editor, setEditor] = useState<EditorState>(null);
  const [nameInput, setNameInput] = useState('');
  const [chainTipInput, setChainTipInput] = useState('');
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FolderNode | null>(null);

  const activeFolders = useMemo(
    () =>
      folders
        .filter((f) => !f.deletedAt)
        .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
    [folders],
  );

  const activeQuestions = useMemo(
    () => questions.filter((q) => !q.deletedAt),
    [questions],
  );

  const activeFolderIds = useMemo(
    () => new Set(activeFolders.map((f) => f.id)),
    [activeFolders],
  );

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, FolderNode[]>();
    for (const folder of activeFolders) {
      const parentKey =
        folder.parentId && activeFolderIds.has(folder.parentId) ? folder.parentId : null;
      const list = map.get(parentKey);
      if (list) {
        list.push(folder);
      } else {
        map.set(parentKey, [folder]);
      }
    }
    return map;
  }, [activeFolders, activeFolderIds]);

  const folderCounts = useMemo(() => {
    const now = Date.now();
    const result = new Map<string, { total: number; due: number }>();
    const directMap = new Map<string, { total: number; due: number }>();
    let allDue = 0;

    for (const q of activeQuestions) {
      const isDue = q.nextReviewAt <= now;
      if (isDue) allDue += 1;
      const current = directMap.get(q.folderId);
      if (current) {
        current.total += 1;
        if (isDue) current.due += 1;
      } else {
        directMap.set(q.folderId, { total: 1, due: isDue ? 1 : 0 });
      }
    }

    for (const folder of activeFolders) {
      const descendantIds = getDescendantFolderIds(activeFolders, folder.id);
      let total = 0;
      let due = 0;
      for (const id of descendantIds) {
        const direct = directMap.get(id);
        if (direct) {
          total += direct.total;
          due += direct.due;
        }
      }
      result.set(folder.id, { total, due });
    }

    return {
      byFolder: result,
      allTotal: activeQuestions.length,
      allDue,
    };
  }, [activeFolders, activeQuestions]);

  const toggleCollapse = (folderId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const openCreateEditor = (parentId: string | null, parentName: string | null) => {
    setDeleteTarget(null);
    setNameInput('');
    setChainTipInput('');
    setFormError('');
    setEditor({ mode: 'create', parentId, parentName });
    if (parentId) {
      setCollapsedIds((prev) => {
        if (!prev.has(parentId)) return prev;
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    }
  };

  const openEditEditor = (folder: FolderNode) => {
    setDeleteTarget(null);
    setNameInput(folder.name);
    setChainTipInput(folder.chainTip ?? '');
    setFormError('');
    setEditor({ mode: 'edit', folder });
  };

  const handleSubmitEditor = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      setFormError('请输入目录名称');
      return;
    }
    const trimmedTip = chainTipInput.trim();

    if (editor?.mode === 'create') {
      onCreateFolder(editor.parentId, trimmedName, trimmedTip || undefined);
    } else if (editor?.mode === 'edit') {
      onUpdateFolder(editor.folder.id, {
        name: trimmedName,
        chainTip: trimmedTip,
      });
    }
    setEditor(null);
    setFormError('');
  };

  const handleSelect = (folderId: string | null) => {
    onSelectFolder(folderId);
    onCloseMobile();
  };

  const renderFolderNodes = (
    parentId: string | null,
    depth: number,
    visited: Set<string>,
  ): React.ReactNode => {
    const items = childrenByParent.get(parentId) ?? [];
    if (items.length === 0) return null;

    return items.map((folder) => {
      if (visited.has(folder.id)) return null;
      const nextVisited = new Set(visited);
      nextVisited.add(folder.id);

      const children = childrenByParent.get(folder.id) ?? [];
      const hasChildren = children.length > 0;
      const isExpanded = hasChildren && !collapsedIds.has(folder.id);
      const isSelected = selectedFolderId === folder.id;
      const counts = folderCounts.byFolder.get(folder.id) ?? { total: 0, due: 0 };

      return (
        <div key={folder.id}>
          <div
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            className={`group flex items-center justify-between gap-1 rounded-lg pr-2 py-1.5 text-[13px] transition-colors ${
              isSelected
                ? 'bg-slate-900/[0.06] text-slate-900 dark:bg-white/[0.07] dark:text-[#F5F7FB] font-medium'
                : 'text-[#586070] dark:text-[#9AA3B2] hover:bg-slate-900/[0.035] dark:hover:bg-white/[0.04] hover:text-slate-900 dark:hover:text-[#E6E8EE]'
            }`}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasChildren) toggleCollapse(folder.id);
                }}
                aria-label={isExpanded ? '折叠子目录' : '展开子目录'}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors ${
                  hasChildren
                    ? 'text-slate-400 dark:text-[#6F7787] hover:text-slate-700 dark:hover:text-[#E6E8EE]'
                    : 'pointer-events-none opacity-0'
                }`}
              >
                {hasChildren &&
                  (isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  ))}
              </button>

              <button
                type="button"
                onClick={() => handleSelect(folder.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left py-0.5"
              >
                {isSelected || isExpanded ? (
                  <FolderOpen
                    className={`h-3.5 w-3.5 shrink-0 ${
                      isSelected
                        ? 'text-[#C93B3B] dark:text-[#F06A6A]'
                        : 'text-slate-400 dark:text-[#6F7787]'
                    }`}
                  />
                ) : (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-[#6F7787]" />
                )}
                <span className="truncate">{folder.name}</span>
              </button>
            </div>

            {/* 悬浮显现操作 + 柔和数字与 5px 待复习微圆点 */}
            <div className="flex shrink-0 items-center gap-1">
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openCreateEditor(folder.id, folder.name);
                  }}
                  title="新建子目录"
                  aria-label={`在 ${folder.name} 下新建子目录`}
                  className="rounded p-1 text-slate-400 hover:bg-slate-900/[0.06] dark:hover:bg-white/[0.08] hover:text-slate-700 dark:hover:text-white"
                >
                  <FolderPlus className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditEditor(folder);
                  }}
                  title="重命名 / 编辑思维链口诀"
                  aria-label={`编辑 ${folder.name}`}
                  className="rounded p-1 text-slate-400 hover:bg-slate-900/[0.06] dark:hover:bg-white/[0.08] hover:text-slate-700 dark:hover:text-white"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditor(null);
                    setDeleteTarget(folder);
                  }}
                  title="删除目录"
                  aria-label={`删除 ${folder.name}`}
                  className="rounded p-1 text-slate-400 hover:bg-red-500/10 hover:text-red-500"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              <div className="flex items-center gap-1.5 pl-1">
                {counts.due > 0 && (
                  <span
                    title={`${counts.due} 题今日待复习`}
                    aria-label={`${counts.due} 题今日待复习`}
                    className="inline-block h-[5px] w-[5px] shrink-0 rounded-full bg-[#C93B3B]/80 dark:bg-[#F06A6A]/85"
                  />
                )}
                <span className="min-w-[1.1rem] text-right text-[11px] tabular-nums text-[#7C8594] dark:text-[#6F7787]">
                  {counts.total}
                </span>
              </div>
            </div>
          </div>

          {isExpanded && renderFolderNodes(folder.id, depth + 1, nextVisited)}
        </div>
      );
    });
  };

  const selectedFolder = activeFolders.find((f) => f.id === selectedFolderId);

  const treeContent = (
    <div className="flex h-full flex-col text-[#181B22] dark:text-[#E6E8EE]">
      {/* 头部标题与新建目录按钮 */}
      <div className="flex items-center justify-between border-b border-slate-900/[0.06] dark:border-white/[0.05] px-4 py-3">
        <span className="text-[11px] font-semibold tracking-widest text-[#7C8594] dark:text-[#6F7787] uppercase">
          题型目录
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => openCreateEditor(null, null)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#586070] dark:text-[#9AA3B2] hover:bg-slate-900/[0.05] dark:hover:bg-white/[0.06] hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            新建
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="关闭目录抽屉"
            className="lg:hidden rounded-md p-1 text-slate-400 hover:bg-slate-900/[0.05] dark:hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 新建 / 编辑目录表单 */}
      {editor && (
        <form
          onSubmit={handleSubmitEditor}
          className="m-3 rounded-xl border border-slate-900/[0.1] dark:border-white/[0.08] bg-white dark:bg-[#14161B] p-3 shadow-sm"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-800 dark:text-[#F5F7FB]">
              {editor.mode === 'create'
                ? editor.parentName
                  ? `新建子目录（${editor.parentName}）`
                  : '新建顶级目录'
                : `编辑「${editor.folder.name}」`}
            </span>
            <button
              type="button"
              onClick={() => setEditor(null)}
              aria-label="关闭表单"
              className="rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => {
              setNameInput(e.target.value);
              if (formError) setFormError('');
            }}
            placeholder="目录名称（如：图形推理）"
            autoFocus
            className="w-full rounded-lg border border-slate-900/[0.1] dark:border-white/[0.08] bg-[#F7F6F2] dark:bg-[#0D0E11] px-2.5 py-1.5 text-xs text-slate-900 dark:text-[#E6E8EE] focus:border-slate-500 dark:focus:border-white/30 focus:outline-none"
          />
          <textarea
            value={chainTipInput}
            onChange={(e) => setChainTipInput(e.target.value)}
            rows={3}
            placeholder="通用思维链口诀（可选）"
            className="mt-2 w-full resize-none rounded-lg border border-slate-900/[0.1] dark:border-white/[0.08] bg-[#F7F6F2] dark:bg-[#0D0E11] px-2.5 py-1.5 text-xs leading-relaxed text-slate-900 dark:text-[#E6E8EE] focus:border-slate-500 dark:focus:border-white/30 focus:outline-none"
          />
          {formError && <p className="mt-1 text-[11px] text-[#C93B3B] dark:text-[#F06A6A]">{formError}</p>}
          <div className="mt-2.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setEditor(null)}
              className="rounded-md px-2.5 py-1 text-xs text-[#586070] dark:text-[#9AA3B2] hover:bg-slate-900/[0.05] dark:hover:bg-white/[0.06]"
            >
              取消
            </button>
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 dark:bg-[#F5F7FB] dark:text-[#0D0E11] dark:hover:bg-white"
            >
              {editor.mode === 'create' ? '创建' : '保存'}
            </button>
          </div>
        </form>
      )}

      {/* 删除二次确认框 */}
      {deleteTarget && (
        <div className="m-3 rounded-xl border border-red-500/25 bg-red-500/[0.06] p-3">
          <p className="text-xs font-semibold text-[#C93B3B] dark:text-[#F06A6A]">
            确认删除「{deleteTarget.name}」？
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[#586070] dark:text-[#9AA3B2]">
            该目录及其子目录将被移除，关联的{' '}
            {folderCounts.byFolder.get(deleteTarget.id)?.total ?? 0} 道题目将安全归并到上层或默认目录。
          </p>
          <div className="mt-2.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="rounded-md px-2.5 py-1 text-xs text-[#586070] dark:text-[#9AA3B2] hover:bg-black/5 dark:hover:bg-white/10"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                onDeleteFolder(deleteTarget.id);
                setDeleteTarget(null);
              }}
              className="rounded-md bg-[#C93B3B] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#b53232]"
            >
              确认删除
            </button>
          </div>
        </div>
      )}

      {/* 目录列表滚动区 */}
      <div className="flex-1 overflow-y-auto px-2.5 py-2.5 space-y-0.5">
        <button
          type="button"
          onClick={() => handleSelect(null)}
          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
            selectedFolderId === null
              ? 'bg-slate-900/[0.06] text-slate-900 dark:bg-white/[0.07] dark:text-[#F5F7FB] font-medium'
              : 'text-[#586070] dark:text-[#9AA3B2] hover:bg-slate-900/[0.035] dark:hover:bg-white/[0.04] hover:text-slate-900 dark:hover:text-[#E6E8EE]'
          }`}
        >
          <span className="flex items-center gap-2">
            <Layers
              className={`h-3.5 w-3.5 ${
                selectedFolderId === null
                  ? 'text-[#C93B3B] dark:text-[#F06A6A]'
                  : 'text-slate-400 dark:text-[#6F7787]'
              }`}
            />
            全部题目
          </span>
          <span className="flex items-center gap-1.5">
            {folderCounts.allDue > 0 && (
              <span
                title={`${folderCounts.allDue} 题今日待复习`}
                aria-label={`${folderCounts.allDue} 题今日待复习`}
                className="inline-block h-[5px] w-[5px] rounded-full bg-[#C93B3B]/80 dark:bg-[#F06A6A]/85"
              />
            )}
            <span className="text-[11px] tabular-nums text-[#7C8594] dark:text-[#6F7787]">
              {folderCounts.allTotal}
            </span>
          </span>
        </button>

        <div className="pt-1 space-y-0.5">{renderFolderNodes(null, 0, new Set())}</div>
      </div>

      {/* 选中目录的思维链口诀快速查看/编辑 */}
      {selectedFolder && (
        <div className="border-t border-slate-900/[0.06] dark:border-white/[0.05] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-[#7C8594] dark:text-[#6F7787] truncate">
              {selectedFolder.name} · 思维链口诀
            </span>
            <button
              type="button"
              onClick={() => openEditEditor(selectedFolder)}
              className="shrink-0 text-[11px] text-[#586070] dark:text-[#9AA3B2] hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              {selectedFolder.chainTip ? '编辑' : '+ 添加'}
            </button>
          </div>
          {selectedFolder.chainTip ? (
            <p className="mt-1 text-xs leading-relaxed text-[#586070] dark:text-[#9AA3B2] line-clamp-3">
              {selectedFolder.chainTip}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-[#7C8594] dark:text-[#6F7787]">
              未设置口诀
            </p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* 桌面端纯净无外框侧栏（仅右侧极细分割线） */}
      <aside className="hidden lg:sticky lg:top-[5.25rem] lg:flex lg:h-[calc(100vh-5.25rem)] lg:w-64 xl:w-[17rem] lg:shrink-0 lg:flex-col border-r border-slate-200/70 dark:border-white/[0.06] bg-transparent">
        {treeContent}
      </aside>

      {/* 移动端带遮罩左侧抽屉 */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="题型目录抽屉"
        >
          <div
            onClick={onCloseMobile}
            aria-hidden="true"
            className="fixed inset-0 bg-black/55 backdrop-blur-[2px]"
          />
          <aside className="relative z-50 flex h-full w-[82vw] max-w-[300px] flex-col border-r border-slate-900/[0.08] dark:border-white/[0.06] bg-[#F7F6F2] dark:bg-[#14161B] shadow-2xl">
            {treeContent}
          </aside>
        </div>
      )}
    </>
  );
};

export default FolderTree;
