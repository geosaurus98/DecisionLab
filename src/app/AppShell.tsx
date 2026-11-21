import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { cx } from '@/ui/components';
import { useDueReviewCount, useHasDemo } from '@/hooks/useAppData';
import { removeDemoData } from '@/data/backup';
import { useToast } from '@/ui/toast';

export const NAV = [
  { to: '/', label: 'Overview', icon: 'M3 12l9-8 9 8M5 10v10h14V10' },
  { to: '/transactions', label: 'Transactions', icon: 'M4 6h16M4 12h16M4 18h10' },
  { to: '/spending', label: 'Spending', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { to: '/decisions', label: 'Decisions', icon: 'M12 3v18M5 8l7-5 7 5M5 8l-2 6h4zM19 8l-2 6h4z' },
  { to: '/scenarios', label: 'Scenario Lab', icon: 'M3 17l5-6 4 3 8-9M14 5h6v6' },
  { to: '/insights', label: 'Insights', icon: 'M12 3a6 6 0 016 6c0 2.5-1.5 3.8-2.5 5H8.5C7.5 12.8 6 11.5 6 9a6 6 0 016-6zM9 18h6M10 21h4' },
  { to: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z' },
];

function Icon({ d }: { d: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function AppShell() {
  const hasDemo = useHasDemo();
  const due = useDueReviewCount();
  const badge = (to: string) =>
    to === '/decisions' && due > 0 ? (
      <span className="ml-auto rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-accent-ink" aria-label={`${due} due for review`}>
        {due}
      </span>
    ) : null;
  const toast = useToast();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <div className="min-h-screen md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-surface px-3 py-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="./icon.svg" alt="" className="h-7 w-7" />
          <span className="text-lg font-semibold tracking-tight">DecisionLab</span>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                cx('flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium', isActive ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')
              }
            >
              <Icon d={n.icon} />
              {n.label}
              {badge(n.to)}
            </NavLink>
          ))}
        </nav>
        <p className="mt-auto px-2 text-xs leading-relaxed text-muted">
          Your data stays in this browser. Nothing is sent anywhere.
        </p>
      </aside>

      <div className="min-w-0 flex-1 pb-20 md:pb-0">
        {hasDemo && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warn/40 bg-warn-soft px-4 py-2 text-center text-sm text-ink">
            <span>
              <strong>Demonstration data loaded.</strong> Accounts named “Demo” contain synthetic transactions, not real finances.
            </span>
            <button
              className="font-semibold text-accent underline"
              onClick={async () => {
                await removeDemoData();
                toast({ message: 'Demonstration data removed.', tone: 'good' });
              }}
            >
              Remove demo data
            </button>
          </div>
        )}
        <main id="main" ref={mainRef} tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-5 outline-none sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-7 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium', isActive ? 'text-accent' : 'text-ink-2')}
          >
            <span className="relative">
              <Icon d={n.icon} />
              {n.to === '/decisions' && due > 0 && (
                <span className="absolute -right-2 -top-1 rounded-full bg-accent px-1 text-[9px] font-semibold leading-3.5 text-accent-ink" aria-label={`${due} due for review`}>
                  {due}
                </span>
              )}
            </span>
            <span className="max-w-full truncate px-0.5">{n.label.replace('Scenario Lab', 'Scenarios')}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
