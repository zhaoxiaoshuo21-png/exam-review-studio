import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressImageFile, extractClipboardImages } from '../index';

describe('imageUtils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('gracefully falls back to DataURL when Canvas 2D context is unavailable', async () => {
    const blob = new Blob(['fake-png-bytes'], { type: 'image/png' });
    const img = await compressImageFile(blob);

    expect(img.id).toMatch(/^img-/);
    expect(img.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(img.width).toBe(0);
    expect(img.height).toBe(0);
  });

  it('scales image down so longest edge <= 1400px and falls back from webp to jpeg', async () => {
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const save = vi.fn();
    const restore = vi.fn();
    const clearRect = vi.fn();

    const toDataURL = vi.fn((mimeType: string) => {
      if (mimeType === 'image/webp') {
        // 模拟部分环境不支持 webp 编码而返回 png
        return 'data:image/png;base64,fallback';
      }
      if (mimeType === 'image/jpeg') {
        return 'data:image/jpeg;base64,compressed-jpeg';
      }
      return '';
    });

    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        drawImage,
        fillRect,
        save,
        restore,
        clearRect,
        globalCompositeOperation: 'source-over',
        fillStyle: '',
      })),
      toDataURL,
    } as unknown as HTMLCanvasElement;

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === 'canvas') {
        return fakeCanvas;
      }
      return origCreateElement(tagName);
    });

    class MockImage {
      naturalWidth = 2800;
      naturalHeight = 1400;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', MockImage);

    const blob = new Blob(['raw-image'], { type: 'image/png' });
    const result = await compressImageFile(blob);

    expect(result.width).toBe(1400);
    expect(result.height).toBe(700);
    expect(result.dataUrl).toBe('data:image/jpeg;base64,compressed-jpeg');
    expect(toDataURL).toHaveBeenCalledWith('image/webp', 0.82);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.82);
    expect(drawImage).toHaveBeenCalled();
  });

  it('extracts image files from clipboard items and skips non-image items', async () => {
    const imgFile = new File(['abc'], 'capture.png', { type: 'image/png' });
    const clipboardData = {
      items: [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'image/png', getAsFile: () => imgFile },
      ],
      files: [],
    } as unknown as DataTransfer;

    const images = await extractClipboardImages(clipboardData);
    expect(images).toHaveLength(1);
    expect(images[0].dataUrl).toMatch(/^data:image\/png;base64,/);

    expect(await extractClipboardImages(null)).toEqual([]);
  });
});
