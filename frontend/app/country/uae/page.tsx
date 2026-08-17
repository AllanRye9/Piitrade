import type { Metadata } from 'next';
import CountryLandingClient from '../CountryLandingClient';

export const metadata: Metadata = {
  title: 'Piitrade — UAE Marketplace',
  description: 'Browse all listings available in the UAE on Piitrade.',
};

export default function UAEPage() {
  return <CountryLandingClient country="UAE" />;
}
