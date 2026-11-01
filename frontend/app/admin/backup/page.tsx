'use client';

/**
 * /admin/backup — back up and restore the site: the database, and the uploaded media files.
 * Server side: backend/src/routes/adminBackup.ts (formats: utils/backup/backupService.ts, mediaService.ts).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/utils';

interface Info {
  migration: string | null;
  tables: { name: string; rows: number }[];
  totalRows: number;
  maxUploadMb: number;
}
interface TableReport { name: string; rowsInFile: number; rowsNow: number; inserted: number; skipped: number }
interface Report {
  mode: 'merge' | 'replace';
  dryRun: boolean;
  backupCreatedAt: string | null;
  backupMigration: string | null;
  currentMigration: string | null;
  tables: TableReport[];
  totals: { rowsInFile: number; inserted: number; skipped: number };
  warnings: string[];
}
type Mode = 'merge' | 'replace';

const fmt = (n: number) => n.toLocaleString();

/** Errors from a blob request arrive as a Blob; pull the server's message out of it. */
async function blobError(err: unknown, fallback: string): Promise<string> {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try { const j = JSON.parse(await data.text()); if (j?.message) return String(j.message); } catch { /* fall through */ }
  }
  return getApiErrorMessage(err, fallback);
}

export default function AdminBackupPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [info, setInfo] = useState<Info | null>(null);
  const [infoError, setInfoError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [compress, setCompress] = useState(true);

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>('merge');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState<'check' | 'restore' | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [checkedKey, setCheckedKey] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'ADMIN')) router.replace('/admin/auth/login');
  }, [user, authLoading, router]);

  const loadInfo = useCallback(async () => {
    try {
      const { data } = await api.get<Info>('/admin/backup/info');
      setInfo(data);
      setInfoError('');
    } catch (err) {
      setInfoError(getApiErrorMessage(err, 'Could not load database information'));
    }
  }, []);
  useEffect(() => { if (user?.role === 'ADMIN') loadInfo(); }, [user, loadInfo]);

  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}:${mode}` : '';
  const checked = !!report && report.dryRun && checkedKey === fileKey;
  const needsConfirm = mode === 'replace';
  const canRestore = !!file && checked && !busy && (!needsConfirm || confirmText === 'RESTORE');

  const handleDownload = async () => {
    setDownloading(true);
    setMessage(null);
    try {
      const res = await api.get('/admin/backup/download', { params: { compress: compress ? '1' : '0' }, responseType: 'blob', timeout: 0 });
      const disposition = String(res.headers?.['content-disposition'] ?? '');
      const name = /filename="?([^";]+)"?/.exec(disposition)?.[1]
        ?? `piitrade-backup-${new Date().toISOString().slice(0, 10)}.${compress ? 'ndjson.gz' : 'ndjson'}`;
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMessage({ ok: true, text: `Backup downloaded (${name}). Keep it somewhere safe: it contains private data.` });
    } catch (err) {
      setMessage({ ok: false, text: await blobError(err, 'The backup could not be created') });
    } finally {
      setDownloading(false);
    }
  };

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(dryRun ? 'check' : 'restore');
    setMessage(null);
    try {
      const form = new FormData();
      form.append('mode', mode);
      form.append('dryRun', String(dryRun));
      if (!dryRun && mode === 'replace') form.append('confirm', confirmText);
      form.append('file', file);
      const { data } = await api.post<Report>('/admin/backup/restore', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 0 });
      setReport(data);
      if (dryRun) {
        setCheckedKey(fileKey);
      } else {
        setMessage({ ok: true, text: mode === 'replace' ? 'Restore complete. The site now matches the backup.' : `Merge complete. ${fmt(data.totals.inserted)} missing rows were added.` });
        setFile(null);
        setCheckedKey('');
        setConfirmText('');
        if (fileRef.current) fileRef.current.value = '';
        loadInfo();
      }
    } catch (err) {
      if (dryRun) setReport(null);
      setMessage({ ok: false, text: getApiErrorMessage(err, dryRun ? 'The file could not be checked' : 'The restore failed') });
    } finally {
      setBusy(null);
    }
  };

  if (authLoading || !user || user.role !== 'ADMIN') return null;

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Backup &amp; Restore</h1>
      <p className="mb-6 text-sm text-gray-500">
        Download a copy of the site and upload one to bring it back. A complete recovery needs both parts: the <strong>database</strong> (users, listings, payments, settings…)
        and the <strong>media files</strong> (photos, videos, documents) that the database points to.
      </p>

      {message && (
        <div role="status" className={`mb-5 rounded-lg border px-4 py-3 text-sm ${message.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* ── Download ─────────────────────────────────────────────────────── */}
      <section className="mb-6 rounded-xl bg-white p-4 shadow-sm sm:p-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Database — download a backup</h2>
        <p className="mb-4 text-sm text-gray-500">
          {info
            ? <>Currently <strong>{fmt(info.totalRows)}</strong> rows in <strong>{info.tables.length}</strong> tables.</>
            : infoError || 'Loading database information…'}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <button onClick={handleDownload} disabled={downloading} className="rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50">
            {downloading ? 'Preparing backup…' : 'Download backup'}
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={compress} onChange={(e) => setCompress(e.target.checked)} className="rounded border-gray-300" />
            Compress (recommended)
          </label>
        </div>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-gray-500">
          <li>The backup holds password hashes, KYC records and other private data. Store it as carefully as the database itself.</li>
          <li>It contains database rows only. Photos, videos and documents are backed up separately in the Media files section below.</li>
        </ul>
        {info && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-gray-600">Tables included</summary>
            <div className="mt-2 grid max-h-64 grid-cols-1 gap-x-6 gap-y-1 overflow-y-auto sm:grid-cols-2">
              {info.tables.map((t) => (
                <div key={t.name} className="flex justify-between border-b border-gray-50 py-0.5 text-xs text-gray-600">
                  <span>{t.name}</span><span className="tabular-nums">{fmt(t.rows)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* ── Upload / restore ─────────────────────────────────────────────── */}
      <section className="mb-6 rounded-xl bg-white p-4 shadow-sm sm:p-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Database — upload a backup to restore</h2>
        <p className="mb-4 text-sm text-gray-500">Choose a file, check it, then restore. Nothing changes until you press Restore, and a failed restore changes nothing at all.</p>

        <input
          ref={fileRef}
          type="file"
          accept=".gz,.ndjson,.jsonl,.json,.backup"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); setCheckedKey(''); setConfirmText(''); setMessage(null); }}
          className="mb-1 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
        />
        <p className="mb-4 text-xs text-gray-400">Up to {info?.maxUploadMb ?? 1024} MB. Use a file downloaded from this page (.ndjson.gz or .ndjson).</p>

        <div role="radiogroup" aria-label="Restore mode" className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([
            { value: 'merge', title: 'Merge (safe)', desc: 'Adds anything that is missing. Existing records are never changed or deleted.' },
            { value: 'replace', title: 'Replace everything', desc: 'Deletes all current data and restores the file exactly. Use to recover from a disaster or move to a new database.' },
          ] as const).map((opt) => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => { setMode(opt.value); setConfirmText(''); }}
                className={`rounded-lg border-2 px-3 py-2.5 text-left transition-colors ${active ? (opt.value === 'replace' ? 'border-red-600 bg-red-50' : 'border-green-600 bg-green-50') : 'border-gray-200 bg-white hover:border-gray-300'}`}
              >
                <span className="block text-sm font-semibold text-gray-800">{active ? '● ' : '○ '}{opt.title}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{opt.desc}</span>
              </button>
            );
          })}
        </div>

        <button onClick={() => send(true)} disabled={!file || !!busy} className="rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50">
          {busy === 'check' ? 'Checking…' : 'Check file'}
        </button>

        {report && report.dryRun && (
          <div className="mt-5">
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              Backup made {report.backupCreatedAt ? new Date(report.backupCreatedAt).toLocaleString() : 'at an unknown time'} ·{' '}
              {fmt(report.totals.rowsInFile)} rows in file ·{' '}
              {report.mode === 'replace'
                ? 'every current record will be replaced by the file'
                : 'only records that are not already present will be added'}
            </div>
            {report.warnings.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 py-3 pl-8 pr-4 text-xs text-amber-800">
                {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-gray-100">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-left text-gray-500">
                  <tr><th className="px-3 py-2">Table</th><th className="px-3 py-2 text-right">In file</th><th className="px-3 py-2 text-right">Now</th></tr>
                </thead>
                <tbody>
                  {report.tables.filter((t) => t.rowsInFile || t.rowsNow).map((t) => (
                    <tr key={t.name} className="border-t border-gray-50 text-gray-700">
                      <td className="px-3 py-1.5">{t.name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(t.rowsInFile)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(t.rowsNow)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {checked && (
          <div className="mt-5 border-t border-gray-100 pt-5">
            {mode === 'replace' && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <p className="font-semibold">This permanently deletes all current site data.</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                  <li>Download a fresh database backup first so you can undo this.</li>
                  <li>Users are replaced too. If your admin account is not in this file, you will be signed out and unable to log back in.</li>
                </ul>
                <label className="mt-3 block text-xs font-medium">
                  Type <code className="rounded bg-white px-1 py-0.5">RESTORE</code> to confirm
                  <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" className="mt-1 block w-48 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500" />
                </label>
              </div>
            )}
            <button onClick={() => send(false)} disabled={!canRestore} className={`rounded-lg px-6 py-2 text-sm font-medium text-white transition-colors disabled:opacity-40 ${mode === 'replace' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}>
              {busy === 'restore' ? 'Restoring… do not close this page' : mode === 'replace' ? 'Replace all data' : 'Merge into current data'}
            </button>
          </div>
        )}
      </section>

      <MediaSection />
    </div>
  );
}

// ─── Media files ───────────────────────────────────────────────────────────────

interface MediaInfo {
  s3: { configured: boolean; objects: number; bytes: number };
  local: { files: number; bytes: number };
  maxUploadMb: number;
}
interface MediaJob {
  id: string;
  state: 'running' | 'done' | 'failed';
  dryRun: boolean;
  mode: 'skip-existing' | 'overwrite';
  backupCreatedAt: string | null;
  total: number;
  processed: number;
  written: number;
  skipped: number;
  unavailable: number;
  bytes: number;
  warnings: string[];
  error: string | null;
}
type MediaMode = 'skip-existing' | 'overwrite';

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
};

function MediaSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [infoError, setInfoError] = useState('');
  const [compress, setCompress] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<MediaMode>('skip-existing');
  const [confirmText, setConfirmText] = useState('');
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<MediaJob | null>(null);
  const [checkedKey, setCheckedKey] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const loadInfo = useCallback(async () => {
    try {
      const { data } = await api.get<MediaInfo>('/admin/backup/media/info');
      setInfo(data);
      setInfoError('');
    } catch (err) {
      setInfoError(getApiErrorMessage(err, 'Could not read the file storage'));
    }
  }, []);

  const loadJob = useCallback(async () => {
    try {
      const { data } = await api.get<{ job: MediaJob | null }>('/admin/backup/media/jobs/current');
      setJob(data.job);
      return data.job;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => { loadInfo(); loadJob(); }, [loadInfo, loadJob]);

  // Follow a running job until it finishes.
  const running = job?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const j = await loadJob();
      if (j && j.state !== 'running' && !j.dryRun) loadInfo();
    }, 1500);
    return () => clearInterval(t);
  }, [running, loadJob, loadInfo]);

  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}:${mode}` : '';
  const checked = !!job && job.dryRun && job.state === 'done' && checkedKey === fileKey;
  const canRestore = !!file && checked && !starting && !running && (mode !== 'overwrite' || confirmText === 'RESTORE');

  const handleDownload = async () => {
    setDownloading(true);
    setMessage(null);
    try {
      const res = await api.get('/admin/backup/media/download', { params: { compress: compress ? '1' : '0' }, responseType: 'blob', timeout: 0 });
      const disposition = String(res.headers?.['content-disposition'] ?? '');
      const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? `piitrade-media-${new Date().toISOString().slice(0, 10)}.${compress ? 'tar.gz' : 'tar'}`;
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setMessage({ ok: true, text: `Media backup downloaded (${name}). It includes private documents, so keep it safe.` });
    } catch (err) {
      setMessage({ ok: false, text: await blobError(err, 'The media backup could not be created') });
    } finally {
      setDownloading(false);
    }
  };

  const start = async (dryRun: boolean) => {
    if (!file) return;
    setStarting(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('mode', mode);
      form.append('dryRun', String(dryRun));
      if (!dryRun && mode === 'overwrite') form.append('confirm', confirmText);
      form.append('file', file);
      const { data } = await api.post<MediaJob>('/admin/backup/media/restore', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 0 });
      setJob(data);
      if (dryRun) setCheckedKey(fileKey);
      else { setCheckedKey(''); setConfirmText(''); }
    } catch (err) {
      setMessage({ ok: false, text: getApiErrorMessage(err, dryRun ? 'The file could not be checked' : 'The restore could not be started') });
    } finally {
      setStarting(false);
    }
  };

  const pct = job && job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : job?.state === 'done' ? 100 : 0;

  return (
    <section className="mb-6 rounded-xl bg-white p-4 shadow-sm sm:p-6">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">Media files — backup &amp; restore</h2>
      <p className="mb-4 text-sm text-gray-500">
        {info
          ? <>
              {info.s3.configured
                ? <>Bucket (S3): <strong>{fmt(info.s3.objects)}</strong> files, {fmtBytes(info.s3.bytes)}. </>
                : <>Bucket (S3) is not configured on this server. </>}
              Local uploads folder: <strong>{fmt(info.local.files)}</strong> files, {fmtBytes(info.local.bytes)}.
            </>
          : infoError || 'Reading file storage…'}
      </p>

      {message && (
        <div role="status" className={`mb-4 rounded-lg border px-4 py-3 text-sm ${message.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{message.text}</div>
      )}

      <h3 className="mb-2 text-sm font-semibold text-gray-800">Download</h3>
      <div className="flex flex-wrap items-center gap-4">
        <button onClick={handleDownload} disabled={downloading || running} className="rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50">
          {downloading ? 'Preparing… keep this page open' : 'Download media backup'}
        </button>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={compress} onChange={(e) => setCompress(e.target.checked)} className="rounded border-gray-300" />
          Compress (slower; photos are already compressed)
        </label>
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-gray-500">
        <li>One standard .tar file with every photo, video and document, from the bucket and the local uploads folder.</li>
        <li>It includes private documents such as KYC scans. Store it as carefully as the database backup.</li>
        <li>Large libraries take a while and the file streams through the server: keep the page open. Very big libraries are better backed up with your storage provider’s own tools.</li>
      </ul>

      <h3 className="mb-2 mt-6 border-t border-gray-100 pt-5 text-sm font-semibold text-gray-800">Upload to restore</h3>
      <input
        ref={fileRef}
        type="file"
        accept=".tar,.gz,.tgz"
        onChange={(e) => { setFile(e.target.files?.[0] ?? null); setCheckedKey(''); setConfirmText(''); setMessage(null); }}
        className="mb-1 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
      />
      <p className="mb-4 text-xs text-gray-400">Up to {fmt(info?.maxUploadMb ?? 4096)} MB. Use a file downloaded from this page (.tar or .tar.gz).</p>

      <div role="radiogroup" aria-label="Media restore mode" className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {([
          { value: 'skip-existing', title: 'Fill the gaps (safe)', desc: 'Restores files that are missing. Files that already exist are left exactly as they are.' },
          { value: 'overwrite', title: 'Overwrite existing', desc: 'Also replaces files that have the same name with the backup’s version. Nothing is ever deleted.' },
        ] as const).map((opt) => {
          const active = mode === opt.value;
          return (
            <button
              key={opt.value} type="button" role="radio" aria-checked={active}
              onClick={() => { setMode(opt.value); setConfirmText(''); setCheckedKey(''); }}
              className={`rounded-lg border-2 px-3 py-2.5 text-left transition-colors ${active ? (opt.value === 'overwrite' ? 'border-red-600 bg-red-50' : 'border-green-600 bg-green-50') : 'border-gray-200 bg-white hover:border-gray-300'}`}
            >
              <span className="block text-sm font-semibold text-gray-800">{active ? '● ' : '○ '}{opt.title}</span>
              <span className="mt-0.5 block text-xs text-gray-500">{opt.desc}</span>
            </button>
          );
        })}
      </div>

      <button onClick={() => start(true)} disabled={!file || starting || running} className="rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50">
        {starting && !checked ? 'Uploading…' : 'Check file'}
      </button>

      {job && (
        <div className="mt-5 rounded-lg border border-gray-100 bg-gray-50 p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-800">
              {job.dryRun ? 'Check' : 'Restore'} · {job.state === 'running' ? 'in progress…' : job.state === 'done' ? 'finished' : 'failed'}
            </span>
            <span className="tabular-nums text-xs text-gray-500">{fmt(job.processed)} / {fmt(job.total)} files</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full transition-all ${job.state === 'failed' ? 'bg-red-500' : job.state === 'done' ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-gray-600">
            {job.backupCreatedAt && <>Backup made {new Date(job.backupCreatedAt).toLocaleString()} · </>}
            {job.dryRun ? 'would restore' : 'restored'} <strong>{fmt(job.written)}</strong> files ({fmtBytes(job.bytes)}) ·
            {' '}{fmt(job.skipped)} already present{job.unavailable ? ` · ${fmt(job.unavailable)} not restorable` : ''}
          </p>
          {job.error && <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{job.error}</p>}
          {job.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 rounded border border-amber-200 bg-amber-50 py-2 pl-7 pr-3 text-xs text-amber-800">
              {job.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}
              {job.warnings.length > 10 && <li>…and {job.warnings.length - 10} more</li>}
            </ul>
          )}
          {job.state === 'failed' && !job.dryRun && <p className="mt-2 text-xs text-gray-500">Files restored before the failure were kept. Fix the problem and run the restore again in “Fill the gaps” mode to finish.</p>}
        </div>
      )}

      {checked && (
        <div className="mt-5 border-t border-gray-100 pt-5">
          {mode === 'overwrite' && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-semibold">Files with the same name will be replaced by the backup’s versions.</p>
              <label className="mt-3 block text-xs font-medium">
                Type <code className="rounded bg-white px-1 py-0.5">RESTORE</code> to confirm
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" className="mt-1 block w-48 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500" />
              </label>
            </div>
          )}
          <button onClick={() => start(false)} disabled={!canRestore} className={`rounded-lg px-6 py-2 text-sm font-medium text-white transition-colors disabled:opacity-40 ${mode === 'overwrite' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}>
            {starting ? 'Uploading…' : mode === 'overwrite' ? 'Restore and overwrite' : 'Restore missing files'}
          </button>
        </div>
      )}
    </section>
  );
}
