import React, { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import type { MarkdownViewProps } from '../types/contracts';
import { renderAnalysisHtml } from '../core';

/**
 * 复盘解析 Markdown 渲染器：
 * 通过 .analysis-prose 统一承接全局 Aa 字体与字号，呈现干净极简的图 2 高对比度精排，
 * 并支持 editable 行内切换源码编辑。
 */
export const MarkdownView: React.FC<MarkdownViewProps> = ({
  markdown,
  editable = false,
  onSaveMarkdown,
  placeholder = '暂无复盘解析内容',
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(markdown);

  useEffect(() => {
    if (!isEditing) {
      setDraft(markdown);
    }
  }, [markdown, isEditing]);

  const renderedHtml = useMemo(() => renderAnalysisHtml(markdown || ''), [markdown]);

  const handleStartEdit = () => {
    setDraft(markdown);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setDraft(markdown);
    setIsEditing(false);
  };

  const handleSave = () => {
    onSaveMarkdown?.(draft);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className="rounded-xl border border-slate-900/[0.1] dark:border-white/[0.08] bg-white dark:bg-[#14161B] p-3">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-900/[0.06] dark:border-white/[0.06] pb-2">
          <span className="text-[11px] text-[#7C8594] dark:text-[#6F7787]">
            支持 `**暖红重点**`、`==柔底高亮==`、`一、【板块】`、列表与引用（Ctrl+Enter 保存）
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-[#586070] dark:text-[#9AA3B2] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 dark:bg-[#F5F7FB] dark:text-[#0D0E11] dark:hover:bg-white transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
              保存
            </button>
          </div>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={13}
          autoFocus
          placeholder="输入复盘解析 Markdown..."
          className="w-full min-h-[240px] resize-y rounded-lg border border-slate-900/[0.08] dark:border-white/[0.065] bg-[#F7F6F2] dark:bg-[#0D0E11] p-3 text-sm leading-relaxed text-[#181B22] dark:text-[#E6E8EE] placeholder:text-[#7C8594] dark:placeholder:text-[#6F7787] focus:border-slate-500 dark:focus:border-white/30 focus:outline-none"
        />
      </div>
    );
  }

  return (
    <div className="relative">
      {editable && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={handleStartEdit}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#7C8594] dark:text-[#6F7787] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-slate-900 dark:hover:text-[#E6E8EE] transition-colors"
          >
            <Pencil className="h-3 w-3" />
            编辑原文
          </button>
        </div>
      )}

      {!markdown || !markdown.trim() ? (
        <div className="rounded-xl border border-dashed border-slate-900/[0.1] dark:border-white/[0.08] px-4 py-8 text-center text-sm text-[#7C8594] dark:text-[#6F7787]">
          {placeholder}
        </div>
      ) : (
        <div
          className="analysis-prose break-words"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      )}
    </div>
  );
};

export default MarkdownView;
