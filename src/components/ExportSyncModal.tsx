import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Download,
  FileJson,
  HardDriveDownload,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { exportProgressPatch, exportSelfContainedHtml } from '../core';
import type { AppStateSnapshot, ProgressOnlyPatch } from '../types/schema';

export interface ExportSyncModalProps {
  isOpen: boolean;
  snapshot: AppStateSnapshot;
  onClose: () => void;
  onReplaceSnapshot: (next: AppStateSnapshot, message: string) => void;
  onMergeSnapshot: (incoming: AppStateSnapshot) => void;
  onApplyProgressPatch: (patch: ProgressOnlyPatch) => void;
  onClearDemoQuestions: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getDateStamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function getTimeStamp(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}${mm}`;
}

function triggerJsonDownload(filename: string, payload: unknown): number {
  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return blob.size;
}

export const ExportSyncModal: React.FC<ExportSyncModalProps> = ({
  isOpen,
  snapshot,
  onClose,
  onReplaceSnapshot,
  onMergeSnapshot,
  onApplyProgressPatch,
  onClearDemoQuestions,
}) => {
  const [htmlFeedback, setHtmlFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [jsonImportMode, setJsonImportMode] = useState<'merge' | 'replace'>('merge');
  const [confirmClearDemo, setConfirmClearDemo] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const patchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setHtmlFeedback(null);
    setStatusMessage(null);
    setErrorMsg(null);
    setConfirmClearDemo(false);
  }, [isOpen]);

  const stats = useMemo(() => {
    const activeQuestions = snapshot.questions.filter((q) => !q.deletedAt);
    const activeFolders = snapshot.folders.filter((f) => !f.deletedAt);
    const imageCount = activeQuestions.reduce((acc, q) => acc + q.images.length, 0);
    const demoCount = activeQuestions.filter((q) => q.isSeedDemo).length;
    return {
      questionCount: activeQuestions.length,
      folderCount: activeFolders.length,
      imageCount,
      demoCount,
    };
  }, [snapshot]);

  if (!isOpen) return null;

  const handleExportHtml = () => {
    setErrorMsg(null);
    setStatusMessage(null);
    const targetFilename = `备考复盘本-${stats.questionCount}题-${getDateStamp()}-${getTimeStamp()}.html`;
    const res = exportSelfContainedHtml(snapshot, targetFilename);
    if (res.ok) {
      const sizeText = res.sizeBytes ? `（${formatBytes(res.sizeBytes)}）` : '';
      setHtmlFeedback({
        ok: true,
        message: `已生成并下载「${targetFilename}」${sizeText}，内含 ${stats.questionCount} 道题与 ${stats.imageCount} 张图片。提醒：电脑录题存在浏览器缓存中，请上传刚刚下载的这个最新文件（不要错传旧文件）到百度网盘，出门用手机下载后使用手机浏览器打开即可刷题。`,
      });
    } else {
      setHtmlFeedback({
        ok: false,
        message:
          res.reason ||
          '当前处于开发模式 (vite dev)，请先执行 npm run build 后用浏览器打开 dist/备考复盘本.html 使用自举导出。',
      });
    }
  };

  const handleExportFullJson = () => {
    setErrorMsg(null);
    const exportPayload: AppStateSnapshot = {
      ...snapshot,
      exportedAt: Date.now(),
    };
    const size = triggerJsonDownload(
      `备考复盘本-全量备份-${getDateStamp()}.json`,
      exportPayload,
    );
    setStatusMessage(`已导出全量 JSON 备份（${formatBytes(size)}）`);
  };

  const handleImportFullJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMsg(null);
    setStatusMessage(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<AppStateSnapshot>;
      if (!Array.isArray(parsed.folders) || !Array.isArray(parsed.questions)) {
        throw new Error('JSON 文件格式不匹配：缺少 folders 或 questions 字段');
      }
      const normalized: AppStateSnapshot = {
        version: typeof parsed.version === 'number' ? parsed.version : 1,
        exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : Date.now(),
        theme: parsed.theme === 'light' ? 'light' : 'dark',
        reviewMode: parsed.reviewMode === 'direct' ? 'direct' : 'self_test',
        folders: parsed.folders,
        questions: parsed.questions,
      };
      if (jsonImportMode === 'merge') {
        onMergeSnapshot(normalized);
        setStatusMessage(`已无损合并「${file.name}」中的目录与题库记录`);
      } else {
        onReplaceSnapshot(normalized, `已覆盖恢复全量备份「${file.name}」`);
        setStatusMessage(`已完全覆盖恢复为「${file.name}」`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '导入 JSON 失败，请确认文件完整');
    }
  };

  const handleExportProgressPatch = () => {
    setErrorMsg(null);
    const patch = exportProgressPatch(snapshot);
    const size = triggerJsonDownload(
      `备考复盘本-进度同步-${getDateStamp()}.json`,
      patch,
    );
    setStatusMessage(`已导出轻量进度同步包（共 ${patch.items.length} 题，${formatBytes(size)}）`);
  };

  const handleImportProgressPatch = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMsg(null);
    setStatusMessage(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<ProgressOnlyPatch>;
      if (parsed.kind !== 'exam-review-progress-patch' || !Array.isArray(parsed.items)) {
        throw new Error('这不是有效的轻量进度同步包（kind 不匹配）');
      }
      onApplyProgressPatch(parsed as ProgressOnlyPatch);
      setStatusMessage(`已读取进度同步包「${file.name}」并合并熟练度与笔记`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '导入进度同步包失败');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-2 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="导出与百度网盘同步"
    >
      <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-900/[0.08] bg-white shadow-2xl dark:border-white/[0.07] dark:bg-[#14161B]">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-slate-900/[0.08] px-4 py-3.5 dark:border-white/[0.07] sm:px-6">
          <div className="flex items-center gap-2.5">
            <CloudUpload className="h-5 w-5 text-[#5B6270] dark:text-[#949BA8]" />
            <div>
              <h2 className="text-base font-semibold text-[#181B22] dark:text-[#F5F6FA] sm:text-lg">
                导出与百度网盘离线同步
              </h2>
              <p className="text-xs text-[#5B6270] dark:text-[#949BA8]">
                当前题库：{stats.folderCount} 个目录 · {stats.questionCount} 道题 · {stats.imageCount} 张压缩附图
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

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          {errorMsg && (
            <div className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {statusMessage && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {/* ① 主操作卡片：随身复盘单文件 HTML */}
          <section className="rounded-2xl border border-slate-900/[0.1] bg-[#F7F6F2] p-4 dark:border-white/[0.1] dark:bg-[#0D0E11]">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[11px] font-medium text-[#5B6270] dark:bg-white/[0.08] dark:text-[#949BA8]">
                  <Smartphone className="h-3.5 w-3.5" />
                  百度网盘离线随身流（核心推荐）
                </div>
                <h3 className="text-base font-semibold text-[#181B22] dark:text-[#F5F6FA]">
                  一键导出随身复盘单文件 HTML
                </h3>
                <p className="text-xs leading-relaxed text-[#5B6270] dark:text-[#949BA8]">
                  将全部目录、压缩图片、图2风格 AI 解析与个人复习进度打包进带题数与时间戳的单个{' '}
                  <code className="rounded bg-black/[0.06] px-1 dark:bg-white/10">.html</code>{' '}
                  文件。上传到百度网盘，出门手机下载后用手机浏览器（Safari / Chrome / 自带浏览器）打开即可直接刷题！
                </p>
                <p className="rounded-lg border border-slate-900/[0.08] bg-white/80 px-2.5 py-1.5 text-[11px] leading-relaxed text-[#5B6270] dark:border-white/[0.08] dark:bg-[#14161B] dark:text-[#949BA8]">
                  <strong className="font-semibold text-[#181B22] dark:text-[#E6E8EE]">
                    iPad / 手机在线托管 + 百度网盘同步说明：
                  </strong>
                  若通过在线网址（如 GitHub Pages）打开并添加到 iPad / 手机主屏幕离线使用，只需在多设备间互传下方的「全量 JSON 备份」或「轻量进度同步包」即可双向无损同步。
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportHtml}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#181B22] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2C313D] dark:bg-[#F5F6FA] dark:text-[#0D0E11] dark:hover:bg-white"
              >
                <HardDriveDownload className="h-4 w-4" />
                一键导出单文件 HTML
              </button>
            </div>

            {htmlFeedback && (
              <div
                className={`mt-3 rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed ${
                  htmlFeedback.ok
                    ? 'border-emerald-300 bg-emerald-50/90 text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border-amber-300 bg-amber-50/90 text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-200'
                }`}
              >
                <p>{htmlFeedback.message}</p>
                {!htmlFeedback.ok && (
                  <p className="mt-1 font-medium">
                    提示：请先在项目目录执行{' '}
                    <code className="rounded bg-black/10 px-1.5 py-0.5 dark:bg-white/10">
                      npm run build
                    </code>
                    ，然后用浏览器打开生成的{' '}
                    <code className="rounded bg-black/10 px-1.5 py-0.5 dark:bg-white/10">
                      dist/备考复盘本.html
                    </code>
                    （或{' '}
                    <code className="rounded bg-black/10 px-1.5 py-0.5 dark:bg-white/10">
                      dist/index.html
                    </code>
                    ）即可自举导出。
                  </p>
                )}
              </div>
            )}
          </section>

          {/* ② 全量 JSON 备份卡片 */}
          <section className="rounded-xl border border-slate-900/[0.08] bg-[#F7F6F2]/55 p-4 dark:border-white/[0.07] dark:bg-[#0D0E11]/70">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#181B22] dark:text-[#F5F6FA]">
                  <FileJson className="h-4 w-4 text-[#5B6270] dark:text-[#949BA8]" />
                  全量 JSON 备份（含全部图片与题目）
                </h3>
                <p className="mt-0.5 text-xs text-[#5B6270] dark:text-[#949BA8]">
                  适合在电脑长期归档或跨设备完整迁移题库。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportFullJson}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-900/[0.1] bg-white px-3 py-1.5 text-xs font-medium text-[#181B22] hover:bg-slate-50 dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#E6E8EE] dark:hover:bg-[#232730]"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出全量 JSON 备份
                </button>
                <button
                  type="button"
                  onClick={() => jsonInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-900/[0.1] bg-white px-3 py-1.5 text-xs font-medium text-[#181B22] hover:bg-slate-50 dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#E6E8EE] dark:hover:bg-[#232730]"
                >
                  <Upload className="h-3.5 w-3.5" />
                  导入 JSON
                </button>
                <input
                  ref={jsonInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportFullJson}
                  className="hidden"
                />
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-3 border-t border-slate-900/[0.07] pt-2.5 text-xs dark:border-white/[0.07]">
              <span className="text-[#88909E] dark:text-[#656C7A]">导入策略：</span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[#181B22] dark:text-[#E6E8EE]">
                <input
                  type="radio"
                  name="json-import-mode"
                  checked={jsonImportMode === 'merge'}
                  onChange={() => setJsonImportMode('merge')}
                  className="accent-[#181B22] dark:accent-[#F5F6FA]"
                />
                无损合并（按时间戳保留最新进度与新题）
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[#181B22] dark:text-[#E6E8EE]">
                <input
                  type="radio"
                  name="json-import-mode"
                  checked={jsonImportMode === 'replace'}
                  onChange={() => setJsonImportMode('replace')}
                  className="accent-[#181B22] dark:accent-[#F5F6FA]"
                />
                完全覆盖当前本地题库
              </label>
            </div>
          </section>

          {/* ③ 轻量进度同步包卡片 */}
          <section className="rounded-xl border border-slate-900/[0.08] bg-[#F7F6F2]/55 p-4 dark:border-white/[0.07] dark:bg-[#0D0E11]/70">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#181B22] dark:text-[#F5F6FA]">
                  <Sparkles className="h-4 w-4 text-[#5B6270] dark:text-[#949BA8]" />
                  轻量进度同步包（不含图，仅几 KB）
                </h3>
                <p className="mt-0.5 text-xs text-[#5B6270] dark:text-[#949BA8]">
                  在手机上刷完题后导出极小进度包回传电脑合并熟练度、复习次数与个人笔记。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportProgressPatch}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-900/[0.1] bg-white px-3 py-1.5 text-xs font-medium text-[#181B22] hover:bg-slate-50 dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#E6E8EE] dark:hover:bg-[#232730]"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出仅进度同步包
                </button>
                <button
                  type="button"
                  onClick={() => patchInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-900/[0.1] bg-white px-3 py-1.5 text-xs font-medium text-[#181B22] hover:bg-slate-50 dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#E6E8EE] dark:hover:bg-[#232730]"
                >
                  <Upload className="h-3.5 w-3.5" />
                  导入进度包合并
                </button>
                <input
                  ref={patchInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportProgressPatch}
                  className="hidden"
                />
              </div>
            </div>
          </section>

          {/* ④ 清空内置示例题 */}
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-900/[0.08] bg-[#F7F6F2]/55 px-4 py-3 dark:border-white/[0.07] dark:bg-[#0D0E11]/70">
            <div>
              <h3 className="text-xs font-semibold text-[#181B22] dark:text-[#E6E8EE]">
                内置示范题管理（当前剩余 {stats.demoCount} 道示例题）
              </h3>
              <p className="text-[11px] text-[#5B6270] dark:text-[#949BA8]">
                仅移除标记为示范示例的题目，不会影响你自行录入的题目和目录结构。
              </p>
            </div>
            {stats.demoCount === 0 ? (
              <span className="text-xs text-[#88909E] dark:text-[#656C7A]">已全部清空</span>
            ) : !confirmClearDemo ? (
              <button
                type="button"
                onClick={() => setConfirmClearDemo(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:bg-[#1B1E25] dark:text-red-400 dark:hover:bg-red-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                清空内置示例题
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmClearDemo(false)}
                  className="rounded-lg border border-slate-900/[0.1] bg-white px-2.5 py-1 text-xs text-[#5B6270] dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#949BA8]"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClearDemoQuestions();
                    setConfirmClearDemo(false);
                    setStatusMessage('已清空内置示例题，自建题目已保留');
                  }}
                  className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
                >
                  确认清空 {stats.demoCount} 道示例题
                </button>
              </div>
            )}
          </section>
        </div>

        {/* 底部 */}
        <div className="flex justify-end border-t border-slate-900/[0.08] px-4 py-3 dark:border-white/[0.07] sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-900/[0.1] bg-white px-4 py-1.5 text-sm font-medium text-[#181B22] hover:bg-slate-50 dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#E6E8EE]"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
