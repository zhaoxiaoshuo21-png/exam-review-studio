import React, { useMemo, useState } from 'react';
import { Image as ImageIcon, Pencil, Star, Tag, Trash2 } from 'lucide-react';
import type { QuestionListProps } from '../types/contracts';
import type { FolderNode, MasteryLevel, QuestionType } from '../types/schema';

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

const MASTERY_META: Record<
  MasteryLevel,
  { label: string; dotClass: string; textClass: string }
> = {
  unfamiliar: {
    label: '生疏',
    dotClass: 'bg-[#C93B3B] dark:bg-[#F06A6A]',
    textClass: 'text-[#586070] dark:text-[#9AA3B2]',
  },
  vague: {
    label: '模糊',
    dotClass: 'bg-amber-500 dark:bg-amber-400',
    textClass: 'text-[#586070] dark:text-[#9AA3B2]',
  },
  mastered: {
    label: '已掌握',
    dotClass: 'bg-emerald-600 dark:bg-emerald-400',
    textClass: 'text-[#586070] dark:text-[#9AA3B2]',
  },
};

function buildFolderPathMap(folders: FolderNode[]): Map<string, string> {
  const activeMap = new Map<string, FolderNode>();
  for (const folder of folders) {
    if (!folder.deletedAt) {
      activeMap.set(folder.id, folder);
    }
  }

  const pathMap = new Map<string, string>();
  for (const folder of activeMap.values()) {
    const segments: string[] = [];
    const visited = new Set<string>();
    let curr: FolderNode | undefined = folder;
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      segments.unshift(curr.name);
      curr = curr.parentId ? activeMap.get(curr.parentId) : undefined;
    }
    pathMap.set(folder.id, segments.join(' / '));
  }
  return pathMap;
}

/**
 * 极简克制题库总览卡片视图：
 * 适配温润纸白与石墨黑主题层次，展示题目标题、所属目录、类型、标签、熟练度圆点与附图标识。
 */
export const QuestionList: React.FC<QuestionListProps> = ({
  questions,
  folders,
  currentQuestionId,
  onSelectQuestion,
  onEditQuestion,
  onDeleteQuestion,
  onToggleStar,
}) => {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const folderPathMap = useMemo(() => buildFolderPathMap(folders), [folders]);
  const now = Date.now();

  if (questions.length === 0) {
    return (
      <div className="flex min-h-[360px] items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-dashed border-slate-900/[0.12] dark:border-white/[0.1] bg-white dark:bg-[#14161B] p-8 text-center">
          <p className="text-base font-medium text-[#181B22] dark:text-[#E6E8EE]">
            当前筛选范围内没有符合条件的题目
          </p>
          <p className="mt-1.5 text-sm text-[#586070] dark:text-[#9AA3B2]">
            尝试切换左侧题型目录、清除搜索词或调整顶部筛选标签。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3.5 md:grid-cols-2">
        {questions.map((q) => {
          const isCurrent = q.id === currentQuestionId;
          const isDue = q.nextReviewAt <= now;
          const typeMeta = QUESTION_TYPE_META[q.questionType];
          const masteryMeta = MASTERY_META[q.mastery];
          const folderPath = folderPathMap.get(q.folderId) ?? '未分类';
          const isConfirmingDelete = confirmDeleteId === q.id;
          const displayTitle =
            q.title.trim() ||
            q.stemText.trim().split(/\r?\n/)[0]?.slice(0, 48) ||
            '未命名题目';

          return (
            <article
              key={q.id}
              onClick={() => onSelectQuestion(q.id)}
              className={`group relative flex cursor-pointer flex-col justify-between rounded-xl border p-4 transition-all ${
                isCurrent
                  ? 'border-slate-900/25 bg-white dark:border-white/25 dark:bg-[#181A20]'
                  : 'border-slate-900/[0.08] bg-white hover:border-slate-900/20 dark:border-white/[0.065] dark:bg-[#14161B] dark:hover:border-white/[0.16]'
              }`}
            >
              <div>
                {/* 元信息与快捷操作 */}
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`font-medium ${typeMeta.textClass}`}>
                      {typeMeta.label}
                    </span>
                    <span className="text-slate-300 dark:text-white/15">·</span>
                    <span
                      className={`inline-flex items-center gap-1.5 ${masteryMeta.textClass}`}
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${masteryMeta.dotClass}`}
                      />
                      {masteryMeta.label}
                    </span>
                    {isDue && (
                      <span className="rounded bg-[#C93B3B]/10 px-1.5 py-0.5 text-[11px] font-medium text-[#C93B3B] dark:bg-[#F06A6A]/15 dark:text-[#F06A6A]">
                        待复习
                      </span>
                    )}
                    {isCurrent && (
                      <span className="rounded bg-slate-900/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-white/[0.1] dark:text-[#E6E8EE]">
                        当前复盘
                      </span>
                    )}
                  </div>

                  {/* 星标 / 编辑 / 删除 */}
                  <div
                    className="flex shrink-0 items-center gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleStar(q.id)}
                      title={q.starred ? '取消收藏' : '加入收藏'}
                      aria-label={q.starred ? '取消收藏' : '加入收藏'}
                      className={`rounded-md p-1.5 transition-colors ${
                        q.starred
                          ? 'text-amber-500 dark:text-amber-400'
                          : 'text-[#7C8594] dark:text-[#6F7787] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-amber-500'
                      }`}
                    >
                      <Star className={`h-3.5 w-3.5 ${q.starred ? 'fill-current' : ''}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEditQuestion(q)}
                      title="编辑题目"
                      aria-label="编辑题目"
                      className="rounded-md p-1.5 text-[#7C8594] dark:text-[#6F7787] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-slate-900 dark:hover:text-[#E6E8EE] transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>

                    {isConfirmingDelete ? (
                      <div className="flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/[0.08] px-1.5 py-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDeleteId(null);
                            onDeleteQuestion(q.id);
                          }}
                          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[#C93B3B] dark:text-[#F06A6A]"
                        >
                          确认删除
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded px-1 py-0.5 text-[11px] text-[#586070] dark:text-[#9AA3B2]"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(q.id)}
                        title="删除题目"
                        aria-label="删除题目"
                        className="rounded-md p-1.5 text-[#7C8594] dark:text-[#6F7787] hover:bg-red-500/10 hover:text-[#C93B3B] dark:hover:text-[#F06A6A] transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* 标题与题干摘要 */}
                <h3 className="text-[15px] font-semibold text-[#181B22] dark:text-[#F5F7FB] line-clamp-1 group-hover:text-[#C93B3B] dark:group-hover:text-[#F06A6A] transition-colors">
                  {displayTitle}
                </h3>
                <p className="mt-1.5 text-xs sm:text-[13px] leading-relaxed text-[#586070] dark:text-[#9AA3B2] line-clamp-2 whitespace-pre-line">
                  {q.stemText || '（暂无文字题干）'}
                </p>
              </div>

              {/* 底部信息：目录、附图、答案对比、标签 */}
              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-900/[0.05] dark:border-white/[0.05] pt-2.5 text-[11px] text-[#7C8594] dark:text-[#6F7787]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-black/[0.035] dark:bg-white/[0.05] px-2 py-0.5 text-[#586070] dark:text-[#9AA3B2]">
                    {folderPath}
                  </span>
                  {q.images.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-black/[0.035] dark:bg-white/[0.05] px-1.5 py-0.5 text-[#586070] dark:text-[#9AA3B2]">
                      <ImageIcon className="h-3 w-3" />
                      {q.images.length} 图
                    </span>
                  )}
                  {(q.myWrongChoice || q.correctAnswer) && (
                    <span className="tabular-nums">
                      {q.myWrongChoice ? `错 ${q.myWrongChoice}` : ''}
                      {q.myWrongChoice && q.correctAnswer ? ' · ' : ''}
                      {q.correctAnswer ? `正 ${q.correctAnswer}` : ''}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {q.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-0.5 text-[#7C8594] dark:text-[#6F7787]"
                    >
                      <Tag className="h-2.5 w-2.5" />
                      {tag}
                    </span>
                  ))}
                  {q.tags.length > 3 && <span>+{q.tags.length - 3}</span>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default QuestionList;
