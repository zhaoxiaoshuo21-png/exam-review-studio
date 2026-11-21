import type { QuestionImage } from '../types/schema';

const MAX_LONG_EDGE_PX = 1400;
const COMPRESSION_QUALITY = 0.82;

function generateImageId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `img-${Date.now()}-${rand}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  throw new Error('Current runtime does not support Base64 encoding');
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    try {
      const result = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            resolve(reader.result);
          } else {
            reject(new Error('FileReader did not return string'));
          }
        };
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });
      return result;
    } catch {
      // 回退到 arrayBuffer 手动转换
    }
  }

  const buffer = await blob.arrayBuffer();
  const mimeType = blob.type || 'application/octet-stream';
  return `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
}

interface LoadedImageSource {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  cleanup?: () => void;
}

async function loadImageSource(blob: Blob, fallbackDataUrl: string): Promise<LoadedImageSource | null> {
  if (typeof Image !== 'undefined') {
    const hasObjectUrl =
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
    const srcUrl = hasObjectUrl ? URL.createObjectURL(blob) : fallbackDataUrl;

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const imageEl = new Image();
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('Image load timeout'));
          }
        }, 1500);

        imageEl.onload = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(imageEl);
          }
        };
        imageEl.onerror = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error('Image load failed'));
          }
        };
        imageEl.src = srcUrl;
      });

      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      if (width > 0 && height > 0) {
        return {
          width,
          height,
          draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
          cleanup: () => {
            if (hasObjectUrl && typeof URL.revokeObjectURL === 'function') {
              URL.revokeObjectURL(srcUrl);
            }
          },
        };
      }
      if (hasObjectUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(srcUrl);
      }
    } catch {
      if (hasObjectUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(srcUrl);
      }
    }
  }

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          width: bitmap.width,
          height: bitmap.height,
          draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
          cleanup: () => bitmap.close?.(),
        };
      }
      bitmap.close?.();
    } catch {
      // 忽略解码失败并走降级分支
    }
  }

  return null;
}

function getCanvas2dContext(): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    return { canvas, ctx };
  } catch {
    return null;
  }
}

/**
 * 压缩图片文件（Blob/File）：
 * - 浏览器环境使用 Canvas 等比缩放到最长边 <= 1400px
 * - 优先输出 image/webp (0.82)，若不支持则回退 image/jpeg (0.82)
 * - 无 Canvas 或非浏览器环境安全降级为原始 DataURL
 */
export async function compressImageFile(blob: Blob): Promise<QuestionImage> {
  const id = generateImageId();
  const fallbackDataUrl = await blobToDataUrl(blob);

  const canvasPair = getCanvas2dContext();
  if (!canvasPair) {
    return {
      id,
      dataUrl: fallbackDataUrl,
      width: 0,
      height: 0,
    };
  }

  const loaded = await loadImageSource(blob, fallbackDataUrl);
  if (!loaded) {
    return {
      id,
      dataUrl: fallbackDataUrl,
      width: 0,
      height: 0,
    };
  }

  try {
    const longEdge = Math.max(loaded.width, loaded.height);
    const scale = longEdge > MAX_LONG_EDGE_PX ? MAX_LONG_EDGE_PX / longEdge : 1;
    const targetWidth = Math.max(1, Math.round(loaded.width * scale));
    const targetHeight = Math.max(1, Math.round(loaded.height * scale));

    const { canvas, ctx } = canvasPair;
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    ctx.clearRect(0, 0, targetWidth, targetHeight);
    loaded.draw(ctx, targetWidth, targetHeight);

    let outputDataUrl = '';
    try {
      const webpUrl = canvas.toDataURL('image/webp', COMPRESSION_QUALITY);
      if (webpUrl && webpUrl.startsWith('data:image/webp')) {
        outputDataUrl = webpUrl;
      }
    } catch {
      // 忽略 webp 编码失败并回退 jpeg
    }

    if (!outputDataUrl) {
      try {
        // JPEG 无透明通道，先铺白底避免透明截图变黑底
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.restore();

        const jpegUrl = canvas.toDataURL('image/jpeg', COMPRESSION_QUALITY);
        if (jpegUrl && jpegUrl.startsWith('data:image/')) {
          outputDataUrl = jpegUrl;
        }
      } catch {
        // 回退原始 DataURL
      }
    }

    return {
      id,
      dataUrl: outputDataUrl || fallbackDataUrl,
      width: targetWidth,
      height: targetHeight,
    };
  } finally {
    loaded.cleanup?.();
  }
}

function isImageFile(file: File | Blob): boolean {
  if (file.type && file.type.toLowerCase().startsWith('image/')) {
    return true;
  }
  if ('name' in file && typeof file.name === 'string') {
    return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name);
  }
  return false;
}

/**
 * 从剪贴板 DataTransfer 中提取所有图片文件并批量压缩为 QuestionImage[]。
 */
export async function extractClipboardImages(
  clipboardData: DataTransfer | null,
): Promise<QuestionImage[]> {
  if (!clipboardData) return [];

  const imageBlobs: Blob[] = [];

  if (clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i += 1) {
      const item = clipboardData.items[i];
      if (item.kind === 'file' && item.type.toLowerCase().startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          imageBlobs.push(file);
        }
      }
    }
  }

  if (imageBlobs.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
    for (let i = 0; i < clipboardData.files.length; i += 1) {
      const file = clipboardData.files[i];
      if (file && isImageFile(file)) {
        imageBlobs.push(file);
      }
    }
  }

  if (imageBlobs.length === 0) {
    return [];
  }

  return Promise.all(imageBlobs.map((blob) => compressImageFile(blob)));
}
