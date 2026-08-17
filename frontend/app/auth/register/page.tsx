'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import AuthColorBlend from '@/components/ui/AuthColorBlend';
import type { Country, Role } from '@/lib/types';

type UserType = { role: Role; label: string; icon: string; description: string };

const USER_TYPES: UserType[] = [
  { role: 'BUYER',        label: 'User',         icon: '👤', description: 'Buy & sell as an individual' },
  { role: 'AGENT',        label: 'Agent',        icon: '🏷️', description: 'Licensed real-estate or trade agent' },
  { role: 'ORGANIZATION', label: 'Organisation', icon: '🏛️', description: 'NGO, charity or community body' },
  { role: 'COMPANY',      label: 'Company',      icon: '🏢', description: 'Registered business entity' },
];

function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams?.get('redirect') || '';
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedRole, setSelectedRole] = useState<Role>('BUYER');
  const [form, setForm] = useState({
    email: '', password: '', name: '', phone: '', country: 'UAE' as Country,
    companyName: '', registrationNumber: '', agentLicense: '', agentType: '', website: '', businessDescription: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isOrgOrCompany = selectedRole === 'ORGANIZATION' || selectedRole === 'COMPANY';
  const isAgent       = selectedRole === 'AGENT';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      await register({
        email: form.email,
        password: form.password,
        name: form.name,
        phone: form.phone || undefined,
        country: form.country,
        role: selectedRole,
        companyName:         isOrgOrCompany && form.companyName ? form.companyName : undefined,
        registrationNumber:  isOrgOrCompany && form.registrationNumber ? form.registrationNumber : undefined,
        agentLicense:        isAgent && form.agentLicense ? form.agentLicense : undefined,
        agentType:           isAgent && form.agentType ? form.agentType : undefined,
        website:             form.website || undefined,
        businessDescription: (isOrgOrCompany || isAgent) && form.businessDescription ? form.businessDescription : undefined,
      });
      router.push(`/auth/login?registered=1&verify_email=1${redirect ? `&redirect=${encodeURIComponent(redirect)}` : ''}`);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string; errors?: Array<{ msg: string }> } } };
      setError(
        axiosErr.response?.data?.errors?.[0]?.msg ||
        axiosErr.response?.data?.message ||
        'Registration failed'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthColorBlend>
      <div className="mx-auto w-full max-w-md animate-fade-up">
        <div className="rounded-3xl border border-white/30 dark:border-white/20 bg-white/95 dark:bg-slate-900/85 shadow-2xl backdrop-blur-xl p-6 sm:p-7">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <Link href="/" className="w-11 h-11 bg-gradient-to-br from-fuchsia-500 via-sky-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-glow hover:scale-105 transition-transform" aria-label="Go to homepage">
              <span className="text-white font-black text-lg">Pi</span>
            </Link>
            <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-200 bg-sky-50 dark:bg-sky-500/20 border border-sky-100 dark:border-sky-300/20 rounded-full px-2.5 py-1">Free account</span>
          </div>

          {step === 1 ? (
            <>
              <h1 className="text-[1.65rem] leading-tight font-extrabold text-slate-950 dark:text-white mb-1">Who are you?</h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 mb-5">Choose the account type that fits you best.</p>

              <div className="grid grid-cols-2 gap-3 mb-6">
                {USER_TYPES.map((ut) => (
                  <button
                    key={ut.role}
                    type="button"
                    onClick={() => setSelectedRole(ut.role)}
                    className={`rounded-2xl border-2 p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-sky-400 ${
                      selectedRole === ut.role
                        ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30 shadow-md scale-[1.03]'
                        : 'border-slate-200 dark:border-slate-700 hover:border-sky-300 dark:hover:border-sky-600'
                    }`}
                  >
                    <div className="text-2xl mb-1">{ut.icon}</div>
                    <div className="font-bold text-sm text-slate-900 dark:text-white">{ut.label}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">{ut.description}</div>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-fuchsia-600 via-sky-600 to-indigo-600 text-white text-sm font-bold shadow-glow hover:brightness-110 transition-all"
              >
                Continue as {USER_TYPES.find(u => u.role === selectedRole)?.label} →
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-4">
                <button type="button" onClick={() => setStep(1)} className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white transition-colors text-sm">
                  ← Back
                </button>
                <h1 className="text-[1.4rem] font-extrabold text-slate-950 dark:text-white">Create your account</h1>
              </div>

              {/* Selected type badge */}
              <div className="flex items-center gap-2 mb-4 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-700 rounded-xl px-3 py-2">
                <span className="text-lg">{USER_TYPES.find(u => u.role === selectedRole)?.icon}</span>
                <span className="text-sm font-semibold text-sky-700 dark:text-sky-300">{USER_TYPES.find(u => u.role === selectedRole)?.label} Account</span>
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3.5 text-sm mb-4 animate-scale-in">
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3.5">
                {/* Full Name */}
                <div>
                  <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1.5">Full Name <span className="text-red-500">*</span></label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="John Doe" className="input-premium" />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1.5">Email <span className="text-red-500">*</span></label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="email" placeholder="you@example.com" className="input-premium" />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1.5">Password <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} autoComplete="new-password" placeholder="At least 6 characters" className="input-premium pr-10" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors" tabIndex={-1}>
                      {showPassword ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      )}
                    </button>
                  </div>
                  {form.password.length > 0 && (
                    <div className="mt-1.5 flex gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${form.password.length >= i * 2 ? form.password.length < 6 ? 'bg-amber-400' : 'bg-emerald-500' : 'bg-gray-200'}`} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Phone + Country */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1.5">Phone <span className="text-slate-500 font-normal">(optional)</span></label>
                    <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+971 50…" className="input-premium" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1.5">Country <span className="text-red-500">*</span></label>
                    <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value as Country })} className="input-premium">
                      <option value="UAE">🇦🇪 UAE</option>
                      <option value="UGANDA">🇺🇬 Uganda</option>
                      <option value="KENYA">🇰🇪 Kenya</option>
                      <option value="CHINA">🇨🇳 China</option>
                    </select>
                  </div>
                </div>

                {/* ── Conditional: Agent fields ── */}
                {isAgent && (
                  <div className="rounded-2xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
                    <p className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Agent Details</p>
                    <div>
                      <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1">Agent License Number</label>
                      <input type="text" value={form.agentLicense} onChange={(e) => setForm({ ...form, agentLicense: e.target.value })} placeholder="e.g. RA-20451" className="input-premium" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1">Agent Type</label>
                      <select value={form.agentType} onChange={(e) => setForm({ ...form, agentType: e.target.value })} className="input-premium">
                        <option value="">Select type…</option>
                        <option value="Real Estate">Real Estate</option>
                        <option value="Insurance">Insurance</option>
                        <option value="Trade">Trade</option>
                        <option value="Finance">Finance</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1">Website <span className="text-slate-500 font-normal">(optional)</span></label>
                      <input type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" className="input-premium" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1">Short Bio / Description <span className="text-slate-500 font-normal">(optional)</span></label>
                      <textarea value={form.businessDescription} onChange={(e) => setForm({ ...form, businessDescription: e.target.value })} rows={2} placeholder="Tell buyers about your services…" className="input-premium resize-none" />
                    </div>
                  </div>
                )}

                {/* ── Conditional: Organisation / Company fields ── */}
                {isOrgOrCompany && (
                  <div className="rounded-2xl border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 p-4 space-y-3">
                    <p className="text-xs font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wide">{selectedRole === 'COMPANY' ? 'Company' : 'Organisation'} Details</p>
                    <div>
                      <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1">{selectedRole === 'COMPANY' ? 'Company' : 'Organisation'} Name <span className="text-red-500">*</span></label>
                      <input type="text" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} required={isOrgOrCompany} placeholder="Acme Corp Ltd." className="input-premium" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1">Registration Number</label>
                      <input type="text" value={form.registrationNumber} onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })} placeholder="e.g. 123456789" className="input-premium" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1">Website <span className="text-slate-500 font-normal">(optional)</span></label>
                      <input type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" className="input-premium" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1">Business Description <span className="text-slate-500 font-normal">(optional)</span></label>
                      <textarea value={form.businessDescription} onChange={(e) => setForm({ ...form, businessDescription: e.target.value })} rows={2} placeholder="What does your business do?" className="input-premium resize-none" />
                    </div>
                  </div>
                )}

                <button type="submit" disabled={loading} className="w-full py-3 rounded-xl bg-gradient-to-r from-fuchsia-600 via-sky-600 to-indigo-600 text-white text-sm font-bold mt-1 shadow-glow hover:brightness-110 transition-all disabled:opacity-60 disabled:cursor-not-allowed">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      Creating account…
                    </span>
                  ) : 'Create Free Account'}
                </button>

                <p className="text-center text-xs text-slate-500 dark:text-slate-300 mt-1">
                  By registering, you agree to our{' '}
                  <Link href="/terms" className="text-sky-600 hover:underline">Terms</Link>{' '}
                  and{' '}
                  <Link href="/privacy" className="text-sky-600 hover:underline">Privacy Policy</Link>
                </p>
              </form>

              <p className="text-center text-sm text-slate-600 dark:text-slate-300 mt-4">
                Already have an account?{' '}
                <Link href={`/auth/login${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} className="text-sky-600 hover:text-sky-700 font-bold transition-colors">Sign in →</Link>
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-center gap-3 mt-4 text-[11px] text-white/95">
          <span className="rounded-full border border-white/30 bg-white/15 px-3 py-1">🆓 Free</span>
          <span className="rounded-full border border-white/30 bg-white/15 px-3 py-1">🔒 Secure</span>
          <span className="rounded-full border border-white/30 bg-white/15 px-3 py-1">🌍 4 Countries</span>
        </div>
      </div>
    </AuthColorBlend>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-full max-w-md animate-pulse">
          <div className="rounded-3xl bg-white/95 p-7 space-y-4">
            <div className="h-11 w-11 shimmer rounded-2xl" />
            <div className="h-8 shimmer rounded-full w-2/3" />
            <div className="h-10 shimmer rounded-xl" />
            <div className="h-10 shimmer rounded-xl" />
            <div className="h-12 shimmer rounded-xl" />
          </div>
        </div>
      </div>
    }>
      <RegisterForm />
    </Suspense>
  );
}

