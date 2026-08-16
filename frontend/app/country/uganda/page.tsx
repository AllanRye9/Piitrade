import type { Metadata } from 'next';
import CountryLandingClient from '../CountryLandingClient';

export const metadata: Metadata = {
  title: '3R Elite — Uganda Marketplace',
  description: 'Browse all listings available in Uganda on 3R Elite.',
};

export default function UgandaPage() {
  return <CountryLandingClient country="UGANDA" />;
}
