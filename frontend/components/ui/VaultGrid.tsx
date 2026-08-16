import React, { useState } from 'react';
import Image from 'next/image';

function VaultThumb({ src, name }: { src: string; name: string }) {
  const [imgSrc, setImgSrc] = useState<string | null>(src || null);
  if (!imgSrc) {
    return (
      <div className="w-16 h-16 rounded-lg bg-gray-700 flex items-center justify-center mb-2">
        <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
    );
  }
  return (
    <Image
      src={imgSrc}
      alt={name}
      width={64}
      height={64}
      className="w-16 h-16 rounded-lg object-cover mb-2"
      style={{ aspectRatio: '1/1' }}
      onError={() => setImgSrc(null)}
      unoptimized
    />
  );
}

export const VaultGrid: React.FC<{ downloads: Array<{
  id: string;
  name: string;
  thumb: string;
  size: string;
  date: string;
}> }> = ({ downloads }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 my-6">
    {downloads.map(dl => (
      <div key={dl.id} className="rounded-xl bg-[#181C24] border border-[#23272F] p-3 flex flex-col items-center shadow hover:shadow-lg transition-all">
        <VaultThumb src={dl.thumb} name={dl.name} />
        <div className="font-mono text-xs text-white truncate w-full text-center">{dl.name}</div>
        <div className="text-[10px] text-elite-gold font-bold mt-1">{dl.size}</div>
        <div className="text-[10px] text-gray-400 mt-0.5">{dl.date}</div>
      </div>
    ))}
  </div>
);
