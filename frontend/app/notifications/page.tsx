'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Notification, NotificationType } from '@/lib/types';
import { T } from '@/components/ui/T';

const TYPE_ICONS: Partial<Record<NotificationType, string>> = {
  ORDER_PLACED: '📦',
  ORDER_CONFIRMED: '✅',
  ORDER_SHIPPED: '🚚',
  ORDER_DELIVERED: '🎉',
  ORDER_CANCELLED: '❌',
  PAYMENT_RECEIVED: '💳',
  PAYMENT_FAILED: '⚠️',
  RETURN_REQUESTED: '↩️',
  RETURN_APPROVED: '✅',
  RETURN_REJECTED: '❌',
  LISTING_APPROVED: '✅',
  LISTING_REJECTED: '❌',
  IMAGE_APPROVED: '🖼️',
  IMAGE_REJECTED: '❌',
  REVIEW_POSTED: '⭐',
  MESSAGE_RECEIVED: '💬',
  SYSTEM: '🔔',
};

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = () => {
    api.get('/notifications?limit=50')
      .then((r) => {
        setNotifications(r.data.notifications ?? []);
        setUnreadCount(r.data.unreadCount ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    fetchNotifications();
  }, [user]);

  const markRead = async (id: string) => {
    await api.put(`/notifications/${id}/read`).catch(() => {});
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    await api.put('/notifications/read-all').catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const deleteNotif = async (id: string) => {
    await api.delete(`/notifications/${id}`).catch(() => {});
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  if (!user) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-gray-500"><T>Please</T> <Link href="/auth/login" className="text-red-600 underline"><T>log in</T></Link> <T>to view notifications.</T></p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Notifications
          {unreadCount > 0 && (
            <span className="ml-2 px-2.5 py-0.5 rounded-full bg-red-500 text-white text-sm font-semibold">{unreadCount}</span>
          )}
        </h1>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-sm text-red-600 hover:text-red-800 font-medium"
          >
            <T>Mark all as read</T>
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-6xl mb-4">🔔</div>
          <p className="text-gray-500 text-lg"><T>No notifications yet</T></p>
          <p className="text-gray-400 text-sm mt-1"><T>We&apos;ll notify you about listings, messages, and account activity.</T></p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif) => (
            <div
              key={notif.id}
              className={`relative flex gap-4 items-start p-4 rounded-2xl border transition-colors ${
                notif.read ? 'bg-white border-gray-100' : 'bg-red-50 border-red-100'
              }`}
            >
              <div className="text-2xl flex-shrink-0 mt-0.5">
                {TYPE_ICONS[notif.type] ?? '🔔'}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${notif.read ? 'text-gray-700' : 'text-gray-900'}`}>
                  {notif.title}
                </p>
                <p className="text-sm text-gray-500 mt-0.5">{notif.message}</p>
                <p className="text-xs text-gray-400 mt-1">{timeAgo(notif.createdAt)}</p>
                {typeof notif.data?.href === 'string' && notif.data.href.startsWith('/') && (
                  <Link href={notif.data.href} onClick={() => { if (!notif.read) markRead(notif.id); }} className="mt-1.5 inline-block text-xs font-semibold text-red-600 hover:text-red-800">
                    <T>View listings</T> →
                  </Link>
                )}
              </div>
              <div className="flex flex-col gap-1 flex-shrink-0">
                {!notif.read && (
                  <button
                    onClick={() => markRead(notif.id)}
                    className="text-xs text-red-600 hover:text-red-800 px-2 py-1 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    <T>Mark read</T>
                  </button>
                )}
                <button
                  onClick={() => deleteNotif(notif.id)}
                  className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <T>Delete</T>
                </button>
              </div>
              {!notif.read && (
                <span className="absolute top-4 right-4 w-2 h-2 rounded-full bg-red-500" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
