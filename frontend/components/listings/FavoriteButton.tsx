'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

interface Props {
  listingId: string;
}

export function FavoriteButton({ listingId }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const [favorited, setFavorited] = useState(false);
  const [loading, setLoading] = useState(false);
  // Bumps only when the user *adds* a favourite, to replay the pop + burst once.
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    if (user) {
      api.get(`/listings/${listingId}/favorites`)
        .then(({ data }) => setFavorited(data.favorited))
        .catch(() => {});
    }
  }, [listingId, user]);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) { router.push('/auth/login'); return; }
    // Optimistic: flip immediately, roll back if the request fails.
    const next = !favorited;
    setFavorited(next);
    if (next) setBurst((n) => n + 1);
    setLoading(true);
    try {
      const { data } = await api.post(`/listings/${listingId}/favorite`);
      setFavorited(data.favorited);
    } catch {
      setFavorited(!next);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      aria-pressed={favorited}
      className="relative flex h-8 w-8 items-center justify-center rounded-full bg-white/85 shadow backdrop-blur-sm transition-colors hover:bg-white"
      aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
    >
      {burst > 0 && favorited && (
        <span key={`ring-${burst}`} className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-red-400/40" aria-hidden="true" />
      )}
      <svg
        key={favorited ? `on-${burst}` : 'off'}
        viewBox="0 0 24 24"
        className={`relative h-[18px] w-[18px] transition-colors ${favorited ? 'animate-pop text-red-500' : 'text-gray-500'}`}
        fill={favorited ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    </button>
  );
}
