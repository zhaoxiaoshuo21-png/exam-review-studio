import type { CoreEngineContracts } from '../types/contracts';
import { parseBatchAnalysis } from './batchParser';
import {
  EMBEDDED_DATA_SCRIPT_ID,
  buildSelfContainedHtmlString,
  exportSelfContainedHtml,
  isViteDevMode,
  parseEmbeddedSnapshotFromHtml,
  readEmbeddedSnapshotFromDocument,
  serializeSnapshotForScript,
} from './htmlExporter';
import { compressImageFile, extractClipboardImages } from './imageUtils';
import {
  escapeHtml,
  normalizePastedAnalysis,
  renderAnalysisHtml,
  stripLatexMarkup,
} from './markdownRenderer';
import {
  computeNextReviewAt,
  createSeedSnapshot,
  getDescendantFolderIds,
} from './seedData';
import {
  applyProgressPatch,
  clearDemoQuestions,
  exportProgressPatch,
  loadInitialSnapshot,
  mergeSnapshots,
  resetMemoryStorageForTests,
  saveSnapshot,
} from './storage';

export {
  EMBEDDED_DATA_SCRIPT_ID,
  applyProgressPatch,
  buildSelfContainedHtmlString,
  clearDemoQuestions,
  compressImageFile,
  computeNextReviewAt,
  createSeedSnapshot,
  escapeHtml,
  exportProgressPatch,
  exportSelfContainedHtml,
  extractClipboardImages,
  getDescendantFolderIds,
  isViteDevMode,
  loadInitialSnapshot,
  mergeSnapshots,
  normalizePastedAnalysis,
  parseBatchAnalysis,
  parseEmbeddedSnapshotFromHtml,
  readEmbeddedSnapshotFromDocument,
  renderAnalysisHtml,
  resetMemoryStorageForTests,
  saveSnapshot,
  serializeSnapshotForScript,
  stripLatexMarkup,
};

/** 编译期校验核心模块导出严格满足 CoreEngineContracts 接口契约 */
export const coreEngine: CoreEngineContracts = {
  loadInitialSnapshot,
  saveSnapshot,
  mergeSnapshots,
  exportProgressPatch,
  applyProgressPatch,
  compressImageFile,
  extractClipboardImages,
  renderAnalysisHtml,
  parseBatchAnalysis,
  exportSelfContainedHtml,
  buildSelfContainedHtmlString,
  computeNextReviewAt,
  createSeedSnapshot,
};
