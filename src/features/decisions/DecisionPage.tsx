import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Button, ConfirmButton, EmptyState, Notice, PageHeader, Spinner, Tabs } from '@/ui/components';
import { db } from '@/data/db';
import { blankDecision, deleteDecision, duplicateDecision, saveDecision, scenarioFromDecision, validateDecision } from '@/data/decisions';
import { getDefaultAssumptions, getProfile } from '@/data/settings';
import type { Decision } from '@/domain/types';
import { useAnalytics, useFlexibility } from '@/hooks/useAppData';
import { useToast } from '@/ui/toast';
import { STATUS_LABEL, STATUS_TONE } from './labels';
import { SetupTab } from './SetupTab';
import { CompareTab } from './CompareTab';
import { FinanceTab } from './FinanceTab';
import { DecideTab } from './DecideTab';
import { ReviewTab } from './ReviewTab';

type Tab = 'setup' | 'compare' | 'finance' | 'decide' | 'review';

export function DecisionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const analytics = useAnalytics();
  const flex = useFlexibility(analytics);
  // null = not found; undefined = still loading.
  const stored = useLiveQuery(async () => (id && id !== 'new' ? ((await db.decisions.get(id)) ?? null) : null), [id]);
  const [draft, setDraft] = useState<Decision | null>(null);
  const [tab, setTab] = useState<Tab>('setup');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const creating = useRef(false);

  // "/decisions/new": create a blank decision, prefilled from the flexibility estimate, then redirect.
  useEffect(() => {
    if (id !== 'new' || creating.current || !flex) return;
    creating.current = true;
    (async () => {
      const [assumptions, profile] = await Promise.all([getDefaultAssumptions(), getProfile()]);
      const d = blankDecision({
        ...assumptions,
        initialBalance: Math.max(0, flex.availableNow ?? 0),
        monthlyContribution: profile.monthlySavingsCommitment,
      });
      await saveDecision(d);
      navigate(`/decisions/${d.id}`, { replace: true });
    })();
  }, [id, flex, navigate]);

  // Load the stored decision into the local draft (once per id).
  useEffect(() => {
    if (stored && (!draft || draft.id !== stored.id)) {
      setDraft(stored);
      setTab(stored.review ? 'review' : stored.snapshot ? 'decide' : 'setup');
    }
  }, [stored, draft]);

  // Debounced autosave of the draft.
  useEffect(() => {
    if (!draft || saveState !== 'unsaved') return;
    const t = setTimeout(async () => {
      setSaveState('saving');
      await saveDecision(draft);
      setSaveState('saved');
    }, 500);
    return () => clearTimeout(t);
  }, [draft, saveState]);

  // Flush pending edits if the user navigates away before the debounce fires.
  const latest = useRef<{ draft: Decision | null; state: typeof saveState }>({ draft: null, state: 'saved' });
  latest.current = { draft, state: saveState };
  useEffect(
    () => () => {
      const { draft: d, state } = latest.current;
      if (d && state === 'unsaved') void saveDecision(d);
    },
    [],
  );

  const update = (d: Decision) => {
    setDraft(d);
    setSaveState('unsaved');
  };
  // Replace the draft with a persisted version (e.g. after recording a choice).
  const replace = (d: Decision) => {
    setDraft(d);
    setSaveState('saved');
  };

  if (id === 'new') return <Spinner label="Creating decision" />;
  if (stored === undefined && !draft) return <Spinner />;
  if (!draft) {
    return (
      <EmptyState title="Decision not found" action={<Button onClick={() => navigate('/decisions')}>Back to decisions</Button>}>
        It may have been deleted.
      </EmptyState>
    );
  }
  const errors = validateDecision(draft);

  return (
    <div>
      <PageHeader
        title={draft.title || 'Untitled decision'}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[draft.status]}>{STATUS_LABEL[draft.status]}</Badge>
            {draft.isDemo && <Badge tone="warn">Demo</Badge>}
            <span className="text-xs text-muted" aria-live="polite">
              {saveState === 'saved' ? 'All changes saved locally' : saveState === 'saving' ? 'Saving…' : 'Unsaved changes'}
            </span>
          </span>
        }
        actions={
          <>
            <Button onClick={() => navigate('/decisions')}>Back</Button>
            <Button
              onClick={async () => {
                const set = scenarioFromDecision(draft);
                await db.scenarioSets.add(set);
                navigate(`/scenarios?set=${set.id}`);
              }}
            >
              Open in Scenario Lab
            </Button>
            <Button
              onClick={async () => {
                const copy = duplicateDecision(draft);
                await saveDecision(copy);
                navigate(`/decisions/${copy.id}`);
                toast({ message: 'Decision duplicated.', tone: 'good' });
              }}
            >
              Duplicate
            </Button>
            <ConfirmButton
              title="Delete decision?"
              confirmText="This permanently deletes the decision, its recorded choice and any outcome review."
              onConfirm={async () => {
                await deleteDecision(draft.id);
                navigate('/decisions');
              }}
            >
              Delete
            </ConfirmButton>
          </>
        }
      />
      {draft.snapshot && draft.status !== 'reviewed' && (
        <div className="mb-4">
          <Notice>
            A choice was recorded on {new Date(draft.snapshot.capturedAt).toLocaleDateString('en-NZ')}. That snapshot is frozen: edits below change the live
            decision but not what you predicted at the time.
          </Notice>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'setup', label: '1 · Options & criteria' },
          { value: 'compare', label: '2 · Compare' },
          { value: 'finance', label: '3 · Financial impact' },
          { value: 'decide', label: '4 · Decide' },
          { value: 'review', label: '5 · Review outcome' },
        ]}
      />
      {tab === 'setup' && <SetupTab decision={draft} onChange={update} errors={errors} onNext={() => setTab('compare')} />}
      {tab === 'compare' && <CompareTab decision={draft} onChange={update} />}
      {tab === 'finance' && <FinanceTab decision={draft} onChange={update} flex={flex} />}
      {tab === 'decide' && <DecideTab decision={draft} onChange={update} onReplace={replace} errors={errors} flex={flex} />}
      {tab === 'review' && <ReviewTab decision={draft} onReplace={replace} />}
    </div>
  );
}
