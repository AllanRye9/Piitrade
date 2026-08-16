import type { Metadata } from 'next';
import CountryLandingClient from '../CountryLandingClient';

export const metadata: Metadata = {
  title: '3R Elite — UAE Marketplace',
  description: 'Browse all listings available in the UAE on 3R Elite.',
};

export default function UAEPage() {
  return <CountryLandingClient country="UAE" />;
}
