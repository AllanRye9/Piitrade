import type { Metadata } from 'next';
import OfferListingsPage from '@/components/listings/OfferListingsPage';

export const metadata: Metadata = {
  title: 'Special Offers — Piitrade',
  description: 'Discounted listings across Uganda, biggest savings first.',
};

export default function SpecialOffersPage() {
  return <OfferListingsPage kind="special-offers" />;
}
