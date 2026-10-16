import { api } from './api';

/**
 * KYC identity photos are private: the public /api/images/kyc%2F... proxy now refuses
 * them. They are streamed by the authenticated GET /api/upload/kyc-file route (admins,
 * or the owner), which a plain <img src> cannot call because it carries no Bearer token.
 * So fetch the bytes with the shared axios client and hand the browser a blob: URL.
 */
export async function fetchKycImageObjectUrl(storedUrl: string): Promise<string> {
  const res = await api.get('/upload/kyc-file', { params: { url: storedUrl }, responseType: 'blob' });
  return URL.createObjectURL(res.data as Blob);
}
