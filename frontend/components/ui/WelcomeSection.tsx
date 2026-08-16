'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const SERVICES = [
  { icon: '🛒', title: 'Buy & Sell Anything', desc: 'From electronics to real estate — list or discover items in minutes.', color: 'bg-sky-50 border-sky-200 text-sky-700' },
  { icon: '🚗', title: 'Motors Marketplace', desc: 'Used cars, new cars, motorcycles, boats, parts and accessories.', color: 'bg-amber-50 border-amber-200 text-amber-700' },
  { icon: '🏠', title: 'Real Estate', desc: 'Find homes, offices, and land for sale or rent across the region.', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  { icon: '💬', title: 'Direct Messaging', desc: 'Chat with sellers instantly. Negotiate, ask questions, arrange viewing.', color: 'bg-violet-50 border-violet-200 text-violet-700' },
  { icon: '✅', title: 'Verified Sellers', desc: 'Every seller is vetted. Listings are reviewed by our moderation team.', color: 'bg-rose-50 border-rose-200 text-rose-700' },
  { icon: '🌍', title: 'Multi-Region', desc: 'Shop and sell across UAE, Uganda, Kenya, and China — all in one place.', color: 'bg-teal-50 border-teal-200 text-teal-700' },
];

const TIPS = [
  { emoji: '🔍', text: 'Use the Search bar or category filters to find exactly what you need.' },
  { emoji: '📸', text: 'Listings with high-quality photos get up to 3× more enquiries.' },
  { emoji: '💬', text: 'Always message the seller before meeting. Use our built-in chat.' },
  { emoji: '🛡️', text: 'Meet in a public place and inspect items before paying.' },
  { emoji: '⭐', text: 'Leave a review after a successful transaction to build trust.' },
  { emoji: '🔔', text: 'Save your favourite listings to track price changes and availability.' },
];

export default function WelcomeSection() {
  const [visible, setVisible] = useState(false);
  const [activeTip, setActiveTip] = useState(0);
  const [titleVisible, setTitleVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          setTimeout(() => setTitleVisible(true), 200);
        }
      },
      { threshold: 0.15 },
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveTip((prev) => (prev + 1) % TIPS.length);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-sky-950 to-slate-900 text-white py-14 sm:py-20 px-4"
    >
      {/* Background decorations */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-violet-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-0 w-64 h-64 bg-amber-500/5 rounded-full blur-2xl" />
        {/* Animated particles */}
        <div className="absolute inset-0">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="absolute w-1 h-1 bg-white/20 rounded-full animate-bounce"
              style={{
                left: `${(i * 8.5) % 100}%`,
                top: `${(i * 13 + 10) % 90}%`,
                animationDelay: `${i * 0.4}s`,
                animationDuration: `${2.5 + (i % 3) * 0.8}s`,
              }}
            />
          ))}
        </div>
      </div>

      <div className="relative max-w-6xl mx-auto">
        {/* Title */}
        <div
          className={`text-center mb-10 sm:mb-14 transition-all duration-1000 ${titleVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        >
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 px-4 py-1.5 rounded-full text-xs font-semibold tracking-widest uppercase text-sky-300 mb-5">
            <span className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-pulse" />
            Welcome to 3R-Elite
          </div>
          <h2 className="text-3xl sm:text-5xl font-black mb-4 leading-tight">
            Your{' '}
            <span className="bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 bg-clip-text text-transparent">
              Premium Marketplace
            </span>
            <br />for Everything
          </h2>
          <p className="text-gray-300 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            3R-Elite connects verified buyers and sellers across <strong className="text-white">UAE, Uganda, Kenya and China</strong>.
            Whether you&apos;re buying, selling, or exploring — we make it safe, simple, and seamless.
          </p>
        </div>

        {/* Services grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
          {SERVICES.map((service, i) => (
            <div
              key={service.title}
              className={`bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/10 hover:border-white/20 hover:-translate-y-1 transition-all duration-300 group ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
              style={{ transitionDelay: `${i * 80 + 300}ms` }}
            >
              <div className="text-3xl mb-3 group-hover:scale-110 transition-transform duration-300 inline-block">{service.icon}</div>
              <h3 className="font-bold text-white text-sm sm:text-base mb-1">{service.title}</h3>
              <p className="text-gray-400 text-xs sm:text-sm leading-relaxed">{service.desc}</p>
            </div>
          ))}
        </div>

        {/* Rotating tips ticker */}
        <div className={`bg-white/5 border border-white/15 rounded-2xl p-5 mb-10 transition-all duration-1000 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`} style={{ transitionDelay: '800ms' }}>
          <h3 className="text-xs font-bold uppercase tracking-widest text-sky-400 mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-pulse" />
            Platform Tips
          </h3>
          <div className="relative overflow-hidden h-8">
            {TIPS.map((tip, i) => (
              <div
                key={i}
                className={`absolute inset-0 flex items-center gap-2.5 text-sm text-gray-200 transition-all duration-700 ${i === activeTip ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
              >
                <span className="text-lg shrink-0">{tip.emoji}</span>
                <span>{tip.text}</span>
              </div>
            ))}
          </div>
          {/* Dot indicators */}
          <div className="flex gap-1.5 mt-3">
            {TIPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveTip(i)}
                className={`h-1 rounded-full transition-all duration-300 ${i === activeTip ? 'w-6 bg-sky-400' : 'w-1.5 bg-white/30'}`}
                aria-label={`Tip ${i + 1}`}
              />
            ))}
          </div>
        </div>

        {/* CTA row */}
        <div
          className={`flex flex-col sm:flex-row items-center justify-center gap-4 transition-all duration-1000 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
          style={{ transitionDelay: '1000ms' }}
        >
          <Link
            href="/listings"
            className="w-full sm:w-auto text-center bg-sky-500 hover:bg-sky-400 text-white font-bold px-8 py-3.5 rounded-xl transition-all shadow-lg hover:shadow-sky-500/30 hover:-translate-y-0.5 text-sm"
          >
            Browse Listings
          </Link>
          <Link
            href="/listings/create"
            className="w-full sm:w-auto text-center bg-amber-400 hover:bg-amber-300 text-black font-bold px-8 py-3.5 rounded-xl transition-all shadow-lg hover:shadow-amber-400/30 hover:-translate-y-0.5 text-sm"
          >
            Post a Free Ad
          </Link>
          <Link
            href="/auth/register"
            className="w-full sm:w-auto text-center bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold px-8 py-3.5 rounded-xl transition-all text-sm"
          >
            Create Account
          </Link>
        </div>
      </div>
    </section>
  );
}
