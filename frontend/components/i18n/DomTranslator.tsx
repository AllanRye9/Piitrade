'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useLocale } from 'next-intlayer';
import { lookup } from '@/lib/i18n/ui';

/**
 * Translates visible site text that is NOT wrapped in tr() / <T> — i.e. the rest of the site — by exact match of
 * the English text against the translations (built-in + admin-saved). It only ever replaces a text node or
 * placeholder/title/aria-label/alt whose whole text is a known English string, so names, prices, listing text
 * and anything with no translation are left alone. Nothing happens in English, in /admin, or inside an element
 * marked translate="no" / class="notranslate". Switching language (or leaving it) restores the original text.
 *
 * Disable entirely with NEXT_PUBLIC_DOM_TRANSLATE=false.
 */

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'SVG', 'TITLE']);
const OPT_OUT = '[translate="no"],.notranslate,[contenteditable="true"],[data-no-translate]';

type TextRecord = { original: string; shown: string };

export function DomTranslator() {
  const { locale } = useLocale();
  const pathname = usePathname() ?? '';
  const disabled = process.env.NEXT_PUBLIC_DOM_TRANSLATE === 'false' || locale === 'en' || pathname.startsWith('/admin');

  useEffect(() => {
    if (disabled) return;
    const texts = new Map<Text, TextRecord>();
    const attrs = new Map<Element, Map<string, TextRecord>>();

    const translateValue = (value: string): { out: string } | null => {
      const core = value.replace(/\s+/g, ' ').trim();
      if (core.length < 2 || core.length > 300) return null;
      const t = lookup(locale as string, core);
      if (!t || t === core) return null;
      const lead = /^\s*/.exec(value)?.[0] ?? '';
      const trail = /\s*$/.exec(value)?.[0] ?? '';
      return { out: `${lead}${t}${trail}` };
    };

    const skipped = (el: Element | null): boolean => {
      if (!el) return true;
      if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
      return !!el.closest(OPT_OUT);
    };

    const doText = (node: Text) => {
      const rec = texts.get(node);
      const current = node.nodeValue ?? '';
      if (rec && current === rec.shown) return; // already done
      if (skipped(node.parentElement)) return;
      const r = translateValue(current);
      if (!r) { if (rec) texts.delete(node); return; }
      texts.set(node, { original: current, shown: r.out });
      node.nodeValue = r.out;
    };

    const doAttrs = (el: Element) => {
      if (skipped(el)) return;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const rec = attrs.get(el)?.get(a);
        if (rec && v === rec.shown) continue;
        const r = translateValue(v);
        if (!r) continue;
        let m = attrs.get(el);
        if (!m) attrs.set(el, (m = new Map()));
        m.set(a, { original: v, shown: r.out });
        el.setAttribute(a, r.out);
      }
    };

    const walk = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return; }
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      const el = root as Element;
      if (skipped(el)) return;
      doAttrs(el);
      el.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(doAttrs);
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) doText(n as Text);
    };

    // Batch DOM changes into one pass per frame.
    const pending = new Set<Node>();
    let raf = 0;
    const flush = () => {
      raf = 0;
      const batch = [...pending];
      pending.clear();
      observer.disconnect();
      try { batch.forEach((n) => { if (n.isConnected) walk(n); }); } finally { observe(); }
    };
    const queue = (n: Node) => { pending.add(n); if (!raf) raf = requestAnimationFrame(flush); };

    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'childList') r.addedNodes.forEach(queue);
        else if (r.type === 'characterData') queue(r.target);
        else if (r.type === 'attributes') queue(r.target);
      }
    });
    const observe = () => observer.observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS],
    });

    walk(document.body);
    observe();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      // Put the original English back so React (which never knew about the change) and a language switch both start clean.
      texts.forEach((rec, node) => { if (node.isConnected && node.nodeValue === rec.shown) node.nodeValue = rec.original; });
      attrs.forEach((m, el) => m.forEach((rec, a) => { if (el.isConnected && el.getAttribute(a) === rec.shown) el.setAttribute(a, rec.original); }));
    };
  }, [locale, pathname, disabled]);

  return null;
}
