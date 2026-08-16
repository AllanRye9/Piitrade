import type { Metadata } from 'next';
import CountryLandingClient from '../CountryLandingClient';

export const metadata: Metadata = {
  title: '3R Elite — China Marketplace',
  description: 'Browse all listings available in China on 3R Elite.',
};

export default function ChinaPage() {
  return <CountryLandingClient country="CHINA" />;
}
