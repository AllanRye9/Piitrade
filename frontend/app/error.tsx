'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to the console so the error is visible in browser/server logs;
    // swap in a reporting service call here if one is added later.
    console.error('Unhandled route error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 py-8 text-center">
      <div className="text-5xl mb-4">⚠️</div>
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
        Something went wrong
      </h1>
      <p className="text-gray-500 max-w-md mb-6 text-sm sm:text-base">
        We hit an unexpected error loading this page. Please try again, or head back home if the
        problem continues.
      </p>
      {(error?.message || error?.digest) && (
        <details className="mb-5 max-w-md text-left text-[11px] text-gray-400">
          <summary className="cursor-pointer text-center">Error details (send this to support)</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 text-gray-600">
            {[error.message, error.digest && `digest: ${error.digest}`, typeof window !== 'undefined' && `page: ${window.location.pathname}`].filter(Boolean).join('\n')}
          </pre>
        </details>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={() => reset()}
          className="px-5 py-2.5 bg-premium-navy hover:opacity-90 text-white font-semibold text-sm rounded-xl transition-opacity"
        >
          Try Again
        </button>
        <Link
          href="/"
          className="px-5 py-2 rounded-xl border border-gray-200 text-gray-700 hover:border-red-300 hover:text-red-600 font-medium text-sm transition-colors"
        >
          🏠 Home
        </Link>
      </div>
    </div>
  );
}
