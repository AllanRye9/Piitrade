'use client';

/**
 * Shown by the admin settings panels when their current value could not be
 * loaded. The form is deliberately NOT rendered in this state: showing
 * built-in defaults would let the next save overwrite the live configuration
 * with values the admin never chose.
 */
export default function SettingsLoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      <p>Couldn&apos;t load the current {what} settings, so editing is disabled to avoid overwriting them.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
      >
        Retry
      </button>
    </div>
  );
}
