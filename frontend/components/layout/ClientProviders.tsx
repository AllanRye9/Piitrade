'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useCart } from '@/context/CartContext';
import { useToast } from '@/components/ui/Toast';

const CountrySelectModal = dynamic(() => import('@/components/ui/CountrySelectModal'), {
  ssr: false,
});

export default function ClientProviders() {
  const { conversionInfo, clearConversionInfo } = useCart();
  const toast = useToast();

  useEffect(() => {
    if (conversionInfo?.auto) {
      toast.info(`Cart prices converted from ${conversionInfo.from} to ${conversionInfo.to}`);
      clearConversionInfo();
    }
  }, [conversionInfo, toast, clearConversionInfo]);

  return <CountrySelectModal />;
}
