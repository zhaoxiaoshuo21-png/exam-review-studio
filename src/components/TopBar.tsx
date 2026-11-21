import React, { useEffect, useRef, useState } from 'react';
import {
  CloudUpload,
  FileStack,
  Layers,
  ListChecks,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sun,
  X,
} from 'lucide-react';
import type { TopBarProps } from '../types/contracts';
import type { ReviewFilter } from '../types/schema';

export type FontFamilyPreference = 'sans' | 'serif' | 'note';
export type FontSizePreference = 'sm' | 'md' | 'lg';
export type ImageEyeMode = 'original' | 'soft' | 'invert';

export interface AppearanceSettings {
  fontFamily: FontFamilyPreference;
  fontSize: FontSizePreference;
  imgMode: ImageEyeMode;
}

export interface ExtendedTopBarProps extends TopBarProps {
  isDesktopSidebarOpen?: boolean;
  onToggleDesktopSidebar?: () => void;
  appearance?: AppearanceSettings;
  onChangeAppearance?: (next: AppearanceSettings) => void;
}

interface FilterChipItem {
  scope: ReviewFilter['scope'];
  label: string;
}

const FILTER_TABS: FilterChipItem[] = [
  { scope: 'all', label: '全部' },
  { scope: 'due', label: '今日待复习' },
  { scope: 'mistake', label: '错题' },
  { scope: 'gem', label: '好题' },
  { scope: 'template', label: '母题' },
  { scope: 'unmastered', label: '未掌握' },
  { scope: 'starred', label: '收藏' },
];

const FONT_OPTIONS: Array<{ value: FontFamilyPreference; label: string; sample: string }> = [
  { value: 'sans', label: '默认黑体', sample: '苹方/微软雅黑' },
  { value: 'serif', label: '宋体精排', sample: '纸媒阅读感' },
  { value: 'note', label: '手写笔记', sample: '文楷/楷体风' },
];

const SIZE_OPTIONS: Array<{ value: FontSizePreference; label: string; desc: string }> = [
  { value: 'sm', label: '小', desc: '14.5px' },
  { value: 'md', label: '标准', desc: '16px' },
  { value: 'lg', label: '大', desc: '17.5px' },
];

const IMG_MODE_OPTIONS: Array<{ value: ImageEyeMode; label: string }> = [
  { value: 'original', label: '原色' },
  { value: 'soft', label: '柔光' },
  { value: 'invert', label: '暗黑反色' },
];

const DEFAULT_APPEARANCE: AppearanceSettings = {
  fontFamily: 'sans',
  fontSize: 'md',
  imgMode: 'original',
};

export const TopBar: React.FC<ExtendedTopBarProps> = ({
  filter,
  viewMode,
  theme,
  totalCount,
  dueCount,
  onChangeFilter,
  onChangeViewMode,
  onToggleTheme,
  onOpenMobileFolders,
  onOpenQuickAdd,
  onOpenBatchImport,
  onOpenExportSync,
  isDesktopSidebarOpen = true,
  onToggleDesktopSidebar,
  appearance = DEFAULT_APPEARANCE,
  onChangeAppearance,
}) => {
  const [isAaOpen, setIsAaOpen] = useState(false);
  const aaContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isAaOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        aaContainerRef.current &&
        !aaContainerRef.current.contains(e.target as Node)
      ) {
        setIsAaOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAaOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAaOpen]);

  const handleScopeChange = (scope: ReviewFilter['scope']) => {
    if (filter.scope === scope) return;
    onChangeFilter({ ...filter, scope });
  };

  const handleSearchChange = (value: string) => {
    onChangeFilter({ ...filter, searchQuery: value });
  };

  const updateAppearance = (patch: Partial<AppearanceSettings>) => {
    if (!onChangeAppearance) return;
    onChangeAppearance({ ...appearance, ...patch });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-900/[0.08] bg-[#F7F6F2]/92 backdrop-blur-md dark:border-white/[0.065] dark:bg-[#0D0E11]/92">
      <div className="mx-auto max-w-[1680px] px-3 pt-2.5 sm:px-5">
        {/* 第一行：侧栏开关 / 极简字标 + 搜索框 + 动作区 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            {/* 手机端目录抽屉按钮 */}
            <button
              type="button"
              onClick={onOpenMobileFolders}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#5B6270] transition hover:bg-black/[0.05] hover:text-[#181B22] dark:text-[#949BA8] dark:hover:bg-white/[0.06] dark:hover:text-[#F5F6FA] lg:hidden"
              aria-label="打开题型目录"
              title="打开题型目录"
            >
              <Menu className="h-4 w-4" />
            </button>

            {/* 桌面端侧栏收起/展开按钮 */}
            {onToggleDesktopSidebar && (
              <button
                type="button"
                onClick={onToggleDesktopSidebar}
                className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#5B6270] transition hover:bg-black/[0.05] hover:text-[#181B22] dark:text-[#949BA8] dark:hover:bg-white/[0.06] dark:hover:text-[#F5F6FA] lg:inline-flex"
                aria-label={isDesktopSidebarOpen ? '收起题型目录' : '展开题型目录'}
                title={isDesktopSidebarOpen ? '收起题型目录' : '展开题型目录'}
              >
                {isDesktopSidebarOpen ? (
                  <PanelLeftClose className="h-4 w-4" />
                ) : (
                  <PanelLeftOpen className="h-4 w-4" />
                )}
              </button>
            )}

            {/* 极简品牌字标（390px 下不截断） */}
            <div className="flex shrink-0 items-baseline gap-2">
              <h1 className="whitespace-nowrap text-[15px] font-semibold tracking-tight text-[#181B22] dark:text-[#F5F6FA] sm:text-base">
                备考复盘本
              </h1>
              <span className="hidden text-xs tabular-nums text-[#88909E] dark:text-[#656C7A] xl:inline">
                {totalCount} 题
              </span>
            </div>
          </div>

          {/* 桌面端轻量搜索框 */}
          <div className="hidden max-w-xs flex-1 md:block lg:max-w-sm">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#88909E] dark:text-[#656C7A]" />
              <input
                type="search"
                value={filter.searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="搜题干、标签、解析或笔记..."
                className="h-8 w-full rounded-lg border border-transparent bg-black/[0.04] pl-8 pr-7 text-xs text-[#181B22] placeholder:text-[#88909E] focus:border-slate-900/15 focus:bg-white focus:outline-none dark:bg-white/[0.05] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A] dark:focus:border-white/15 dark:focus:bg-[#14161B]"
              />
              {filter.searchQuery && (
                <button
                  type="button"
                  onClick={() => handleSearchChange('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#88909E] hover:text-[#181B22] dark:hover:text-white"
                  aria-label="清空搜索"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* 右侧极简操作区 */}
          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            {/* 桌面端视图切换 */}
            <div className="hidden items-center rounded-lg bg-black/[0.04] p-0.5 dark:bg-white/[0.05] lg:inline-flex">
              <button
                type="button"
                onClick={() => onChangeViewMode('review')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  viewMode === 'review'
                    ? 'bg-white text-[#181B22] shadow-sm dark:bg-[#1E2128] dark:text-[#F5F6FA]'
                    : 'text-[#5B6270] hover:text-[#181B22] dark:text-[#949BA8] dark:hover:text-[#E6E8EE]'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                刷题复盘
              </button>
              <button
                type="button"
                onClick={() => onChangeViewMode('list')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  viewMode === 'list'
                    ? 'bg-white text-[#181B22] shadow-sm dark:bg-[#1E2128] dark:text-[#F5F6FA]'
                    : 'text-[#5B6270] hover:text-[#181B22] dark:text-[#949BA8] dark:hover:text-[#E6E8EE]'
                }`}
              >
                <ListChecks className="h-3.5 w-3.5" />
                题库列表
              </button>
            </div>

            <button
              type="button"
              onClick={onOpenQuickAdd}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-[#181B22] px-2.5 text-xs font-medium text-white transition hover:bg-[#2C313D] dark:bg-[#F5F6FA] dark:text-[#0D0E11] dark:hover:bg-white sm:px-3"
            >
              <Plus className="h-3.5 w-3.5 stroke-[2.25]" />
              <span>录一题</span>
            </button>

            <button
              type="button"
              onClick={onOpenBatchImport}
              title="批量拆题导入"
              aria-label="批量拆题"
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[#5B6270] transition hover:bg-black/[0.045] hover:text-[#181B22] dark:text-[#949BA8] dark:hover:bg-white/[0.06] dark:hover:text-[#F5F6FA] sm:px-2.5"
            >
              <FileStack className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">批量拆题</span>
            </button>

            <button
              type="button"
              onClick={onOpenExportSync}
              title="导出单文件 HTML / 百度网盘同步"
              aria-label="导出/网盘同步"
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[#5B6270] transition hover:bg-black/[0.045] hover:text-[#181B22] dark:text-[#949BA8] dark:hover:bg-white/[0.06] dark:hover:text-[#F5F6FA] sm:px-2.5"
            >
              <CloudUpload className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">导出/网盘同步</span>
            </button>

            {/* Aa 排印与外观设置浮层 */}
            <div ref={aaContainerRef} className="relative">
              <button
                type="button"
                onClick={() => setIsAaOpen((prev) => !prev)}
                aria-label="排印与外观设置"
                aria-expanded={isAaOpen}
                title="排印字体、字号与护眼设置"
                className={`inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-xs font-semibold tracking-tight transition ${
                  isAaOpen
                    ? 'bg-black/[0.08] text-[#181B22] dark:bg-white/[0.12] dark:text-[#F5F6FA]'
                    : 'text-[#5B6270] hover:bg-black/[0.045] hover:text-[#181B22] dark:text-[#949BA8] dark:hover:bg-white/[0.06] dark:hover:text-[#F5F6FA]'
                }`}
              >
                Aa
              </button>

              {isAaOpen && (
                <div className="absolute right-0 top-10 z-50 w-72 rounded-xl border border-slate-900/10 bg-white p-3.5 shadow-xl dark:border-white/10 dark:bg-[#14161B]">
                  <div className="space-y-3.5">
                    {/* 字体风格 */}
                    <div>
                      <div className="mb-1.5 text-[11px] font-medium text-[#88909E] dark:text-[#656C7A]">
                        阅读字体
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {FONT_OPTIONS.map((opt) => {
                          const active = appearance.fontFamily === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => updateAppearance({ fontFamily: opt.value })}
                              className={`rounded-lg border px-2 py-1.5 text-center transition ${
                                active
                                  ? 'border-[#181B22] bg-[#181B22] text-white dark:border-[#F5F6FA] dark:bg-[#F5F6FA] dark:text-[#0D0E11]'
                                  : 'border-slate-900/[0.08] bg-[#F7F6F2] text-[#181B22] hover:border-slate-900/20 dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#E6E8EE] dark:hover:border-white/20'
                              }`}
                            >
                              <div className="text-xs font-medium">{opt.label}</div>
                              <div
                                className={`mt-0.5 text-[10px] ${
                                  active
                                    ? 'text-white/75 dark:text-[#0D0E11]/70'
                                    : 'text-[#88909E] dark:text-[#656C7A]'
                                }`}
                              >
                                {opt.sample}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 字号 */}
                    <div>
                      <div className="mb-1.5 text-[11px] font-medium text-[#88909E] dark:text-[#656C7A]">
                        正文字号
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {SIZE_OPTIONS.map((opt) => {
                          const active = appearance.fontSize === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => updateAppearance({ fontSize: opt.value })}
                              className={`rounded-lg border px-2 py-1.5 text-center transition ${
                                active
                                  ? 'border-[#181B22] bg-[#181B22] text-white dark:border-[#F5F6FA] dark:bg-[#F5F6FA] dark:text-[#0D0E11]'
                                  : 'border-slate-900/[0.08] bg-[#F7F6F2] text-[#181B22] hover:border-slate-900/20 dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#E6E8EE] dark:hover:border-white/20'
                              }`}
                            >
                              <span className="text-xs font-medium">{opt.label}</span>
                              <span
                                className={`ml-1 text-[10px] ${
                                  active
                                    ? 'text-white/75 dark:text-[#0D0E11]/70'
                                    : 'text-[#88909E] dark:text-[#656C7A]'
                                }`}
                              >
                                {opt.desc}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 图片暗黑护眼模式 */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-[#88909E] dark:text-[#656C7A]">
                          图片暗黑护眼
                        </span>
                        <span className="text-[10px] text-[#88909E] dark:text-[#656C7A]">
                          深色模式生效
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {IMG_MODE_OPTIONS.map((opt) => {
                          const active = appearance.imgMode === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => updateAppearance({ imgMode: opt.value })}
                              className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                                active
                                  ? 'border-[#181B22] bg-[#181B22] text-white dark:border-[#F5F6FA] dark:bg-[#F5F6FA] dark:text-[#0D0E11]'
                                  : 'border-slate-900/[0.08] bg-[#F7F6F2] text-[#181B22] hover:border-slate-900/20 dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#E6E8EE] dark:hover:border-white/20'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 深浅色切换 */}
                    <div className="border-t border-slate-900/[0.07] pt-3 dark:border-white/[0.07]">
                      <div className="mb-1.5 text-[11px] font-medium text-[#88909E] dark:text-[#656C7A]">
                        页面主题
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (theme !== 'light') onToggleTheme();
                          }}
                          className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                            theme === 'light'
                              ? 'border-[#181B22] bg-[#181B22] text-white'
                              : 'border-slate-900/[0.08] bg-[#F7F6F2] text-[#181B22] dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#E6E8EE]'
                          }`}
                        >
                          <Sun className="h-3.5 w-3.5" />
                          纸白浅色
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (theme !== 'dark') onToggleTheme();
                          }}
                          className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                            theme === 'dark'
                              ? 'border-[#F5F6FA] bg-[#F5F6FA] text-[#0D0E11]'
                              : 'border-slate-900/[0.08] bg-[#F7F6F2] text-[#181B22] dark:border-white/[0.08] dark:bg-[#1B1E25] dark:text-[#E6E8EE]'
                          }`}
                        >
                          <Moon className="h-3.5 w-3.5" />
                          石墨深色
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 快捷深浅色按钮 */}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
              title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#5B6270] transition hover:bg-black/[0.045] hover:text-[#181B22] dark:text-[#949BA8] dark:hover:bg-white/[0.06] dark:hover:text-[#F5F6FA]"
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* 移动端搜索框与视图切换 */}
        <div className="mt-2 flex items-center gap-2 lg:hidden">
          <div className="relative min-w-0 flex-1 md:hidden">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#88909E] dark:text-[#656C7A]" />
            <input
              type="search"
              value={filter.searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="搜题干、标签、笔记..."
              className="h-8 w-full rounded-lg border border-transparent bg-black/[0.04] pl-8 pr-7 text-xs text-[#181B22] placeholder:text-[#88909E] focus:border-slate-900/15 focus:bg-white focus:outline-none dark:bg-white/[0.05] dark:text-[#E6E8EE] dark:placeholder:text-[#656C7A] dark:focus:bg-[#14161B]"
            />
            {filter.searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#88909E]"
                aria-label="清空搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="inline-flex shrink-0 items-center rounded-lg bg-black/[0.04] p-0.5 dark:bg-white/[0.05]">
            <button
              type="button"
              onClick={() => onChangeViewMode('review')}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                viewMode === 'review'
                  ? 'bg-white text-[#181B22] shadow-sm dark:bg-[#1E2128] dark:text-[#F5F6FA]'
                  : 'text-[#5B6270] dark:text-[#949BA8]'
              }`}
            >
              <Layers className="h-3 w-3" />
              刷题复盘
            </button>
            <button
              type="button"
              onClick={() => onChangeViewMode('list')}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                viewMode === 'list'
                  ? 'bg-white text-[#181B22] shadow-sm dark:bg-[#1E2128] dark:text-[#F5F6FA]'
                  : 'text-[#5B6270] dark:text-[#949BA8]'
              }`}
            >
              <ListChecks className="h-3 w-3" />
              题库列表
            </button>
          </div>
        </div>

        {/* 极简无框文字筛选条 */}
        <nav
          aria-label="题目筛选"
          className="no-scrollbar mt-1.5 flex items-center gap-4 overflow-x-auto sm:gap-5"
        >
          {FILTER_TABS.map((tab) => {
            const active = filter.scope === tab.scope;
            return (
              <button
                key={tab.scope}
                type="button"
                onClick={() => handleScopeChange(tab.scope)}
                className={`relative inline-flex shrink-0 items-center gap-1.5 border-b-2 py-2 text-xs transition ${
                  active
                    ? 'border-[#181B22] font-semibold text-[#181B22] dark:border-[#F5F6FA] dark:text-[#F5F6FA]'
                    : 'border-transparent font-normal text-[#5B6270] hover:text-[#181B22] dark:text-[#949BA8] dark:hover:text-[#E6E8EE]'
                }`}
              >
                <span>{tab.label}</span>
                {tab.scope === 'due' && dueCount > 0 && (
                  <span className="tabular-nums text-[11px] font-medium text-[#C93B3B] dark:text-[#F06A6A]">
                    {dueCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
