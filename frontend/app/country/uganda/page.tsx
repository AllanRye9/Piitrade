import type { Metadata } from 'next';
import CountryLandingClient from '../CountryLandingClient';

export const metadata: Metadata = {
  title: 'Piitrade — Uganda Marketplace',
  description: 'Browse all listings available in Uganda on Piitrade.',
};

export default function UgandaPage() {
  return <CountryLandingClient country="UGANDA" />;
}
