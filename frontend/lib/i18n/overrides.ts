// Server-side fetch of the admin-saved translations for one language (Admin → Translations).
// No client-only imports: safe in Server Components. Cached by Next for a minute, so it costs one request a
// minute per language, and a failure simply means "no overrides" — the built-in translations still apply.
import { API_URL } from '@/lib/apiUrl';

export async function fetchOverrides(locale: string | undefined): Promise<Record<string, string>> {
  if (!locale || locale === 'en') return {};
  try {
    const res = await fetch(`${API_URL}/api/public/translations?locale=${encodeURIComponent(locale)}`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { strings?: Record<string, string> };
    return data.strings && typeof data.strings === 'object' ? data.strings : {};
  } catch {
    return {};
  }
}
