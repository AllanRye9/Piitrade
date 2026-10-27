'use client';

import type { CategoryFieldDef } from '@/lib/types';

interface Props {
  /** Heading, e.g. "Electronics / Smartphones". */
  label: string;
  fields: CategoryFieldDef[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}

const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400';

/**
 * The "details" form for the selected kind of ad: Smartphones ask for brand / storage / RAM, shoes for size,
 * pets for breed and vaccination, and so on. The list comes from the server already resolved
 * (admin-defined fields, else the built-in set for that subcategory or its parent). Required first, then the rest.
 */
export default function CategoryFields({ label, fields, values, onChange }: Props) {
  if (fields.length === 0) return null;
  const ordered = [...fields].sort((a, b) => Number(!!b.required) - Number(!!a.required));
  const filled = fields.filter((f) => (values[f.name] ?? '').trim()).length;

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 shadow-sm animate-slide-up" style={{ animationDelay: '75ms' }} aria-labelledby="cat-fields-heading">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p id="cat-fields-heading" className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-700">📋 {label} details</p>
        <span className="text-[11px] font-semibold text-violet-600 tabular-nums">{filled}/{fields.length}</span>
      </div>
      <p className="mb-3 text-xs text-gray-500">Buyers filter and compare by these. Ads with complete details get more replies.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ordered.map((field) => {
          const id = `cf-${field.name}`;
          const value = values[field.name] ?? '';
          return (
            <div key={field.name} className={field.type === 'textarea' ? 'sm:col-span-2' : undefined}>
              <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">
                {field.label}{field.unit ? ` (${field.unit})` : ''}{field.required && <span className="text-red-500"> *</span>}
              </label>
              {field.type === 'select' ? (
                <select id={id} value={value} onChange={(e) => onChange(field.name, e.target.value)} required={field.required} className={inputCls}>
                  <option value="">Select {field.label}</option>
                  {(field.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea id={id} value={value} onChange={(e) => onChange(field.name, e.target.value)} rows={3} placeholder={field.placeholder} className={`${inputCls} resize-none`} />
              ) : (
                <input
                  id={id}
                  type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                  inputMode={field.type === 'number' ? 'decimal' : undefined}
                  value={value}
                  onChange={(e) => onChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  required={field.required}
                  maxLength={field.type === 'text' ? 120 : undefined}
                  className={inputCls}
                />
              )}
              {field.help && <p className="mt-1 text-[11px] text-gray-500">{field.help}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
