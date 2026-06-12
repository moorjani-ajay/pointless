import { SLIDE_HEIGHT, SLIDE_WIDTH } from '@pointless/shared';
import { useEffect, useRef, useState } from 'react';

/**
 * Renders one slide at its fixed 1280×720 design size, scaled to fit the
 * parent. Slide HTML is sanitized server-side at write time.
 */
export function SlideCanvas({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setScale(Math.min(width / SLIDE_WIDTH, height / SLIDE_HEIGHT));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="slide-canvas">
      {scale > 0 && (
        <div
          className="slide-frame"
          style={{
            width: SLIDE_WIDTH * scale,
            height: SLIDE_HEIGHT * scale,
          }}
        >
          <section
            className="slide"
            style={{
              width: SLIDE_WIDTH,
              height: SLIDE_HEIGHT,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      )}
    </div>
  );
}
