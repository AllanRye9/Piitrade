import type { Metadata } from 'next';
import AccountTopBar from '@/components/account/AccountTopBar';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AccountTopBar />
      {children}
    </>
  );
}
