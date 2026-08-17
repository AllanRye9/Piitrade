import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { resolveImageUrl } from '@/lib/utils';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://piitrade.com';

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  featuredImage: string | null;
  publishedAt: string | null;
  createdAt: string;
  author: { id: string; name: string; avatar: string | null };
}

async function getPost(slug: string): Promise<BlogPost | null> {
  try {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const res = await fetch(`${apiBase}/api/blog/${slug}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.post || null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) {
    return {
      title: 'Post not found – Piitrade Blog',
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  return {
    title: `${post.title} – Piitrade Blog`,
    description: post.excerpt || post.title,
    alternates: {
      canonical: `${BASE_URL}/blog/${slug}`,
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      title: post.title,
      description: post.excerpt || post.title,
      ...(post.featuredImage ? { images: [{ url: resolveImageUrl(post.featuredImage) }] } : {}),
    },
  };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Back link */}
      <Link href="/blog" className="inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700 mb-6 transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Blog
      </Link>

      {/* Featured image */}
      {post.featuredImage && (
        <div className="relative w-full h-64 sm:h-80 rounded-2xl overflow-hidden mb-6 bg-gray-100">
          <Image
            src={resolveImageUrl(post.featuredImage)}
            alt={post.title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 768px"
            priority
          />
        </div>
      )}

      {/* Title + meta */}
      <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3 leading-tight">{post.title}</h1>
      <div className="flex items-center gap-3 text-sm text-gray-500 mb-6 pb-6 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold shrink-0">
            {post.author.name.charAt(0).toUpperCase()}
          </div>
          <span className="font-medium text-gray-700">{post.author.name}</span>
        </div>
        <span>·</span>
        <span>{formatDate(post.publishedAt || post.createdAt)}</span>
      </div>

      {/* Content (rendered as HTML from rich text editor) */}
      <div
        className="prose prose-sm sm:prose max-w-none text-gray-700 leading-relaxed
          prose-headings:font-bold prose-headings:text-gray-900
          prose-a:text-sky-600 prose-a:no-underline hover:prose-a:underline
          prose-img:rounded-xl prose-img:shadow-sm
          prose-blockquote:border-l-sky-400 prose-blockquote:text-gray-600"
        dangerouslySetInnerHTML={{ __html: post.content }}
      />

      {/* Back to blog */}
      <div className="mt-10 pt-6 border-t border-gray-100">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-50 text-sky-700 font-semibold text-sm hover:bg-sky-100 transition-colors"
        >
          ← More articles
        </Link>
      </div>
    </div>
  );
}
