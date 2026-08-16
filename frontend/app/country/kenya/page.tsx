import type { Metadata } from 'next';
import CountryLandingClient from '../CountryLandingClient';

export const metadata: Metadata = {
  title: '3R Elite — Kenya Marketplace',
  description: 'Browse all listings available in Kenya on 3R Elite.',
};

export default function KenyaPage() {
  return <CountryLandingClient country="KENYA" />;
}
