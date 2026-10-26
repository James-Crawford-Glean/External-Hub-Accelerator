// Create or edit an item. Write access is enforced server-side; the dialog
// only renders for callers the client already knows may write.
import { useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { ROLES, type Role } from '../../data/types';
import { createItem, updateItem, type Item, type ItemInput } from '../../lib/api/items';
import { useSaveAction } from '../../lib/saveAction';
import { roleLabel } from '../../lib/labels';

interface Props {
  open: boolean;
  item?: Item | null;
  onClose: () => void;
  onSaved: (item: Item) => void;
}

const blank = (item?: Item | null): ItemInput => ({
  name: item?.name ?? '',
  category: item?.category ?? '',
  description: item?.description ?? '',
  website: item?.website ?? '',
  visibilityRole: item?.visibilityRole ?? null,
});

export function ItemDialog({ open, item, onClose, onSaved }: Props) {
  // Parents key this component on open/item so a fresh open starts from the item.
  const [form, setForm] = useState<ItemInput>(() => blank(item));
  const { saving, run } = useSaveAction();

  const set = <K extends keyof ItemInput>(k: K, v: ItemInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const valid = (form.name ?? '').trim().length > 0;

  function save() {
    const input: ItemInput = {
      name: form.name?.trim(),
      category: form.category?.trim() || null,
      description: form.description?.trim() || null,
      website: form.website?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null,
      visibilityRole: form.visibilityRole ?? null,
    };
    void run({
      action: () => (item ? updateItem(item.id, input) : createItem(input)),
      successMsg: item ? 'Item updated' : 'Item created',
      onDone: onSaved,
    });
  }

  return (
    <Dialog
      open={open}
      title={item ? 'Edit item' : 'New item'}
      onClose={onClose}
      primaryAction={{ label: saving ? 'Saving…' : item ? 'Save' : 'Create', onClick: save, disabled: !valid || saving }}
    >
      <div className="ps-form-grid">
        <Field label="Name" fullWidth>
          <input className="ps-input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Category">
          <input className="ps-input" value={form.category ?? ''} onChange={(e) => set('category', e.target.value)} placeholder="Supplier" />
        </Field>
        <Field label="Website" hint="Domain only; drives the logo.">
          <input className="ps-input" value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} placeholder="example.com" />
        </Field>
        <Field label="Description" fullWidth>
          <textarea className="ps-input" rows={3} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Visibility" hint="Restrict to one role; administrators always see it.">
          <select className="ps-select" value={form.visibilityRole ?? ''} onChange={(e) => set('visibilityRole', (e.target.value || null) as Role | null)}>
            <option value="">Everyone</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)} only
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Dialog>
  );
}
