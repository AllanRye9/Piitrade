import type { Metadata } from 'next';
import CountryLandingClient from '../CountryLandingClient';

export const metadata: Metadata = {
  title: 'Piitrade — Kenya Marketplace',
  description: 'Browse all listings available in Kenya on Piitrade.',
};

export default function KenyaPage() {
  return <CountryLandingClient country="KENYA" />;
}
