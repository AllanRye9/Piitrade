'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { CategoryFieldDef, ListingStatus } from '@/lib/types';
import { resolveImageUrl } from '@/lib/utils';

interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  parentId: string | null;
  fieldSchema: CategoryFieldDef[] | null;
  _count: { listings: number };
  /** ACTIVE listing count per country, e.g. { UAE: 12, UGANDA: 3, KENYA: 20, CHINA: 0 } */
  countryCounts?: Record<string, number>;
}

// Countries the marketplace operates in.
const ALL_COUNTRIES = ['UGANDA'] as const;
const COUNTRY_LABELS: Record<string, string> = { UGANDA: 'Uganda' };
// Below this many active listings for the selected country, a category is
// flagged as low-inventory.
const LOW_INVENTORY_THRESHOLD = 20;

interface CategoryForm {
  name: string;
  slug: string;
  icon: string;
  parentId: string;
}

const emptyForm: CategoryForm = { name: '', slug: '', icon: '', parentId: '' };

// A listing as shown in the "Fix Listings" move modal — just enough to pick
// it out of a list and confirm it's the right thing to move.
interface MoveListing {
  id: string;
  title: string;
  status: ListingStatus;
  categoryId: string;
  productImages: { cdnUrl: string | null }[];
}

function generateSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Custom field schema builder ──────────────────────────────────────────
// Category.fieldSchema is stored as raw JSON (CategoryFieldDef[]), but
// hand-editing JSON isn't the right approach for admins managing this day
// to day — a stray comma silently breaks the listing form for that whole
// category with no useful feedback. FieldRow is the same shape plus a
// React list key and an editable comma-separated `optionsText`, so the UI
// can be a proper form; JSON is still available as an "advanced" escape
// hatch for bulk edits / copy-pasting a schema between categories.
interface FieldRow {
  _key: string;
  name: string;
  label: string;
  type: CategoryFieldDef['type'];
  required: boolean;
  optionsText: string;
}

function generateFieldName(label: string) {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function newFieldRow(): FieldRow {
  return { _key: Math.random().toString(36).slice(2), name: '', label: '', type: 'text', required: false, optionsText: '' };
}

function schemaToFieldRows(schema: CategoryFieldDef[] | null | undefined): FieldRow[] {
  return (schema ?? []).map((f) => ({
    _key: Math.random().toString(36).slice(2),
    name: f.name,
    label: f.label,
    type: f.type,
    required: !!f.required,
    optionsText: (f.options ?? []).join(', '),
  }));
}

// Best-effort conversion used when switching the builder -> JSON view, so an
// in-progress (possibly incomplete) row set is still visible as JSON rather
// than being silently dropped.
function fieldRowsToDefsLenient(rows: FieldRow[]): CategoryFieldDef[] {
  return rows
    .filter((r) => r.label.trim())
    .map((r) => ({
      name: r.name.trim() || generateFieldName(r.label),
      label: r.label.trim(),
      type: r.type,
      required: r.required,
      ...(r.type === 'select' ? { options: r.optionsText.split(',').map((o) => o.trim()).filter(Boolean) } : {}),
    }));
}

export default function AdminCategoriesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [fetching, setFetching] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<CategoryForm>(emptyForm);
  const [addLoading, setAddLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CategoryForm>(emptyForm);
  const [editLoading, setEditLoading] = useState(false);

  // Field schema editor state — "builder" is the default, structured-form
  // experience; "json" is the advanced raw-JSON fallback (bulk edits,
  // copy-pasting a schema from another category).
  const [schemaEditId, setSchemaEditId] = useState<string | null>(null);
  const [schemaMode, setSchemaMode] = useState<'builder' | 'json'>('builder');
  const [fieldRows, setFieldRows] = useState<FieldRow[]>([]);
  const [schemaJson, setSchemaJson] = useState('');
  const [schemaError, setSchemaError] = useState('');
  const [schemaSaving, setSchemaSaving] = useState(false);

  // Low-inventory flag + populate state
  const [selectedCountry, setSelectedCountry] = useState<typeof ALL_COUNTRIES[number]>('UGANDA');
  const [populatingId, setPopulatingId] = useState<string | null>(null);
  const [populateMessage, setPopulateMessage] = useState('');
  // Inventory view controls: quick filter (all / low / healthy) and sort order,
  // both scoped to the selected country's active listing counts.
  const [inventoryFilter, setInventoryFilter] = useState<'all' | 'low' | 'healthy'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'countAsc' | 'countDesc'>('name');

  // "Fix Listings" move modal — re-categorize some or all of a category's
  // listings into a different category in bulk.
  const [moveCategoryId, setMoveCategoryId] = useState<string | null>(null);
  const [moveListings, setMoveListings] = useState<MoveListing[]>([]);
  const [moveFetching, setMoveFetching] = useState(false);
  const [moveSelectedIds, setMoveSelectedIds] = useState<Set<string>>(new Set());
  const [moveTargetId, setMoveTargetId] = useState('');
  const [moveSaving, setMoveSaving] = useState(false);
  const [moveMessage, setMoveMessage] = useState('');
  const [moveError, setMoveError] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
    if (user?.role === 'ADMIN') {
      fetchCategories();
    }
  }, [user, loading, router]);

  const fetchCategories = () => {
    setFetching(true);
    api.get('/admin/categories')
      .then(({ data }) => setCategories(data))
      .catch(() => {})
      .finally(() => setFetching(false));
  };

  const parentName = (parentId: string | null) => {
    if (!parentId) return '—';
    const parent = categories.find((c) => c.id === parentId);
    return parent ? parent.name : '—';
  };

  // Add form handlers
  const handleAddNameChange = (name: string) => {
    setAddForm((prev) => ({ ...prev, name, slug: generateSlug(name) }));
  };

  const handleAddSubmit = async () => {
    if (!addForm.name.trim() || !addForm.slug.trim()) return;
    setAddLoading(true);
    try {
      const body: Record<string, string> = { name: addForm.name, slug: addForm.slug };
      if (addForm.icon.trim()) body.icon = addForm.icon.trim();
      if (addForm.parentId) body.parentId = addForm.parentId;
      await api.post('/admin/categories', body);
      setAddForm(emptyForm);
      setShowAddForm(false);
      fetchCategories();
    } catch {
      /* silently handled */
    } finally {
      setAddLoading(false);
    }
  };

  // Edit handlers
  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditForm({
      name: cat.name,
      slug: cat.slug,
      icon: cat.icon ?? '',
      parentId: cat.parentId ?? '',
    });
  };

  const handleEditNameChange = (name: string) => {
    setEditForm((prev) => ({ ...prev, name, slug: generateSlug(name) }));
  };

  const handleEditSubmit = async () => {
    if (!editingId || !editForm.name.trim() || !editForm.slug.trim()) return;
    setEditLoading(true);
    try {
      const body: Record<string, string | null> = { name: editForm.name, slug: editForm.slug };
      body.icon = editForm.icon.trim() || null;
      body.parentId = editForm.parentId || null;
      await api.put(`/admin/categories/${editingId}`, body);
      setEditingId(null);
      fetchCategories();
    } catch {
      /* silently handled */
    } finally {
      setEditLoading(false);
    }
  };

  // Populate handler — fills a low-inventory category up to
  // LOW_INVENTORY_THRESHOLD for the selected country using real, currently
  // unplaced ("No placements") listings already assigned to that category.
  const handlePopulate = async (cat: Category) => {
    setPopulatingId(cat.id);
    setPopulateMessage('');
    try {
      const { data } = await api.post(`/admin/categories/${cat.id}/populate`, { country: selectedCountry });
      setPopulateMessage(data.message || `Added ${data.updated} listing(s) to "${cat.name}" for ${COUNTRY_LABELS[selectedCountry]}.`);
      fetchCategories();
    } catch {
      setPopulateMessage(`Failed to populate "${cat.name}". Please try again.`);
    } finally {
      setPopulatingId(null);
    }
  };

  // Delete handler
  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete "${name}"?`)) return;
    try {
      await api.delete(`/admin/categories/${id}`);
      setCategories((prev) => prev.filter((c) => c.id !== id));
    } catch {
      /* silently handled */
    }
  };

  // "Fix Listings" move handlers
  const fetchMoveListings = (categoryId: string) => {
    setMoveFetching(true);
    api.get('/admin/listings', { params: { categoryId, limit: 100 } })
      .then(({ data }) => {
        setMoveListings(
          data.listings.map((l: MoveListing) => ({
            id: l.id,
            title: l.title,
            status: l.status,
            categoryId: l.categoryId,
            productImages: l.productImages ?? [],
          }))
        );
      })
      .catch(() => setMoveError('Failed to load listings for this category.'))
      .finally(() => setMoveFetching(false));
  };

  const openMoveModal = (cat: Category) => {
    setMoveCategoryId(cat.id);
    setMoveSelectedIds(new Set());
    setMoveTargetId('');
    setMoveMessage('');
    setMoveError('');
    fetchMoveListings(cat.id);
  };

  const closeMoveModal = () => {
    setMoveCategoryId(null);
    setMoveListings([]);
    setMoveSelectedIds(new Set());
    setMoveTargetId('');
    setMoveMessage('');
    setMoveError('');
  };

  const toggleMoveSelect = (id: string) => {
    setMoveSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleMoveSelectAll = () => {
    setMoveSelectedIds((prev) =>
      prev.size === moveListings.length ? new Set() : new Set(moveListings.map((l) => l.id))
    );
  };

  // Destination options for the move modal: top-level categories first,
  // each immediately followed by its own children, with the current
  // (source) category excluded so a listing can't be "moved" to itself.
  const moveTargetOptions = (excludeId: string) => {
    const options: { id: string; label: string; group: 'Parent' | 'Child' }[] = [];
    const topLevel = categories.filter((c) => !c.parentId).slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const parent of topLevel) {
      if (parent.id !== excludeId) {
        options.push({ id: parent.id, label: parent.name, group: 'Parent' });
      }
      const children = categories
        .filter((c) => c.parentId === parent.id)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        if (child.id !== excludeId) {
          options.push({ id: child.id, label: `${parent.name} / ${child.name}`, group: 'Child' });
        }
      }
    }
    return options;
  };

  const handleMoveSubmit = async () => {
    if (!moveTargetId || moveSelectedIds.size === 0) return;
    setMoveSaving(true);
    setMoveError('');
    setMoveMessage('');
    try {
      const ids = Array.from(moveSelectedIds);
      const { data } = await api.post('/admin/listings/move-category', { ids, categoryId: moveTargetId });
      setMoveMessage(data.message || `Moved ${ids.length} listing(s).`);
      setMoveListings((prev) => prev.filter((l) => !moveSelectedIds.has(l.id)));
      setMoveSelectedIds(new Set());
      fetchCategories();
    } catch {
      setMoveError('Failed to move the selected listings. Please try again.');
    } finally {
      setMoveSaving(false);
    }
  };

  // Field schema handlers
  const openSchemaEditor = (cat: Category) => {
    setSchemaEditId(cat.id);
    setSchemaMode('builder');
    setFieldRows(schemaToFieldRows(cat.fieldSchema));
    setSchemaJson(cat.fieldSchema ? JSON.stringify(cat.fieldSchema, null, 2) : '[]');
    setSchemaError('');
  };

  const addFieldRow = () => setFieldRows((prev) => [...prev, newFieldRow()]);

  const updateFieldRow = (key: string, patch: Partial<FieldRow>) =>
    setFieldRows((prev) => prev.map((f) => (f._key === key ? { ...f, ...patch } : f)));

  const removeFieldRow = (key: string) =>
    setFieldRows((prev) => prev.filter((f) => f._key !== key));

  const moveFieldRow = (key: string, dir: -1 | 1) =>
    setFieldRows((prev) => {
      const idx = prev.findIndex((f) => f._key === key);
      const swapIdx = idx + dir;
      if (idx === -1 || swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });

  // Switching views converts best-effort in each direction so in-progress
  // work isn't lost, and never silently discards an editor's content.
  const switchToJsonMode = () => {
    setSchemaJson(JSON.stringify(fieldRowsToDefsLenient(fieldRows), null, 2));
    setSchemaError('');
    setSchemaMode('json');
  };

  const switchToBuilderMode = () => {
    try {
      const parsed = JSON.parse(schemaJson);
      if (!Array.isArray(parsed)) throw new Error('Must be a JSON array');
      setFieldRows(schemaToFieldRows(parsed));
      setSchemaError('');
      setSchemaMode('builder');
    } catch (e) {
      setSchemaError(`Fix the JSON before switching back to the builder: ${(e as Error).message || 'invalid JSON'}`);
    }
  };

  const saveFieldSchema = async (fieldSchema: CategoryFieldDef[]) => {
    if (!schemaEditId) return;
    setSchemaSaving(true);
    try {
      await api.put(`/admin/categories/${schemaEditId}`, { fieldSchema });
      setCategories((prev) =>
        prev.map((c) => (c.id === schemaEditId ? { ...c, fieldSchema } : c))
      );
      setSchemaEditId(null);
    } catch {
      setSchemaError('Failed to save. Please try again.');
    } finally {
      setSchemaSaving(false);
    }
  };

  const handleBuilderSave = () => {
    setSchemaError('');
    const seen = new Set<string>();
    const built: CategoryFieldDef[] = [];
    for (const row of fieldRows) {
      const label = row.label.trim();
      if (!label) {
        setSchemaError('Every field needs a label.');
        return;
      }
      const name = row.name.trim() || generateFieldName(label);
      if (!name) {
        setSchemaError(`Could not generate a field key for "${label}" — set one manually.`);
        return;
      }
      if (seen.has(name)) {
        setSchemaError(`Duplicate field key "${name}" — each field needs a unique key.`);
        return;
      }
      seen.add(name);
      if (row.type === 'select') {
        const options = row.optionsText.split(',').map((o) => o.trim()).filter(Boolean);
        if (options.length === 0) {
          setSchemaError(`"${label}" is a dropdown but has no options — add at least one, comma-separated.`);
          return;
        }
        built.push({ name, label, type: 'select', options, required: row.required });
      } else {
        built.push({ name, label, type: row.type, required: row.required });
      }
    }
    saveFieldSchema(built);
  };

  const handleJsonSave = () => {
    setSchemaError('');
    let parsed: CategoryFieldDef[];
    try {
      parsed = JSON.parse(schemaJson);
      if (!Array.isArray(parsed)) throw new Error('Must be a JSON array');
    } catch (e) {
      setSchemaError((e as Error).message || 'Invalid JSON');
      return;
    }
    saveFieldSchema(parsed);
  };


  // Inventory snapshot for the selected country, used for the summary cards
  // and to drive the quick filter / sort below.
  const countFor = (cat: Category) => cat.countryCounts?.[selectedCountry] ?? 0;
  const lowInventoryCount = categories.filter((cat) => countFor(cat) < LOW_INVENTORY_THRESHOLD).length;
  const healthyCount = categories.length - lowInventoryCount;

  const visibleCategories = categories
    .filter((cat) => {
      if (inventoryFilter === 'all') return true;
      const isLow = countFor(cat) < LOW_INVENTORY_THRESHOLD;
      return inventoryFilter === 'low' ? isLow : !isLow;
    })
    .slice()
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      const diff = countFor(a) - countFor(b);
      return sortBy === 'countAsc' ? diff : -diff;
    });

  if (loading || fetching) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="max-w-7xl mx-auto px-4 py-3 sm:py-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Categories</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {inventoryFilter === 'all' ? `${categories.length} total categories` : `${visibleCategories.length} of ${categories.length} categories`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            id="category-country-select"
            aria-label="Country"
            value={selectedCountry}
            onChange={(e) => setSelectedCountry(e.target.value as typeof ALL_COUNTRIES[number])}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {ALL_COUNTRIES.map((c) => (
              <option key={c} value={c}>{COUNTRY_LABELS[c]}</option>
            ))}
          </select>
          <button
            onClick={() => { setShowAddForm(!showAddForm); setAddForm(emptyForm); }}
            className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
          >
            {showAddForm ? '✕ Cancel' : '➕ Add Category'}
          </button>
        </div>
      </div>

      {/* ── Inventory filter for the selected country — counts double as the summary ── */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 text-sm">
          <button
            type="button"
            onClick={() => setInventoryFilter('all')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors ${inventoryFilter === 'all' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            All <span className="text-gray-400 font-normal">{categories.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setInventoryFilter('low')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors ${inventoryFilter === 'low' ? 'bg-amber-100 text-amber-800' : 'text-gray-500 hover:text-gray-700'}`}
          >
            ⚠ Low <span className={inventoryFilter === 'low' ? 'text-amber-600 font-normal' : 'text-gray-400 font-normal'}>{lowInventoryCount}</span>
          </button>
          <button
            type="button"
            onClick={() => setInventoryFilter('healthy')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors ${inventoryFilter === 'healthy' ? 'bg-emerald-100 text-emerald-800' : 'text-gray-500 hover:text-gray-700'}`}
          >
            ✓ Healthy <span className={inventoryFilter === 'healthy' ? 'text-emerald-600 font-normal' : 'text-gray-400 font-normal'}>{healthyCount}</span>
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <label htmlFor="category-sort-select" className="text-gray-500 font-medium">Sort</label>
          <select
            id="category-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="name">Name (A–Z)</option>
            <option value="countAsc">Listings (Low → High)</option>
            <option value="countDesc">Listings (High → Low)</option>
          </select>
        </div>
      </div>

      {populateMessage && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {populateMessage}
        </div>
      )}

      {showAddForm && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">New Category</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={addForm.name}
                onChange={(e) => handleAddNameChange(e.target.value)}
                placeholder="Category name"
                className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Slug</label>
              <input
                type="text"
                value={addForm.slug}
                onChange={(e) => setAddForm((prev) => ({ ...prev, slug: e.target.value }))}
                placeholder="category-slug"
                className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Icon</label>
              <input
                type="text"
                value={addForm.icon}
                onChange={(e) => setAddForm((prev) => ({ ...prev, icon: e.target.value }))}
                placeholder="🏷️"
                className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Parent Category</label>
              <select
                value={addForm.parentId}
                onChange={(e) => setAddForm((prev) => ({ ...prev, parentId: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">None</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <button
              onClick={handleAddSubmit}
              disabled={addLoading || !addForm.name.trim()}
              className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addLoading ? 'Creating...' : 'Create Category'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-3 sm:px-4 py-2 text-xs font-medium text-gray-600">Name</th>
              <th className="text-left px-3 sm:px-4 py-2 text-xs font-medium text-gray-600">Slug</th>
              <th className="text-left px-3 sm:px-4 py-2 text-xs font-medium text-gray-600">Icon</th>
              <th className="text-left px-3 sm:px-4 py-2 text-xs font-medium text-gray-600">Parent</th>
              <th className="text-left px-3 sm:px-4 py-2 text-xs font-medium text-gray-600">Listings ({COUNTRY_LABELS[selectedCountry]})</th>
              <th className="text-left px-3 sm:px-4 py-2 text-xs font-medium text-gray-600">Custom Fields</th>
              <th className="text-left px-3 sm:px-4 py-2 text-xs font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {categories.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">
                  No categories found. Add one to get started.
                </td>
              </tr>
            )}
            {categories.length > 0 && visibleCategories.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">
                  No categories match this filter for {COUNTRY_LABELS[selectedCountry]}.
                </td>
              </tr>
            )}
            {visibleCategories.map((cat) =>
              editingId === cat.id ? (
                <tr key={cat.id} className="bg-red-50">
                  <td className="px-3 sm:px-4 py-2">
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => handleEditNameChange(e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </td>
                  <td className="px-3 sm:px-4 py-2">
                    <input
                      type="text"
                      value={editForm.slug}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, slug: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </td>
                  <td className="px-3 sm:px-4 py-2">
                    <input
                      type="text"
                      value={editForm.icon}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, icon: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </td>
                  <td className="px-3 sm:px-4 py-2">
                    <select
                      value={editForm.parentId}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, parentId: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      <option value="">None</option>
                      {categories.filter((c) => c.id !== cat.id).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 sm:px-4 py-2 text-gray-500">{cat._count.listings}</td>
                  <td className="px-3 sm:px-4 py-2 text-gray-400 text-xs">—</td>
                  <td className="px-3 sm:px-4 py-2">
                    <div className="flex gap-1.5">
                      <button
                        onClick={handleEditSubmit}
                        disabled={editLoading || !editForm.name.trim()}
                        className="text-xs px-2.5 py-1 rounded font-medium bg-green-500 text-white hover:bg-green-600 transition-colors disabled:opacity-50"
                      >
                        {editLoading ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs px-2.5 py-1 rounded font-medium bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={cat.id} className={`hover:bg-gray-50 border-l-4 ${countFor(cat) < LOW_INVENTORY_THRESHOLD ? 'border-l-amber-400' : 'border-l-emerald-400'}`}>
                  <td className="px-3 sm:px-4 py-2 font-medium">{cat.name}</td>
                  <td className="px-3 sm:px-4 py-2 text-gray-500">{cat.slug}</td>
                  <td className="px-3 sm:px-4 py-2">{cat.icon ?? '—'}</td>
                  <td className="px-3 sm:px-4 py-2 text-gray-500">{parentName(cat.parentId)}</td>
                  <td className="px-3 sm:px-4 py-2 min-w-[140px]">
                    {(() => {
                      const countryCount = countFor(cat);
                      const isLow = countryCount < LOW_INVENTORY_THRESHOLD;
                      const barPct = Math.min(100, Math.round((countryCount / LOW_INVENTORY_THRESHOLD) * 100));
                      return (
                        <div className="flex items-center gap-2">
                          <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${isLow ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                            {countryCount}/{LOW_INVENTORY_THRESHOLD}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden" title={isLow ? 'Low inventory' : 'Well stocked'}>
                            <div
                              className={`h-full rounded-full ${isLow ? 'bg-amber-400' : 'bg-emerald-400'}`}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-3 sm:px-4 py-2">
                    {cat.fieldSchema && cat.fieldSchema.length > 0 ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-violet-100 text-violet-700">
                        {cat.fieldSchema.length} field{cat.fieldSchema.length !== 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">None</span>
                    )}
                  </td>
                  <td className="px-3 sm:px-4 py-2">
                    <div className="flex gap-1.5 flex-wrap">
                      <button
                        onClick={() => startEdit(cat)}
                        className="text-xs px-2.5 py-1 rounded font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => openSchemaEditor(cat)}
                        className="text-xs px-2.5 py-1 rounded font-medium bg-violet-500 text-white hover:bg-violet-600 transition-colors"
                      >
                        Fields
                      </button>
                      {countFor(cat) < LOW_INVENTORY_THRESHOLD && (
                        <button
                          onClick={() => handlePopulate(cat)}
                          disabled={populatingId === cat.id}
                          title={`Populate with unplaced listings already assigned to this category in ${COUNTRY_LABELS[selectedCountry]}`}
                          className="text-xs px-2.5 py-1 rounded font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
                        >
                          {populatingId === cat.id ? 'Populating...' : 'Populate'}
                        </button>
                      )}
                      <button
                        onClick={() => openMoveModal(cat)}
                        disabled={countFor(cat) === 0}
                        title={countFor(cat) === 0 ? 'No listings in this category yet' : 'Move some or all of this category\'s listings to a different category'}
                        className="text-xs px-2.5 py-1 rounded font-medium bg-sky-500 text-white hover:bg-sky-600 transition-colors disabled:opacity-50"
                      >
                        Fix Listings
                      </button>
                      <button
                        onClick={() => handleDelete(cat.id, cat.name)}
                        className="text-xs px-2.5 py-1 rounded font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Field Schema Editor Modal */}
      {schemaEditId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-5 max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between gap-3 mb-1">
              <h2 className="text-lg font-bold text-gray-900">Custom Fields</h2>
              <button
                type="button"
                onClick={schemaMode === 'builder' ? switchToJsonMode : switchToBuilderMode}
                className="shrink-0 text-xs font-semibold text-violet-600 hover:text-violet-800 underline underline-offset-2"
              >
                {schemaMode === 'builder' ? 'Edit as JSON' : '← Back to field builder'}
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              These extra fields appear on the listing form whenever a seller picks this category
              — e.g. &ldquo;Engine Capacity&rdquo; for cars, &ldquo;Bedrooms&rdquo; for property.
            </p>

            {schemaMode === 'builder' ? (
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {fieldRows.length === 0 && (
                  <p className="text-sm text-gray-400 italic text-center py-6 border border-dashed border-gray-200 rounded-lg">
                    No custom fields yet for this category.
                  </p>
                )}
                {fieldRows.map((row, idx) => (
                  <div key={row._key} className="border border-gray-200 rounded-lg p-3 bg-gray-50/60">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                      <div className="sm:col-span-5">
                        <label className="block text-[11px] font-medium text-gray-500 mb-1">Field label</label>
                        <input
                          type="text"
                          value={row.label}
                          onChange={(e) => {
                            const label = e.target.value;
                            // Auto-derive the internal key from the label until the
                            // admin has typed a key of their own — once they have,
                            // further label edits won't clobber their choice.
                            updateFieldRow(row._key, { label, ...(row.name ? {} : { name: generateFieldName(label) }) });
                          }}
                          placeholder="e.g. Engine Capacity"
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-medium text-gray-500 mb-1">Type</label>
                        <select
                          value={row.type}
                          onChange={(e) => updateFieldRow(row._key, { type: e.target.value as FieldRow['type'] })}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                        >
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="select">Dropdown</option>
                          <option value="textarea">Long Text</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="flex items-center gap-1.5 text-xs text-gray-600 font-medium pb-1.5">
                          <input
                            type="checkbox"
                            checked={row.required}
                            onChange={(e) => updateFieldRow(row._key, { required: e.target.checked })}
                            className="rounded border-gray-300 text-violet-600 focus:ring-violet-400"
                          />
                          Required
                        </label>
                      </div>
                      <div className="sm:col-span-2 flex items-center justify-end gap-1 pb-1">
                        <button
                          type="button"
                          onClick={() => moveFieldRow(row._key, -1)}
                          disabled={idx === 0}
                          title="Move up"
                          className="text-gray-400 hover:text-gray-700 disabled:opacity-30 text-sm px-1.5 py-0.5"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveFieldRow(row._key, 1)}
                          disabled={idx === fieldRows.length - 1}
                          title="Move down"
                          className="text-gray-400 hover:text-gray-700 disabled:opacity-30 text-sm px-1.5 py-0.5"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFieldRow(row._key)}
                          title="Remove field"
                          className="text-red-400 hover:text-red-600 text-sm px-1.5 py-0.5"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 mt-2">
                      <div className="sm:col-span-5">
                        <label className="block text-[11px] font-medium text-gray-500 mb-1">
                          Field key <span className="font-normal text-gray-400">(auto-generated)</span>
                        </label>
                        <input
                          type="text"
                          value={row.name}
                          onChange={(e) => updateFieldRow(row._key, { name: e.target.value })}
                          placeholder="auto_generated_key"
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs font-mono text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-400"
                        />
                      </div>
                      {row.type === 'select' && (
                        <div className="sm:col-span-7">
                          <label className="block text-[11px] font-medium text-gray-500 mb-1">
                            Dropdown options <span className="font-normal text-gray-400">(comma-separated)</span>
                          </label>
                          <input
                            type="text"
                            value={row.optionsText}
                            onChange={(e) => updateFieldRow(row._key, { optionsText: e.target.value })}
                            placeholder="e.g. Petrol, Diesel, Electric, Hybrid"
                            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addFieldRow}
                  className="w-full py-2 rounded-lg border border-dashed border-violet-300 text-violet-600 text-sm font-semibold hover:bg-violet-50 transition-colors"
                >
                  + Add Field
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-2">
                  Advanced: each entry needs <code className="bg-gray-100 px-1 rounded">name</code>,{' '}
                  <code className="bg-gray-100 px-1 rounded">label</code>, and{' '}
                  <code className="bg-gray-100 px-1 rounded">type</code> (text | number | select | textarea).
                  Dropdown (<code className="bg-gray-100 px-1 rounded">select</code>) fields also need an{' '}
                  <code className="bg-gray-100 px-1 rounded">options</code> array.
                </p>
                <textarea
                  value={schemaJson}
                  onChange={(e) => { setSchemaJson(e.target.value); setSchemaError(''); }}
                  rows={16}
                  spellCheck={false}
                  className="flex-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
                />
              </>
            )}

            {schemaError && (
              <p className="mt-2 text-xs text-red-600 font-medium">{schemaError}</p>
            )}
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setSchemaEditId(null)}
                className="flex-1 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={schemaMode === 'builder' ? handleBuilderSave : handleJsonSave}
                disabled={schemaSaving}
                className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {schemaSaving ? 'Saving…' : 'Save Custom Fields'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fix Listings — bulk move-category modal */}
      {moveCategoryId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-5 max-h-[90vh] flex flex-col">
            <h2 className="text-lg font-bold text-gray-900">Fix Listings</h2>
            <p className="text-sm text-gray-500 mt-1 mb-4">
              Move some or all of the listings currently in &ldquo;{categories.find((c) => c.id === moveCategoryId)?.name}&rdquo;
              to a different category. Only the category link changes — images, title, price, and status all stay
              exactly the same. Any featured placement (Premium Collections, Featured Deal, Flash Deal) on a moved
              listing is cleared, since a featured slot from the old category shouldn&apos;t carry over.
            </p>

            {moveFetching ? (
              <div className="py-8 text-center text-sm text-gray-400">Loading listings…</div>
            ) : moveListings.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">No listings found in this category.</div>
            ) : (
              <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg">
                <label className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-600 sticky top-0">
                  <input
                    type="checkbox"
                    checked={moveSelectedIds.size === moveListings.length}
                    onChange={toggleMoveSelectAll}
                    className="rounded border-gray-300 text-sky-600 focus:ring-sky-400"
                  />
                  Select all ({moveListings.length})
                </label>
                {moveListings.map((listing) => {
                  const thumb = listing.productImages.find((pi) => pi.cdnUrl)?.cdnUrl ?? null;
                  return (
                    <label
                      key={listing.id}
                      className="flex items-center gap-3 px-3 py-2 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={moveSelectedIds.has(listing.id)}
                        onChange={() => toggleMoveSelect(listing.id)}
                        className="rounded border-gray-300 text-sky-600 focus:ring-sky-400"
                      />
                      <div className="w-10 h-10 rounded bg-gray-100 overflow-hidden shrink-0 relative">
                        {thumb && (
                          <Image src={resolveImageUrl(thumb)} alt={listing.title} fill sizes="40px" className="object-cover" />
                        )}
                      </div>
                      <span className="flex-1 text-sm text-gray-800 truncate">{listing.title}</span>
                      <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                        {listing.status}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="mt-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">Move to category</label>
              <select
                value={moveTargetId}
                onChange={(e) => setMoveTargetId(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                <option value="">Select a category…</option>
                {moveTargetOptions(moveCategoryId).map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.group === 'Child' ? `↳ ${opt.label}` : opt.label}
                  </option>
                ))}
              </select>
            </div>

            {moveMessage && <p className="mt-2 text-xs text-emerald-600 font-medium">{moveMessage}</p>}
            {moveError && <p className="mt-2 text-xs text-red-600 font-medium">{moveError}</p>}

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={closeMoveModal}
                className="flex-1 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleMoveSubmit}
                disabled={moveSaving || !moveTargetId || moveSelectedIds.size === 0}
                className="flex-1 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {moveSaving ? 'Moving…' : `Move ${moveSelectedIds.size} Listing${moveSelectedIds.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
