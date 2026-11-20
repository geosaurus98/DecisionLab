/**
 * Small accessible UI primitives built on Tailwind. Kept in-house (instead of a component
 * library) to minimise dependencies; native elements (<dialog>, <details>, <select>) are
 * used wherever they provide accessibility for free.
 */
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import type { Provenance } from '@/domain/types';
import { parseMoney, type Cents } from '@/domain/money';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ───────── Buttons ─────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90 border border-transparent',
  secondary: 'bg-surface text-ink border border-border hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 border border-transparent',
  danger: 'bg-bad text-white hover:opacity-90 border border-transparent dark:text-black',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-sm' : 'h-10 px-4 text-sm',
        buttonStyles[variant],
        className,
      )}
      {...rest}
    />
  );
});

// ───────── Layout ─────────

export function Card({ title, description, actions, children, className }: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-xl border border-border bg-surface p-4 sm:p-5', className)}>
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-ink-2">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'bad' | 'good'; title?: string; children: ReactNode }) {
  const styles = {
    info: 'bg-accent-soft border-accent/30',
    warn: 'bg-warn-soft border-warn/40',
    bad: 'bg-bad-soft border-bad/40',
    good: 'bg-good-soft border-good/40',
  }[tone];
  const icon = { info: 'ℹ', warn: '⚠', bad: '✕', good: '✓' }[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : 'note'} className={cx('flex gap-2 rounded-lg border px-3 py-2 text-sm text-ink', styles)}>
      <span aria-hidden className="mt-px font-semibold">{icon}</span>
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-ink-2">{children}</div>
      </div>
    </div>
  );
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad'; title?: string }) {
  const styles = {
    neutral: 'bg-surface-2 text-ink-2',
    accent: 'bg-accent-soft text-accent',
    good: 'bg-good-soft text-good',
    warn: 'bg-warn-soft text-warn',
    bad: 'bg-bad-soft text-bad',
  }[tone];
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', styles)}>
      {children}
    </span>
  );
}

const PROVENANCE: Record<Provenance, { label: string; tone: 'good' | 'warn' | 'accent'; help: string }> = {
  known: { label: 'Known', tone: 'good', help: 'Calculated directly from your imported data.' },
  estimated: { label: 'Estimated', tone: 'warn', help: 'Inferred from patterns in your data; may be wrong.' },
  manual: { label: 'Manual', tone: 'accent', help: 'Entered by you.' },
};

export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const p = PROVENANCE[provenance];
  return (
    <Badge tone={p.tone} title={p.help}>
      {p.label}
    </Badge>
  );
}

/** A small "?" toggle that reveals a definition. Uses a disclosure button (keyboard accessible). */
export function InfoTip({ children, label = 'Definition' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted hover:text-ink"
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-6 z-30 w-64 -translate-x-1/2 rounded-lg border border-border bg-surface p-3 text-left text-xs font-normal leading-relaxed text-ink-2 shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}

export function Metric({ label, value, definition, sub, provenance, tone }: {
  label: string;
  value: ReactNode;
  definition?: ReactNode;
  sub?: ReactNode;
  provenance?: Provenance;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-1.5 text-sm text-ink-2">
        <span className="truncate">{label}</span>
        {definition && <InfoTip label={`What is ${label}?`}>{definition}</InfoTip>}
        {provenance && (
          <span className="ml-auto">
            <ProvenanceBadge provenance={provenance} />
          </span>
        )}
      </div>
      <div className={cx('mt-1 text-2xl font-semibold tabular', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

// ───────── Form controls ─────────

const inputBase =
  'w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-accent disabled:opacity-60';

export function Field({ label, hint, error, children, htmlFor, className }: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputBase, 'h-10', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputBase, 'h-10 pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputBase, 'min-h-[76px] py-2', className)} {...rest} />;
}

export function Checkbox({ label, checked, onChange, id, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; id?: string; hint?: ReactNode }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex items-start gap-2">
      <input id={inputId} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
      <label htmlFor={inputId} className="text-sm text-ink">
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </label>
    </div>
  );
}

/**
 * Money input in dollars. Holds the raw text while editing, and reports cents on every valid
 * change. Invalid text is shown with an error and not reported.
 */
export function MoneyInput({ value, onChange, id, allowNegative = false, ariaLabel, placeholder, className }: {
  value: Cents | null;
  onChange: (cents: Cents | null) => void;
  id?: string;
  allowNegative?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
}) {
  const format = (c: Cents | null) => (c === null ? '' : (c / 100).toFixed(2).replace(/\.00$/, ''));
  const [text, setText] = useState(format(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(format(value));
  }, [value, focused]);
  const parsed = text.trim() === '' ? null : parseMoney(text);
  const invalid = text.trim() !== '' && (parsed === null || (!allowNegative && parsed < 0));
  return (
    <div className={cx('relative', className)}>
      <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">
        $
      </span>
      <input
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        inputMode="decimal"
        placeholder={placeholder ?? '0'}
        className={cx(inputBase, 'h-10 pl-6 tabular', invalid && 'border-bad')}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const v = e.target.value.trim() === '' ? null : parseMoney(e.target.value);
          if (e.target.value.trim() === '') onChange(null);
          else if (v !== null && (allowNegative || v >= 0)) onChange(v);
        }}
      />
    </div>
  );
}

/** Percentage input: displays 6 for 0.06. */
export function PercentInput({ value, onChange, id, ariaLabel, min = -100, max = 100, step = 0.1 }: {
  value: number;
  onChange: (fraction: number) => void;
  id?: string;
  ariaLabel?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(String(+(value * 100).toFixed(4)));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(+(value * 100).toFixed(4)));
  }, [value, focused]);
  return (
    <div className="relative">
      <input
        id={id}
        aria-label={ariaLabel}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        className={cx(inputBase, 'h-10 pr-7 tabular')}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n / 100);
        }}
      />
      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">
        %
      </span>
    </div>
  );
}

export function NumberInput({ value, onChange, min, max, step = 1, id, ariaLabel, className }: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      className={cx(inputBase, 'h-10 tabular', className)}
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === '') return onChange(null);
        const n = Number(e.target.value);
        if (!Number.isFinite(n)) return;
        onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
      }}
    />
  );
}

export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-8 rounded-md px-3 text-sm font-medium',
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string; badge?: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-border px-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium',
            value === t.value ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink',
          )}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

// ───────── Dialogs ─────────

export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="modal-title"
      className={cx(
        'm-auto max-h-[92vh] w-[calc(100%-1.5rem)] overflow-hidden rounded-xl border border-border bg-surface p-0 text-ink shadow-2xl',
        wide ? 'max-w-5xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[92vh] flex-col">
          <header className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 id="modal-title" className="text-base font-semibold">
              {title}
            </h2>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              ✕
            </Button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmButton({ children, confirmText, onConfirm, variant = 'danger', title = 'Are you sure?', size }: {
  children: ReactNode;
  confirmText: ReactNode;
  onConfirm: () => void | Promise<void>;
  variant?: ButtonVariant;
  title?: string;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant === 'danger' ? 'secondary' : variant} size={size} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant={variant}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Working…' : 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="text-sm text-ink-2">{confirmText}</div>
      </Modal>
    </>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden />
      {label}…
    </div>
  );
}

export function CategoryDot({ color }: { color?: string }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color ?? 'var(--series-neutral)' }} />;
}
