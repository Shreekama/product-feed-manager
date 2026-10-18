'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import { clsx } from 'clsx';

export type LightboxImage = { src: string; altText?: string | null };

/**
 * Full-screen image viewer: ← / → (or the arrows) to move between images,
 * Esc or a click on the backdrop to close.
 */
export function Lightbox({
  images,
  startIndex = 0,
  title,
  onClose,
}: {
  images: LightboxImage[];
  startIndex?: number;
  title?: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const count = images.length;
  const current = images[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + count) % count);
      else if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % count);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [count, onClose]);

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex flex-col"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 text-white text-sm" onClick={(e) => e.stopPropagation()}>
        <span className="font-medium truncate">{title}</span>
        <span className="text-white/60 shrink-0">{index + 1} / {count}</span>
        <a
          href={current.src}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-white/70 hover:text-white shrink-0"
        >
          Open original <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <button onClick={onClose} className="p-1 text-white/70 hover:text-white" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main image */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-4 relative">
        {count > 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); setIndex((i) => (i - 1 + count) % count); }}
            className="absolute left-2 sm:left-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Previous image"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current.src}
          src={current.src}
          alt={current.altText || title || ''}
          className="max-h-full max-w-full object-contain rounded shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
        {count > 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); setIndex((i) => (i + 1) % count); }}
            className="absolute right-2 sm:right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Next image"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* Thumbnail strip */}
      {count > 1 && (
        <div className="flex gap-2 justify-center overflow-x-auto px-4 py-3" onClick={(e) => e.stopPropagation()}>
          {images.map((img, i) => (
            <button
              key={img.src + i}
              onClick={() => setIndex(i)}
              className={clsx(
                'shrink-0 rounded border-2 overflow-hidden',
                i === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt="" className="w-14 h-14 object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
