import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Contrast,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ImageLightboxProps } from '../types/contracts';

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

/**
 * 暗房质感全屏高清看图灯箱：
 * 高透暗黑磨砂背景 + 底部悬浮毛玻璃胶囊工具条（缩放、百分比、1:1 复位、暗色护眼反色开关、多图切换）。
 */
export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  images,
  initialIndex,
  isOpen,
  onClose,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isInverted, setIsInverted] = useState(false);

  const dragOriginRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(
    null,
  );
  const didMoveRef = useRef(false);

  const clampIndex = useCallback(
    (idx: number) => {
      if (images.length === 0) return 0;
      return Math.max(0, Math.min(idx, images.length - 1));
    },
    [images.length],
  );

  const resetTransform = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (isOpen) {
      setActiveIndex(clampIndex(initialIndex));
      resetTransform();
      const root = document.documentElement;
      const globalInvert =
        root.classList.contains('dark') && root.dataset.imgMode === 'invert';
      setIsInverted(globalInvert);
    }
  }, [isOpen, initialIndex, clampIndex, resetTransform]);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  const goPrev = useCallback(() => {
    if (images.length <= 1) return;
    setActiveIndex((prev) => (prev - 1 + images.length) % images.length);
    resetTransform();
  }, [images.length, resetTransform]);

  const goNext = useCallback(() => {
    if (images.length <= 1) return;
    setActiveIndex((prev) => (prev + 1) % images.length);
    resetTransform();
  }, [images.length, resetTransform]);

  const zoomIn = useCallback(() => {
    setScale((prev) => Math.min(MAX_SCALE, Number((prev + SCALE_STEP).toFixed(2))));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((prev) => {
      const next = Math.max(MIN_SCALE, Number((prev - SCALE_STEP).toFixed(2)));
      if (next <= 1) {
        setOffset({ x: 0, y: 0 });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        goNext();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        e.stopPropagation();
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        e.stopPropagation();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        e.stopPropagation();
        resetTransform();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose, goPrev, goNext, zoomIn, zoomOut, resetTransform]);

  if (!isOpen || images.length === 0) {
    return null;
  }

  const safeIndex = clampIndex(activeIndex);
  const activeImage = images[safeIndex];

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) {
      zoomIn();
    } else if (e.deltaY > 0) {
      zoomOut();
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (scale <= 1) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOriginRef.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
    didMoveRef.current = false;
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!dragOriginRef.current) return;
    const dx = e.clientX - dragOriginRef.current.x;
    const dy = e.clientY - dragOriginRef.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      didMoveRef.current = true;
    }
    setOffset({
      x: dragOriginRef.current.offsetX + dx,
      y: dragOriginRef.current.offsetY + dy,
    });
  };

  const handlePointerUp = () => {
    dragOriginRef.current = null;
    setIsDragging(false);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (scale > 1) {
      resetTransform();
    } else {
      setScale(2);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (didMoveRef.current) {
      didMoveRef.current = false;
      return;
    }
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="高清原图查看器"
      className="fixed inset-0 z-50 flex flex-col bg-[#0B0C0F]/92 backdrop-blur-xl select-none"
    >
      {/* 极简暗房顶部信息栏 */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white/90 sm:px-6">
        <div className="flex items-center gap-3 text-xs sm:text-sm min-w-0">
          <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-xs font-medium tabular-nums">
            {safeIndex + 1} / {images.length}
          </span>
          {activeImage.width > 0 && activeImage.height > 0 && (
            <span className="hidden sm:inline text-xs tabular-nums text-white/45">
              {activeImage.width} × {activeImage.height}
            </span>
          )}
          {activeImage.caption && (
            <span className="truncate text-xs text-white/70">{activeImage.caption}</span>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          title="关闭 (Esc)"
          aria-label="关闭灯箱"
          className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/90 hover:bg-white/15 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          <span>关闭</span>
        </button>
      </div>

      {/* 主看图区 */}
      <div
        onClick={handleBackdropClick}
        onWheel={handleWheel}
        className="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-24 pt-2 sm:px-8"
      >
        {images.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            aria-label="上一张"
            className="absolute left-3 sm:left-6 z-10 rounded-full border border-white/15 bg-black/55 backdrop-blur-md p-2.5 text-white/90 hover:bg-white/15 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        <img
          src={activeImage.dataUrl}
          alt={activeImage.caption || `附图 ${safeIndex + 1}`}
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 140ms ease-out',
          }}
          className={`max-h-[78vh] max-w-[90vw] rounded-xl bg-white object-contain shadow-2xl ${
            isInverted ? 'img-force-invert' : ''
          } ${scale > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'}`}
        />

        {images.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            aria-label="下一张"
            className="absolute right-3 sm:right-6 z-10 rounded-full border border-white/15 bg-black/55 backdrop-blur-md p-2.5 text-white/90 hover:bg-white/15 transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}

        {/* 底部悬浮毛玻璃胶囊工具条 */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2.5"
        >
          {images.length > 1 && (
            <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 backdrop-blur-md px-2.5 py-1.5">
              {images.map((img, idx) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => {
                    setActiveIndex(idx);
                    resetTransform();
                  }}
                  aria-label={`切换到第 ${idx + 1} 张`}
                  className={`h-8 w-10 overflow-hidden rounded border transition-all bg-white ${
                    idx === safeIndex
                      ? 'border-white ring-1 ring-white/60 opacity-100'
                      : 'border-transparent opacity-50 hover:opacity-90'
                  }`}
                >
                  <img
                    src={img.dataUrl}
                    alt={img.caption || `缩略图 ${idx + 1}`}
                    className={`h-full w-full object-contain ${isInverted ? 'img-force-invert' : ''}`}
                  />
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 rounded-full border border-white/15 bg-black/60 backdrop-blur-xl px-3 py-1.5 text-xs text-white/90 shadow-2xl">
            <button
              type="button"
              onClick={zoomOut}
              disabled={scale <= MIN_SCALE}
              title="缩小 (-)"
              aria-label="缩小"
              className="rounded-full p-1.5 text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-35 transition-colors"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-[3.1rem] text-center font-mono text-[11px] tabular-nums text-white/85">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={zoomIn}
              disabled={scale >= MAX_SCALE}
              title="放大 (+)"
              aria-label="放大"
              className="rounded-full p-1.5 text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-35 transition-colors"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={resetTransform}
              title="1:1 复位 (0)"
              aria-label="复位缩放"
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>1:1</span>
            </button>

            <span className="mx-1 h-3.5 w-px bg-white/15" />

            <button
              type="button"
              onClick={() => setIsInverted((prev) => !prev)}
              aria-pressed={isInverted}
              title="切换白底图片暗黑护眼反色"
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                isInverted
                  ? 'bg-white text-[#0D0E11]'
                  : 'text-white/85 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Contrast className="h-3.5 w-3.5" />
              <span>护眼反色</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageLightbox;
