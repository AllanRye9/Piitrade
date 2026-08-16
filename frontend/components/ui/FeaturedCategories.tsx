import Link from 'next/link';
import Image from 'next/image';
import { resolveImageUrl } from '@/lib/utils';

interface FeaturedCat {
  label: string;
  icon: string;
  color: string;
  href: string;
  desc: string;
  placeholderImage: string;
}

const featuredCats: FeaturedCat[] = [
  {
    label: 'Fine Timepieces',
    icon: '⌚',
    color: 'from-violet-600 to-purple-700',
    href: '/fashion/watches',
    desc: 'Luxury watches & clocks',
    placeholderImage: 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=400&q=75',
  },
  {
    label: 'Designer Apparel',
    icon: '👗',
    color: 'from-rose-500 to-pink-600',
    href: '/fashion',
    desc: 'Premium clothing & style',
    placeholderImage: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=400&q=75',
  },
  {
    label: 'Tech Innovations',
    icon: '💻',
    color: 'from-cyan-500 to-sky-600',
    href: '/electronics',
    desc: 'Cutting-edge technology',
    placeholderImage: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=400&q=75',
  },
  {
    label: 'Bespoke Home',
    icon: '🛋️',
    color: 'from-emerald-500 to-teal-600',
    href: '/furniture',
    desc: 'Curated living spaces',
    placeholderImage: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=75',
  },
  {
    label: 'Luxury Vehicles',
    icon: '🚗',
    color: 'from-orange-500 to-red-600',
    href: '/motors',
    desc: 'Premium automobiles',
    placeholderImage: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&q=75',
  },
  {
    label: 'Fine Jewellery',
    icon: '💎',
    color: 'from-amber-500 to-yellow-600',
    href: '/fine-jewellery',
    desc: 'Exquisite adornments',
    placeholderImage: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=75',
  },
  {
    label: 'Art & Collectibles',
    icon: '🎨',
    color: 'from-indigo-500 to-blue-600',
    href: '/arts-collectibles',
    desc: 'Rare finds & originals',
    placeholderImage: 'https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=400&q=75',
  },
  {
    label: 'Premium Services',
    icon: '🤝',
    color: 'from-fuchsia-500 to-violet-600',
    href: '/premium-services',
    desc: 'Elite-grade assistance',
    placeholderImage: 'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=400&q=75',
  },
];

interface CategoryImageItem {
  id: string;
  cdnUrl: string;
  linkUrl?: string | null;
  sortOrder: number;
}

interface FeaturedCategoriesProps {
  categoryImages?: CategoryImageItem[];
}

export default function FeaturedCategories({ categoryImages = [] }: FeaturedCategoriesProps) {
  // Sort by sortOrder so admin-uploaded images map correctly to categories regardless of upload order
  const sortedImages = [...categoryImages].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <section className="animate-fade-up">
      <div className="flex items-center justify-between mb-3 xs:mb-4">
        <div>
          <h2 className="text-lg xs:text-xl font-extrabold text-elite-navy">Shop by Category</h2>
          <p className="text-xs xs:text-sm text-gray-500 mt-0.5">Curated categories for the discerning buyer</p>
        </div>
        <Link
          href="/browse/all"
          className="text-xs xs:text-sm font-semibold text-elite-gold hover:text-elite-gold-dark flex items-center gap-1 interactive"
        >
          Browse all
          <svg className="w-3.5 h-3.5 xs:w-4 xs:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      <div className="grid grid-cols-2 xs:grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 xs:gap-3 stagger-children">
        {featuredCats.map((cat, index) => {
          const adminImage = sortedImages[index];
          const imageUrl = adminImage ? resolveImageUrl(adminImage.cdnUrl) : null;
          const href = adminImage?.linkUrl || cat.href;

          return (
            <Link
              key={cat.label}
              href={href}
              className="group flex flex-col overflow-hidden rounded-lg xs:rounded-xl hover:shadow-[0_8px_24px_-4px_rgba(14,165,233,0.35)] hover:-translate-y-2 transition-all duration-300 interactive bg-white border border-gray-100 shine-card"
            >
              {/* Image area — no text overlay */}
              <div className={`relative overflow-hidden aspect-[4/3] bg-gradient-to-br ${cat.color} flex-shrink-0`}>
                {imageUrl ? (
                  <Image
                    src={imageUrl}
                    alt={cat.label}
                    fill
                    className="object-cover group-hover:scale-110 transition-transform duration-500"
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 12.5vw"
                    quality={75}
                    loading="lazy"
                  />
                ) : (
                  <Image
                    src={cat.placeholderImage}
                    alt={cat.label}
                    fill
                    className="object-cover group-hover:scale-110 transition-transform duration-500"
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 12.5vw"
                    quality={75}
                    loading="lazy"
                  />
                )}
                {/* Subtle shimmer overlay on hover */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
              </div>

              {/* Text below image — clean, no overlay */}
              <div className="p-2 xs:p-2.5 flex flex-col items-center text-center flex-1">
                <h3 className="font-bold text-gray-900 text-[10px] xs:text-xs leading-tight">{cat.label}</h3>
                <p className="text-[8px] xs:text-[9px] text-gray-500 leading-tight mt-0.5 hidden xs:block">{cat.desc}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
