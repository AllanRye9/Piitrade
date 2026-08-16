import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { VaultGrid } from './VaultGrid';

interface SiteStats {
  activeListings: number;
  totalUsers: number;
  totalListings: number;
  countries: number;
}

const mockDownloads = [
  {
    id: '1',
    name: 'LuxuryCar.mp4',
    thumb: '',
    size: '1.2 GB',
    date: '2026-03-14',
  },
  {
    id: '2',
    name: 'Brochure.pdf',
    thumb: '',
    size: '4.0 MB',
    date: '2026-03-13',
  },
];

export const EliteDemoPanel: React.FC = () => {
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/stats')
      .then((response) => setStats(response.data))
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);

  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M+`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K+`;
    return n.toLocaleString();
  };

  const statCards = [
    {
      value: loading ? '—' : fmt(stats?.activeListings ?? 0),
      label: 'Active Listings',
    },
    {
      value: loading ? '—' : fmt(stats?.totalUsers ?? 0),
      label: 'Registered Members',
    },
    {
      value: loading ? '—' : fmt(stats?.totalListings ?? 0),
      label: 'Total Listings',
    },
    {
      value: loading ? '—' : String(stats?.countries ?? 2),
      label: 'Countries',
    },
  ];

  return (
    <div className="w-full max-w-2xl mx-auto p-4">
      <h2 className="text-2xl font-bold text-elite-navy mb-6 text-center">Elite Traffic Stats</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-xl shadow border border-elite-gold/20 p-6 flex flex-col items-center"
          >
            <span className="text-4xl font-extrabold text-elite-gold mb-1">
              {card.value}
            </span>
            <span className="text-sm text-gray-600 font-medium">{card.label}</span>
          </div>
        ))}
      </div>
      <h3 className="mt-8 mb-2 text-lg font-bold text-elite-gold">Recent Downloads (Vault)</h3>
      <VaultGrid downloads={mockDownloads} />
    </div>
  );
};
