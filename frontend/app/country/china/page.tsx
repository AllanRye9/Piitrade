import type { Metadata } from 'next';
import CountryLandingClient from '../CountryLandingClient';

export const metadata: Metadata = {
  title: 'Piitrade — China Marketplace',
  description: 'Browse all listings available in China on Piitrade.',
};

export default function ChinaPage() {
  return <CountryLandingClient country="CHINA" />;
}
