import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Pencil,
  Shield,
  ShieldAlert,
} from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { showToast } from '../../state/toast';
import { apiKeyScopeDescriptions, apiKeyScopeLabels } from '../../lib/labels';
import type { ApiKeyScope } from '../../data/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Persists the key and returns the full secret (shown exactly once). */
  create: (input: {
    name: string;
    scopes: ApiKeyScope[];
    expiresAt: string | null;
  }) => Promise<string>;
  /** Fired after a successful create, before the reveal step. */
  onCreated?: () => void;
}

const SCOPES: ApiKeyScope[] = ['READ', 'WRITE', 'ADMIN'];
const SCOPE_ICON: Record<ApiKeyScope, React.ReactNode> = {
  READ: <KeyRound size={15} />,
  WRITE: <Pencil size={14} />,
  ADMIN: <Shield size={15} />,
};

/**
 * Create an API key. Two steps: configure (name + scopes + optional expiry), then
 * reveal the secret exactly once. The secret is returned by `create` and lives only in
 * this component's state for the reveal — it never re-enters any store.
 */
export function CreateApiKeyDialog({
  open,
  onClose,
  create,
  onCreated,
}: Props) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['READ']);
  const [expiresOn, setExpiresOn] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && scopes.length > 0 && !submitting;
  const elevated = scopes.includes('ADMIN');

  function reset() {
    setName('');
    setScopes(['READ']);
    setExpiresOn('');
    setSecret(null);
    setCopied(false);
    setSubmitting(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function toggleScope(scope: ApiKeyScope) {
    setScopes((cur) =>
      cur.includes(scope)
        ? cur.filter((s) => s !== scope)
        : [...SCOPES.filter((s) => cur.includes(s) || s === scope)],
    );
  }

  async function handleCreate() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const full = await create({
        name: trimmed,
        scopes,
        expiresAt: expiresOn
          ? new Date(`${expiresOn}T00:00:00Z`).toISOString()
          : null,
      });
      onCreated?.();
      setSecret(full);
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Failed to create key',
        'warning',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      showToast('Secret copied to clipboard', 'success');
    } catch {
      showToast('Copy failed — select the value and copy manually', 'warning');
    }
  }

  // -------- Step 2: reveal the secret exactly once --------
  if (secret) {
    return (
      <Dialog
        open={open}
        onClose={handleClose}
        title="Save your API key"
        subtitle="This is the only time the full secret is shown. Store it somewhere safe — you can't retrieve it again."
        width={560}
        cancelLabel="Done"
      >
        <div className="apikey-reveal">
          <div className="apikey-reveal__label">{trimmed}</div>
          <div className="apikey-reveal__secret">
            <code className="ps-text-mono">{secret}</code>
            <button
              type="button"
              className={`apikey-copy${copied ? ' apikey-copy--done' : ''}`}
              onClick={copySecret}
              aria-label="Copy secret"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <div className="apikey-warn" role="note">
          <AlertTriangle size={15} className="apikey-warn__icon" />
          <div>
            Send this token as{' '}
            <code className="ps-text-mono">
              Authorization: Bearer &lt;secret&gt;
            </code>
            . The portal stores only a hash and will never display it again —
            if you lose it, delete this key and create a new one.
          </div>
        </div>
      </Dialog>
    );
  }

  // -------- Step 1: configure the key --------
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Create API key"
      subtitle="A service credential external systems use to call the API. Not tied to a person."
      width={560}
      primaryAction={{
        label: submitting ? 'Creating…' : 'Create key',
        onClick: handleCreate,
        disabled: !canSubmit,
        variant: 'primary',
      }}
      footerHint={
        trimmed.length === 0
          ? 'Give the key a recognizable name'
          : scopes.length === 0
            ? 'Select at least one scope'
            : undefined
      }
    >
      <div className="ps-form-grid">
        <div className="ps-field ps-field--full">
          <span className="ps-field__label">Key name</span>
          <input
            className="ps-input"
            type="text"
            placeholder="e.g. Nightly inventory sync"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <span className="ps-field__hint">
            Name it after the system or job that will use it.
          </span>
        </div>

        <div className="ps-field ps-field--full">
          <span className="ps-field__label">Scopes</span>
          <div
            className="apikey-choice apikey-choice--stack"
            role="group"
            aria-label="Scopes"
          >
            {SCOPES.map((scope) => (
              <ScopeOption
                key={scope}
                icon={SCOPE_ICON[scope]}
                title={apiKeyScopeLabels[scope]}
                description={apiKeyScopeDescriptions[scope]}
                selected={scopes.includes(scope)}
                onToggle={() => toggleScope(scope)}
              />
            ))}
          </div>
          <span className="ps-field__hint">
            Pick every capability this key needs. Grant the least required.
          </span>
        </div>

        {elevated && (
          <div className="apikey-warn apikey-warn--full" role="note">
            <ShieldAlert size={15} className="apikey-warn__icon" />
            <div>
              An <strong>Admin</strong>-scope key can change configuration and
              reach admin operations across the whole workspace. Share it only
              with trusted systems.
            </div>
          </div>
        )}

        <div className="ps-field ps-field--full">
          <span className="ps-field__label">Expiration (optional)</span>
          <input
            className="ps-input"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
          <span className="ps-field__hint">
            Leave blank for a key that never expires. The portal warns before
            an expiring key lapses.
          </span>
        </div>
      </div>
    </Dialog>
  );
}

function ScopeOption({
  icon,
  title,
  description,
  selected,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`apikey-option${selected ? ' apikey-option--selected' : ''}`}
      onClick={onToggle}
      role="checkbox"
      aria-checked={selected}
    >
      <span className="apikey-option__head">
        {icon && <span className="apikey-option__icon">{icon}</span>}
        <span className="apikey-option__title">{title}</span>
        {selected && <Check size={14} className="apikey-option__check" />}
      </span>
      <span className="apikey-option__desc">{description}</span>
    </button>
  );
}
