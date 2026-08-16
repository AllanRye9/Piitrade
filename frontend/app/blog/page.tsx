import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { resolveImageUrl } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Blog – 3R-Elite Marketplace',
  description: 'Read the latest marketplace insights, product updates, safety guides, and selling tips from 3R-Elite.',
  openGraph: {
    title: 'Blog – 3R-Elite Marketplace',
    description: 'Marketplace insights, safety guides, selling tips and feature announcements.',
  },
};

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  featuredImage: string | null;
  publishedAt: string | null;
  createdAt: string;
  author: { id: string; name: string; avatar: string | null };
}

async function getPosts(): Promise<{ posts: BlogPost[]; total: number }> {
  try {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const res = await fetch(`${apiBase}/api/blog?limit=20`, { next: { revalidate: 60 } });
    if (!res.ok) return { posts: [], total: 0 };
    return res.json();
  } catch {
    return { posts: [], total: 0 };
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function BlogPage() {
  const { posts } = await getPosts();

  return (
    <div>
      {/* Hero */}
      <div className="bg-gradient-to-br from-indigo-700 via-sky-700 to-blue-800 py-10 px-4 text-center">
        <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-2">3R-Elite Blog</h1>
        <p className="text-sky-100 text-sm md:text-base max-w-xl mx-auto">
          Marketplace insights, safety guides, selling tips and feature announcements.
        </p>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {posts.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-5xl mb-4">📝</p>
            <p className="font-semibold text-lg">No posts yet</p>
            <p className="text-sm mt-1">Check back soon for marketplace insights and updates.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/blog/${post.slug}`}
                className="group bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col"
              >
                {/* Featured image */}
                <div className="relative h-44 bg-gradient-to-br from-sky-100 to-indigo-100 overflow-hidden shrink-0">
                  {post.featuredImage ? (
                    <Image
                      src={resolveImageUrl(post.featuredImage)}
                      alt={post.title}
                      fill
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-5xl opacity-30">📰</div>
                  )}
                </div>

                <div className="p-4 flex flex-col flex-1">
                  <h2 className="font-bold text-gray-900 text-sm leading-snug mb-2 group-hover:text-sky-600 transition-colors line-clamp-2">
                    {post.title}
                  </h2>
                  {post.excerpt && (
                    <p className="text-xs text-gray-500 line-clamp-3 mb-3 flex-1">{post.excerpt}</p>
                  )}
                  <div className="flex items-center justify-between text-xs text-gray-400 mt-auto pt-2 border-t border-gray-50">
                    <span className="font-medium text-gray-600">{post.author.name}</span>
                    <span>{formatDate(post.publishedAt || post.createdAt)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}