import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const convs = [
  { counterpart: { id: 'b1', name: 'Sarah Nakato', avatar: null }, lastMessage: 'Is it still available?', lastMessageAt: new Date().toISOString(), listing: { id: 'l1', title: 'Toyota Premio 2012', images: [] }, unreadCount: 2 },
  { counterpart: { id: 'b2', name: 'John Okello', avatar: null }, lastMessage: 'Thanks!', lastMessageFromMe: true, lastMessageAt: new Date(Date.now() - 86400000 * 2).toISOString(), listing: { id: 'l2', title: 'Samsung A54', images: [] }, unreadCount: 0 },
];
const get = vi.fn(async (url: string) => {
  if (url === '/store-rentals/my') return { data: { rental: { status: 'ACTIVE' } } };
  if (url === '/messages/conversations') return { data: { conversations: convs } };
  if (url.startsWith('/messages/thread/')) return { data: { messages: [{ id: 'm1', content: 'Is it still available?', senderId: 'b1', receiverId: 'me', read: false, createdAt: new Date().toISOString() }] } };
  return { data: {} };
});
vi.mock('@/lib/api', () => ({ api: { get: (...a: any[]) => (get as any)(...a), post: vi.fn(async () => ({ data: { message: { id: 'm2', content: 'Yes', senderId: 'me', receiverId: 'b1', read: false, createdAt: new Date().toISOString() } } })) } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' }, loading: false }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }));
vi.mock('next/image', () => ({ default: (p: any) => <img alt="" {...p} /> }));

import Page from '@/app/dashboard/store-rental/tools/page';
afterEach(cleanup);

describe('Merchant tools → Enquiries', () => {
  it('lists enquiries with unread summary, filters, opens a thread and sends a reply', async () => {
    render(<Page />);
    fireEvent.click(await screen.findByText('Enquiries'));
    expect(await screen.findByText('Sarah Nakato')).toBeTruthy();
    expect(screen.getByText(/1 awaiting your reply · 2 total/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Unread \(1\)/ }));
    expect(screen.queryByText('John Okello')).toBeNull();
    fireEvent.click(screen.getByText('Sarah Nakato'));
    expect(await screen.findByText('About: Toyota Premio 2012')).toBeTruthy();
    fireEvent.click(screen.getByText('Yes, it is still available.'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('Yes')).toBeTruthy());
  });
});
