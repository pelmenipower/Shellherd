import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n';

export function ResizableSidebar({ children, collapsed }: { children: ReactNode; collapsed: boolean }) {
  const { t } = useT();
  const [width, setWidth] = useState(240);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const resize = (next: number) => setWidth(Math.min(360, Math.max(200, next)));
  return <div className="sidebar-container" hidden={collapsed} style={{ width }}>
    <aside className="sidebar" aria-label={t('app:resizable.aria')}>{children}</aside>
    <div className="sidebar-resize" role="separator" aria-label={t('app:resizable.handle')} aria-orientation="vertical"
      aria-valuemin={200} aria-valuemax={360} aria-valuenow={width} tabIndex={0}
      onPointerDown={event => { drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current) resize(drag.current.width + event.clientX - drag.current.x); }}
      onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={() => resize(240)} onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); resize(event.key === 'Home' ? 200 : event.key === 'End' ? 360 : width + (event.key === 'ArrowRight' ? 10 : -10));
        }
      }} />
  </div>;
}
