import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:3000';
const pages = (process.env.PAGES || '/,/listings,/stores,/auth/login,/auth/register,/jobs,/browse/all,/motors,/stores/register,/safety,/terms,/about,/market-prices,/listings/create').split(',');
const widths = (process.env.WIDTHS || '320,390').split(',').map(Number);
const browser = await puppeteer.launch({ args: [...chromium.args.filter(a => !/single-process|no-zygote/.test(a)), '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
const results = [];
for (const W of widths) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: 800, deviceScaleFactor: 1, isMobile: W < 700, hasTouch: W < 700 });
  const errs = [], bad = [];
  page.on('console', m => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|_rsc/.test(m.text())) errs.push(m.text().slice(0, 110)); });
  page.on('pageerror', e => errs.push('PAGEERR ' + String(e).slice(0, 110)));
  page.on('response', r => { const s = r.status(); if (s >= 400 && !/favicon/.test(r.url())) bad.push(`${s} ${r.url().replace(BASE, '').replace('http://127.0.0.1:5000', 'API').slice(0, 70)}`); });
  page.on('requestfailed', r => { if (!/_rsc=|country\.is/.test(r.url())) bad.push('FAILED ' + r.url().slice(0, 70)); });
  for (const p of pages) {
    errs.length = 0; bad.length = 0;
    let status = 0;
    try {
      const resp = await page.goto(BASE + p, { waitUntil: 'networkidle2', timeout: 45000 });
      status = resp ? resp.status() : 0;
      await new Promise(r => setTimeout(r, 700));
      const m = await page.evaluate(() => {
        const vw = window.innerWidth;
        const over = [...document.querySelectorAll('body *')].filter(e => { const cs = getComputedStyle(e); if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return false; const b = e.getBoundingClientRect(); if (b.width === 0 || b.height === 0) return false; if (e.closest('[class*="overflow-x-auto"],[class*="overflow-hidden"],[class*="overflow-auto"],.no-scrollbar,.scrollbar-hide')) return false; return b.right > vw + 1 || (b.left < -1 && b.right > 1); })
          .slice(0, 3).map(e => `${e.tagName}.${(e.className?.toString() || '').slice(0, 45)} r=${Math.round(e.getBoundingClientRect().right)}`);
        const h = document.querySelector('header'); const hb = h ? h.getBoundingClientRect() : null;
        const imgsBroken = [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.src && !i.src.startsWith('data:')).length;
        return { vw, docW: document.documentElement.scrollWidth, over, hdrH: hb ? Math.round(hb.height) : null, imgsBroken, h1: (document.querySelector('h1')?.textContent || '').trim().slice(0, 40) };
      });
      // header stickiness
      await page.evaluate(() => window.scrollTo(0, 600)); await new Promise(r => setTimeout(r, 300));
      const stick = await page.evaluate(() => { const h = document.querySelector('header'); return h ? Math.round(h.getBoundingClientRect().top) : null; });
      const canScroll = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 700);
      const flags = [];
      if (status >= 400) flags.push('HTTP' + status);
      if (m.docW > m.vw) flags.push(`H-SCROLL(${m.docW}>${m.vw})`);
      if (m.over.length) flags.push('OVER:' + m.over.join(' | '));
      if (canScroll && stick !== null && stick < -2) flags.push(`HEADER-NOT-STICKY(top=${stick})`);
      if (m.imgsBroken) flags.push(`broken-imgs=${m.imgsBroken}`);
      if (errs.length) flags.push('ERR:' + [...new Set(errs)].slice(0, 2).join(' ; '));
      if (bad.length) flags.push('NET:' + [...new Set(bad)].slice(0, 3).join(' ; '));
      console.log(`${String(W).padStart(4)} ${p.padEnd(18)} ${status} hdr=${m.hdrH} "${m.h1}" ${flags.length ? '⚠ ' + flags.join('  ') : 'ok'}`);
    } catch (e) { console.log(`${String(W).padStart(4)} ${p.padEnd(18)} ✖ ${String(e).slice(0, 100)}`); }
  }
  await page.close();
}
await browser.close();
