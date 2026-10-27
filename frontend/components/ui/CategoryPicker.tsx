'use client';

import { useState, useRef, useEffect } from 'react';
import { Category } from '@/lib/types';

interface CategoryPickerProps {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

function findSelected(categories: Category[], id: string): string {
  for (const cat of categories) {
    if (cat.id === id) return cat.name;
    if (cat.children) {
      for (const sub of cat.children) {
        if (sub.id === id) return `${cat.name} › ${sub.name}`;
      }
    }
  }
  return '';
}

export default function CategoryPicker({ categories, value, onChange, className = '' }: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeParentId, setActiveParentId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedLabel = value ? findSelected(categories, value) : '';
  const activeParent = categories.find((c) => c.id === activeParentId) ?? categories.find((c) => c.children?.some((sub) => sub.id === value)) ?? null;

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
    setActiveParentId(null);
    setQuery('');
  };

  // Typing searches every category and subcategory at once ("shoes", "solar", "dog").
  const q = query.trim().toLowerCase();
  const hits = q
    ? categories.flatMap((cat) => [
        ...(cat.name.toLowerCase().includes(q) ? [{ id: cat.id, label: cat.name, icon: cat.icon, parent: '' }] : []),
        ...(cat.children ?? [])
          .filter((sub) => sub.name.toLowerCase().includes(q) || cat.name.toLowerCase().includes(q))
          .map((sub) => ({ id: sub.id, label: sub.name, icon: sub.icon ?? cat.icon, parent: cat.name })),
      ]).filter((h, i, a) => a.findIndex((x) => x.id === h.id) === i).slice(0, 40)
    : [];

  const handleToggle = () => {
    setOpen((prev) => {
      const nextOpen = !prev;
      if (nextOpen) {
        const firstParentWithChildren = categories.find((cat) => cat.children?.length)?.id ?? null;
        setActiveParentId((current) => current ?? firstParentWithChildren);
      } else {
        setActiveParentId(null);
      }
      return nextOpen;
    });
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between border border-gray-300 rounded-lg px-4 py-2.5 bg-white text-left focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors hover:border-red-400"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className={selectedLabel ? 'text-gray-900' : 'text-gray-400'}>
          {selectedLabel || 'Select a category'}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute left-0 top-full mt-2 z-[300] flex w-full min-w-[220px] max-w-[min(100vw-2rem,42rem)] flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-xl animate-scale-in md:flex-row">
          <div className="border-b border-gray-100 p-2 md:w-full md:absolute md:left-0 md:right-0 md:top-0 md:z-10 md:bg-white">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search all categories"
              aria-label="Search categories"
              className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm focus:border-red-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-100"
            />
          </div>
          {q ? (
            <ul className="max-h-[20rem] w-full overflow-y-auto py-1 md:mt-[3.25rem]">
              {hits.length === 0 && <li className="px-3 py-6 text-center text-sm text-gray-500">No category matches “{query}”</li>}
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => handleSelect(h.id)} className={`flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-red-50 ${h.id === value ? 'bg-red-100 font-semibold text-red-800' : 'text-gray-800'}`}>
                    {h.icon && <span aria-hidden="true">{h.icon}</span>}
                    <span>{h.label}</span>
                    {h.parent && <span className="ml-auto text-xs text-gray-400">{h.parent}</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (<>
          {/* Parent categories (left column) */}
          <ul className="py-1 md:min-w-[220px] max-h-[18rem] overflow-y-auto md:mt-[3.25rem]">
            {categories.map((cat) => {
              const hasChildren = cat.children && cat.children.length > 0;
              const isParentSelected = cat.id === value;
              const isChildSelected = cat.children?.some((c) => c.id === value);
              return (
                <li
                  key={cat.id}
                  className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ${
                    activeParentId === cat.id || isChildSelected
                      ? 'bg-red-50 text-red-700'
                      : isParentSelected
                      ? 'bg-red-100 text-red-800 font-semibold'
                      : 'text-gray-800 hover:bg-gray-50'
                  }`}
                  onMouseEnter={() => { if (hasChildren) setActiveParentId(cat.id); }}
                  onClick={() => {
                    if (hasChildren) {
                      setActiveParentId(cat.id);
                      return;
                    }
                    handleSelect(cat.id);
                  }}
                >
                  <span className="flex items-center gap-2">
                    {cat.icon && <span aria-hidden="true">{cat.icon}</span>}
                    {cat.name}
                  </span>
                  {hasChildren && (
                    <svg className="w-3.5 h-3.5 opacity-50 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Subcategories (right column) — shown when a parent with children is hovered */}
          {activeParent && activeParent.children && activeParent.children.length > 0 && (
            <ul className="py-1 md:min-w-[220px] max-h-[18rem] overflow-y-auto border-t border-gray-100 bg-gray-50 md:border-l md:border-t-0">
              {/* Option to select the parent category itself */}
              <li
                className={`px-3 py-2 cursor-pointer text-sm transition-colors font-medium ${
                  activeParent.id === value ? 'bg-red-100 text-red-800' : 'text-gray-600 hover:bg-white hover:text-gray-900'
                }`}
                onClick={() => handleSelect(activeParent.id)}
              >
                All in {activeParent.name}
              </li>
              <li className="border-t border-gray-200 my-0.5" />
              {activeParent.children.map((sub) => (
                <li
                  key={sub.id}
                  className={`px-3 py-2 cursor-pointer text-sm transition-colors ${
                    sub.id === value ? 'bg-red-100 text-red-800 font-semibold' : 'text-gray-700 hover:bg-white hover:text-red-700'
                  }`}
                  onClick={() => handleSelect(sub.id)}
                >
                  {sub.icon && <span className="mr-1.5" aria-hidden="true">{sub.icon}</span>}
                  {sub.name}
                </li>
              ))}
            </ul>
          )}
          </>)}
        </div>
      )}
    </div>
  );
}
