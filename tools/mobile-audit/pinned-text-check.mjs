import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:3000';
const pages = (process.env.PAGES || '/,/listings,/stores,/auth/login,/auth/register,/jobs,/browse/all,/motors,/stores/register,/safety,/about,/market-prices,/listings/create').split(',');
const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const seen = new Map();
for (const p of pages) {
  await page.goto(BASE + p, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 600));
  const hits = await page.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll('a, button, [role="button"]')) {
      const cs = getComputedStyle(e); const b = e.getBoundingClientRect();
      if (b.width < 4 || b.height < 4 || cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (/flex|grid|table/.test(cs.display)) continue;           // centred by their own layout
      if (cs.display === 'inline') continue;                        // min-height does not apply
      // visible text extent
      const range = document.createRange(); range.selectNodeContents(e); const r = range.getBoundingClientRect();
      if (!(e.textContent || '').trim() || r.height === 0) continue;
      const topGap = r.top - b.top, bottomGap = b.bottom - r.bottom;
      if (bottomGap - topGap > 8) out.push({ text: e.textContent.trim().slice(0, 24), h: Math.round(b.height), topGap: Math.round(topGap), bottomGap: Math.round(bottomGap), cls: (e.className?.toString() || '').slice(0, 60), inNav: !!e.closest('nav'), inHeader: !!e.closest('header') });
    }
    return out;
  });
  for (const h of hits) { const k = h.cls + '|' + h.text; if (!seen.has(k)) seen.set(k, { ...h, pages: [p] }); else seen.get(k).pages.push(p); }
}
console.log('DISTINCT PINNED-TEXT LINKS/BUTTONS:', seen.size);
for (const v of seen.values()) console.log(`${v.inHeader ? '[header]' : v.inNav ? '[nav]' : '[page]'} "${v.text}" h=${v.h} gap(top=${v.topGap},bottom=${v.bottomGap}) ${v.cls}  on ${v.pages.length} page(s)`);
await browser.close();
