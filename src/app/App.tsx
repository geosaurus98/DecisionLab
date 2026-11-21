import { Component, Suspense, lazy, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ensureSeeded } from '@/data/init';
import { maybeNotifyDueReviews } from '@/data/reminders';
import { ToastProvider } from '@/ui/toast';
import { Button, Notice, Spinner } from '@/ui/components';
import { useTheme } from '@/ui/theme';
// Pages are code-split so the first load only fetches what it needs.
const page = <K extends string>(loader: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] })));
const OverviewPage = page(() => import('@/features/overview/OverviewPage'), 'OverviewPage');
const TransactionsPage = page(() => import('@/features/transactions/TransactionsPage'), 'TransactionsPage');
const SpendingPage = page(() => import('@/features/spending/SpendingPage'), 'SpendingPage');
const DecisionsPage = page(() => import('@/features/decisions/DecisionsPage'), 'DecisionsPage');
const DecisionPage = page(() => import('@/features/decisions/DecisionPage'), 'DecisionPage');
const ScenarioLabPage = page(() => import('@/features/scenarios/ScenarioLabPage'), 'ScenarioLabPage');
const InsightsPage = page(() => import('@/features/insights/InsightsPage'), 'InsightsPage');
const SettingsPage = page(() => import('@/features/settings/SettingsPage'), 'SettingsPage');

const wrap = (el: ReactNode) => <Suspense fallback={<Spinner />}>{el}</Suspense>;

// Hash routing works from any static host or folder without server rewrites.
const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: wrap(<OverviewPage />) },
      { path: 'transactions', element: wrap(<TransactionsPage />) },
      { path: 'spending', element: wrap(<SpendingPage />) },
      { path: 'decisions', element: wrap(<DecisionsPage />) },
      { path: 'decisions/:id', element: wrap(<DecisionPage />) },
      { path: 'scenarios', element: wrap(<ScenarioLabPage />) },
      { path: 'insights', element: wrap(<InsightsPage />) },
      { path: 'settings', element: wrap(<SettingsPage />) },
    ],
  },
]);

function RouteError() {
  return (
    <div className="mx-auto max-w-lg p-8">
      <Notice tone="bad" title="This page could not be displayed">
        Your data has not been changed. <a className="text-accent underline" href="#/">Return to the overview</a>.
      </Notice>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-lg p-8">
          <Notice tone="bad" title="Something went wrong">
            <p>An unexpected error occurred. Your stored data has not been changed.</p>
            <p className="mt-1 font-mono text-xs">{this.state.error.message}</p>
            <Button className="mt-3" onClick={() => location.reload()}>
              Reload
            </Button>
          </Notice>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  useTheme(); // applies the stored theme preference
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ensureSeeded()
      .then(() => {
        setReady(true);
        maybeNotifyDueReviews().catch(() => {});
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    // Ask the browser not to evict our IndexedDB data under storage pressure.
    navigator.storage?.persist?.().catch(() => {});
  }, []);
  if (error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <Notice tone="bad" title="Local storage is unavailable">
          DecisionLab stores data in this browser (IndexedDB), which could not be opened: {error}. Private browsing modes sometimes block it.
        </Notice>
      </div>
    );
  }
  if (!ready) return <Spinner label="Opening your local data" />;
  return (
    <ErrorBoundary>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ErrorBoundary>
  );
}
