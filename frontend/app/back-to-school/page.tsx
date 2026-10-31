import type { Metadata } from 'next';
import OfferListingsPage from '@/components/listings/OfferListingsPage';

export const metadata: Metadata = {
  title: 'Back to School — Piitrade',
  description: 'Hand-picked deals for the new school term on Piitrade.',
};

export default function BackToSchoolPage() {
  return <OfferListingsPage kind="back-to-school" />;
}
