import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { recordPage, recordRouteTransition } from '../../lib/telemetry';

export function AppShell({ children }: { children: ReactNode }) {
  // Key by path so each navigation remounts the page and replays the enter animation.
  const { pathname } = useLocation();
  const prevPath = useRef<string | null>(null);
  const commitAt = useRef<number>(0);

  // Layout effect runs after commit, before paint: the earliest post-render
  // moment to timestamp the new route.
  useLayoutEffect(() => {
    commitAt.current = performance.now();
  }, [pathname]);

  useEffect(() => {
    recordPage(pathname);
    const from = prevPath.current;
    prevPath.current = pathname;
    if (from === null || from === pathname) return;
    const start = commitAt.current;
    const raf = requestAnimationFrame(() =>
      recordRouteTransition({ route: pathname, fromRoute: from, durationMs: performance.now() - start }),
    );
    return () => cancelAnimationFrame(raf);
  }, [pathname]);

  return (
    <div className="ps-app">
      <Sidebar />
      <div className="ps-main">
        <TopBar />
        <main className="ps-page" key={pathname}>
          {children}
        </main>
      </div>
    </div>
  );
}
