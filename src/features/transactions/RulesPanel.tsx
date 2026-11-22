import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Button, Checkbox, ConfirmButton, Field, Input, Modal, Notice, Select, Spinner } from '@/ui/components';
import { db } from '@/data/db';
import { deleteRule, moveRule, reapplyCategorisation, saveRule } from '@/data/transactions';
import { isValidRegex, ruleMatches } from '@/engine/categorise';
import { ruleHealth, type RuleHealth } from '@/engine/ruleHealth';
import type { CategoryRule } from '@/domain/types';
import { useAnalytics } from '@/hooks/useAppData';
import { useToast } from '@/ui/toast';
import { CategorySelect } from './TransactionsPage';

type Draft = Omit<CategoryRule, 'id' | 'createdAt' | 'priority'> & Partial<CategoryRule>;

const blank: Draft = {
  name: '',
  field: 'description',
  operator: 'contains',
  pattern: '',
  caseSensitive: false,
  direction: 'any',
  categoryId: 'cat-other',
  enabled: true,
};

export function RulesPanel() {
  const rules = useLiveQuery(() => db.rules.orderBy('priority').toArray(), []);
  const analytics = useAnalytics();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);

  const matchCount = useMemo(() => {
    if (!draft || !draft.pattern.trim()) return 0;
    const rule = { ...draft, id: 'preview', createdAt: '', priority: 0, enabled: true } as CategoryRule;
    return analytics.transactions.filter((t) => ruleMatches(rule, t)).length;
  }, [draft, analytics.transactions]);

  const health = useMemo(() => new Map((rules ? ruleHealth(rules, analytics.transactions) : []).map((h) => [h.ruleId, h])), [rules, analytics.transactions]);
  const ruleName = (id: string | null) => rules?.find((r) => r.id === id)?.name ?? 'an earlier rule';
  if (!rules) return <Spinner />;
  const problems = [...health.values()].filter((h) => h.status === 'shadowed' || h.status === 'conflicts').length;
  const invalid = draft?.operator === 'regex' && !isValidRegex(draft.pattern);

  return (
    <div className="grid gap-4">
      <Notice>
        Rules run top to bottom; the first match wins. Your manual corrections (and “remember for this merchant” choices) always take precedence over
        rules. After changing rules, re-apply them to update existing transactions.
      </Notice>
      {analytics.transactions.length > 0 && problems > 0 && (
        <Notice tone="warn">
          {problems} rule{problems === 1 ? '' : 's'} may need attention: they can never win (an earlier rule always matches first) or they disagree with categories you chose yourself.
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setDraft({ ...blank })}>
          New rule
        </Button>
        <Button
          onClick={async () => {
            const n = await reapplyCategorisation();
            toast({ message: `Re-applied rules: ${n} transactions changed.`, tone: 'good' });
          }}
        >
          Re-apply rules to existing transactions
        </Button>
      </div>
      <ol className="grid gap-2">
        {rules.map((r, i) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
            <span className="w-6 text-right text-muted tabular">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {r.name || r.pattern} {!r.enabled && <Badge>Disabled</Badge>}{' '}
                {analytics.transactions.length > 0 && <HealthBadge h={health.get(r.id)} earlier={ruleName(health.get(r.id)?.shadowedBy ?? null)} category={(id) => analytics.categoryMap.get(id ?? '')?.name ?? 'Uncategorised'} />}
              </p>
              <p className="truncate text-xs text-muted">
                {r.field} {r.operator} “{r.pattern}”{r.direction !== 'any' ? ` · money ${r.direction}` : ''} → {analytics.categoryMap.get(r.categoryId)?.name ?? 'Missing category'}
              </p>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => moveRule(r.id, -1)}>
                ↑
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Move ${r.name} down`} disabled={i === rules.length - 1} onClick={() => moveRule(r.id, 1)}>
                ↓
              </Button>
              <Button size="sm" onClick={() => saveRule({ ...r, enabled: !r.enabled })}>
                {r.enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button size="sm" onClick={() => setDraft({ ...r })}>
                Edit
              </Button>
              <ConfirmButton size="sm" title="Delete rule?" confirmText="Transactions already categorised by this rule keep their category until you re-apply rules." onConfirm={() => deleteRule(r.id)}>
                Delete
              </ConfirmButton>
            </div>
          </li>
        ))}
      </ol>

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit rule' : 'New rule'}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!draft?.pattern.trim() || invalid}
              onClick={async () => {
                if (!draft) return;
                await saveRule({ ...draft, name: draft.name.trim() || draft.pattern });
                setDraft(null);
                toast({ message: 'Rule saved. Re-apply rules to update existing transactions.', tone: 'good' });
              }}
            >
              Save rule
            </Button>
          </>
        }
      >
        {draft && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="rule-name" className="sm:col-span-2">
              <Input id="rule-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Coffee shops" />
            </Field>
            <Field label="Match on" htmlFor="rule-field">
              <Select id="rule-field" value={draft.field} onChange={(e) => setDraft({ ...draft, field: e.target.value as CategoryRule['field'] })}>
                <option value="description">Full description</option>
                <option value="merchant">Normalised merchant</option>
              </Select>
            </Field>
            <Field label="Operator" htmlFor="rule-op">
              <Select id="rule-op" value={draft.operator} onChange={(e) => setDraft({ ...draft, operator: e.target.value as CategoryRule['operator'] })}>
                <option value="contains">contains</option>
                <option value="startsWith">starts with</option>
                <option value="equals">equals</option>
                <option value="regex">matches regular expression</option>
              </Select>
            </Field>
            <Field label="Text or pattern" htmlFor="rule-pattern" className="sm:col-span-2" error={invalid ? 'Invalid regular expression.' : null} hint={`${matchCount} existing transactions match.`}>
              <Input id="rule-pattern" value={draft.pattern} onChange={(e) => setDraft({ ...draft, pattern: e.target.value })} />
            </Field>
            <Field label="Direction" htmlFor="rule-dir">
              <Select id="rule-dir" value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value as CategoryRule['direction'] })}>
                <option value="any">Money in or out</option>
                <option value="out">Money out only</option>
                <option value="in">Money in only</option>
              </Select>
            </Field>
            <Field label="Category" htmlFor="rule-cat">
              <CategorySelect id="rule-cat" includeNone={false} categories={analytics.categories} value={draft.categoryId} onChange={(id) => id && setDraft({ ...draft, categoryId: id })} />
            </Field>
            <Checkbox label="Case sensitive" checked={draft.caseSensitive} onChange={(v) => setDraft({ ...draft, caseSensitive: v })} />
            <Checkbox label="Enabled" checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function HealthBadge({ h, earlier, category }: { h?: RuleHealth; earlier: string; category: (id: string | null) => string }) {
  if (!h) return null;
  switch (h.status) {
    case 'neverMatches':
      return <Badge title="No imported transaction matches this rule">No matches</Badge>;
    case 'shadowed':
      return (
        <Badge tone="warn" title={`Every transaction it matches is matched first by “${earlier}”. Move it up or remove it.`}>
          Never wins — “{earlier}” first
        </Badge>
      );
    case 'conflicts':
      return (
        <Badge tone="warn" title="You categorised transactions this rule matches differently. The rule may be too broad.">
          {h.conflicts} of your choices say {category(h.conflictCategoryId)}
        </Badge>
      );
    case 'ok':
      return <span className="text-xs font-normal text-muted">{h.effective} categorised</span>;
    default:
      return h.matches > 0 ? <span className="text-xs font-normal text-muted">would match {h.matches}</span> : null;
  }
}
