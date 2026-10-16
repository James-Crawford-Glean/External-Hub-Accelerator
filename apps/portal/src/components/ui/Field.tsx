/** Wraps ps-field / ps-field__label / hint / error markup. Replaces ps-field div blocks in dialogs. */
export function Field({
  label,
  hint,
  error,
  fullWidth,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  fullWidth?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={fullWidth ? 'ps-field ps-field--full' : 'ps-field'}>
      <span className="ps-field__label">{label}</span>
      {children}
      {error ? (
        <span className="ps-field__hint" style={{ color: 'var(--color-danger-strong)' }}>
          {error}
        </span>
      ) : hint ? (
        <span className="ps-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}
