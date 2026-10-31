import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { logger } from './logger';

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    logger.warn('SMTP not configured – emails will be logged only');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    // Port 465 uses implicit TLS (SSL), while other ports (e.g. 587) use
    // STARTTLS — an upgrade from plain to encrypted mid-connection.
    secure: port === 465,
    auth: { user, pass },
  });
}

const FROM_NAME = 'Piitrade Marketplace';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM || 'support@piitrade.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://piitrade.com';
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

async function send(to: string, subject: string, rawHtml: string, attachments?: EmailAttachment[]): Promise<void> {
  // Templates carry a placeholder where the Site Logo goes; it is resolved here, once, for every email.
  const html = await resolveEmailLogo(rawHtml);
  if (resend) {
    try {
      await resend.emails.send({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to,
        subject,
        html,
        ...(attachments?.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content })) } : {}),
      });
      logger.info(`Email sent to ${to} via Resend: ${subject}`);
      return;
    } catch (err) {
      logger.error(`Resend delivery failed for ${to}: ${String(err)}`);
    }
  }

  const transport = createTransport();
  if (!transport) {
    const msg = `Email delivery not configured for ${to}. Set RESEND or SMTP environment variables.`;
    logger.error(msg);
    throw new Error(msg);
  }

  try {
    await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      html,
      ...(attachments?.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType ?? 'application/octet-stream' })) } : {}),
    });
    logger.info(`Email sent to ${to}: ${subject}`);
  } catch (err) {
    logger.error(`Failed to send email to ${to}: ${String(err)}`);
    throw err;
  }
}
// ─────────────────────────────────────────────────────────────────────────
// Piitrade Email Design System
// ─────────────────────────────────────────────────────────────────────────
// One shared header / footer / button / card system so every transactional
// email (verification, welcome, password reset, moderation, listing,
// subscription, receipts, alerts...) carries the same Piitrade identity.
//
// Logo rule (matches the website): the email header shows the SAME image the
// admin uploads under Admin → Site Media → "Site Logo" (section `brand-logo`).
// It never uses the "Promo Header Banner" (section `sticky-header`), which is
// a website-only strip. If no logo is uploaded, or the file isn't safe for
// email clients, a text/CSS "P" + "Piitrade" lockup is shown instead, so the
// header is never empty and never a broken image.
//
// Layout notes:
//  - Nested <table>s only (no flex/grid): the model every email client,
//    including Outlook's Word engine, renders reliably.
//  - The logo sits on a WHITE header band, so any uploaded logo (light or
//    dark artwork) stays legible. A slim orange bar above it carries the brand colour.
//  - Brand orange is the site's own (#FF6500 → #F55906 → #E94B00). Card tints
//    still vary (green = success, amber = warning, red = rejection) so a
//    callout's meaning is obvious at a glance.

const BRAND = {
  orange: '#FF6500',
  orangeMid: '#F55906',
  orangeDark: '#E94B00',
  cream: '#FFF4EC',
  creamBorder: '#FFE4D1',
  ink: '#1c1917',
  body: '#44403c',
  muted: '#78716c',
  faint: '#a8a29e',
} as const;

const FONT = "Inter,Helvetica Neue,Arial,sans-serif";
const SUPPORT_EMAIL = 'support@piitrade.com';

/** Escape anything user-controlled (names, listing titles, reasons) before it goes into HTML. */
function esc(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Site Logo for emails ───────────────────────────────────────────────

const LOGO_PLACEHOLDER = '<!--PIITRADE_SITE_LOGO-->';
/** Formats every mainstream mail client can show. (SVG/AVIF are not, so they fall back to the text lockup.) */
const EMAIL_SAFE_LOGO = /\.(png|jpe?g|gif|webp)(\?|#|$)/i;
const LOGO_TTL_MS = 5 * 60 * 1000;
const LOGO_MISS_TTL_MS = 60 * 1000;

let logoCache: { url: string | null; alt: string; at: number } | null = null;

/** Call after the admin uploads / replaces / removes the Site Logo so the next email picks it up immediately. */
export function invalidateEmailLogoCache(): void {
  logoCache = null;
}

/** Turns a stored image URL (logo, listing photo) into an absolute one a mail client can load (storage paths are served through the site's own domain). */
function absoluteAssetUrl(stored: string): string | null {
  const base = FRONTEND_URL.replace(/\/+$/, '');
  const isBackendPath = (p: string) => /^\/(api|uploads|media)\//.test(p);
  try {
    const u = new URL(stored);
    const staleHost = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || /railway\.app|render\.com|vercel\.app/.test(u.hostname);
    if (isBackendPath(u.pathname) && staleHost) return `${base}${u.pathname}${u.search}`;
    return u.protocol === 'https:' || u.protocol === 'http:' ? stored : null;
  } catch {
    const path = stored.startsWith('/') ? stored : `/${stored}`;
    return `${base}${path}`;
  }
}

async function getEmailLogo(): Promise<{ url: string | null; alt: string }> {
  const now = Date.now();
  if (logoCache && now - logoCache.at < (logoCache.url ? LOGO_TTL_MS : LOGO_MISS_TTL_MS)) {
    return { url: logoCache.url, alt: logoCache.alt };
  }
  let url: string | null = null;
  let alt = 'Piitrade';
  try {
    const { prisma } = await import('./prisma');
    const row = await Promise.race([
      prisma.siteMedia.findFirst({
        where: { section: 'brand-logo', isActive: true },
        orderBy: [{ createdAt: 'desc' }, { sortOrder: 'desc' }],
        select: { cdnUrl: true, altText: true },
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    if (row?.cdnUrl && EMAIL_SAFE_LOGO.test(row.cdnUrl)) {
      url = absoluteAssetUrl(row.cdnUrl);
      if (row.altText?.trim()) alt = row.altText.trim();
    }
  } catch (err) {
    logger.warn(`Email logo lookup failed, using text lockup: ${String(err)}`);
  }
  logoCache = { url, alt, at: now };
  return { url, alt };
}

/** Text/CSS lockup used when there is no usable Site Logo. No <img>, so nothing can break. */
function emailLogoFallback(): string {
  return `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr>
      <td style="width:44px;height:44px;background:${BRAND.orange};border-radius:12px;text-align:center;vertical-align:middle;">
        <span style="font-family:Georgia,'Playfair Display',serif;font-weight:900;font-size:24px;color:#ffffff;line-height:44px;">P</span>
      </td>
      <td style="padding-left:12px;vertical-align:middle;">
        <span style="font-family:${FONT};font-size:24px;font-weight:800;color:${BRAND.ink};letter-spacing:-0.5px;">Pii<span style="color:${BRAND.orangeDark};">trade</span></span>
      </td>
    </tr></table>`;
}

/** Swaps the placeholder in a finished email for the Site Logo image (or the fallback lockup). */
async function resolveEmailLogo(html: string): Promise<string> {
  if (!html.includes(LOGO_PLACEHOLDER)) return html;
  const { url, alt } = await getEmailLogo();
  const markup = url
    ? `<a href="${FRONTEND_URL}" style="text-decoration:none;"><img src="${esc(url)}" alt="${esc(alt)}" height="44" style="display:block;height:44px;width:auto;max-width:220px;border:0;outline:none;font-family:${FONT};font-size:20px;font-weight:800;color:${BRAND.ink};" /></a>`
    : emailLogoFallback();
  return html.split(LOGO_PLACEHOLDER).join(markup);
}

// ── Building blocks ────────────────────────────────────────────────────

/** Branded CTA button, table-based so it stays a clickable coloured block even where anchor padding is ignored. */
function emailButton(label: string, url: string): string {
  return `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:8px 0 28px;"><tr>
      <td style="background:${BRAND.orange};border-radius:12px;">
        <a href="${url}" style="display:inline-block;padding:15px 34px;font-family:${FONT};font-weight:700;font-size:15px;color:#ffffff;text-decoration:none;letter-spacing:0.01em;">${label}</a>
      </td>
    </tr></table>`;
}

/** Page title inside the email body. */
function emailTitle(text: string, tone: 'brand' | 'success' | 'warning' | 'danger' = 'brand'): string {
  const colour = { brand: BRAND.ink, success: '#15803d', warning: '#92400e', danger: '#b91c1c' }[tone];
  return `<h1 style="font-family:${FONT};font-size:27px;line-height:1.25;font-weight:800;color:${colour};margin:0 0 16px;letter-spacing:-0.3px;">${text}</h1>`;
}

/** Standard paragraph. */
function emailP(html: string, opts: { muted?: boolean; mb?: number } = {}): string {
  return `<p style="font-family:${FONT};font-size:${opts.muted ? 13 : 15}px;color:${opts.muted ? BRAND.muted : BRAND.body};line-height:1.7;margin:0 0 ${opts.mb ?? 16}px;">${html}</p>`;
}

/** "Hi Ann," */
function emailGreeting(name: string): string {
  return emailP(`Hi ${esc(name || 'there')},`, { mb: 12 });
}

/** Closing line used at the bottom of action emails. */
function emailHelpLine(prefix = 'Questions? We are happy to help:'): string {
  return emailP(`${prefix} <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND.orangeDark};font-weight:600;text-decoration:none;">${SUPPORT_EMAIL}</a>`, { muted: true, mb: 0 });
}

/** Rounded, tinted content card for status blocks, warnings, reasons and highlighted details. */
function emailCard(opts: { eyebrow?: string; body: string; tint?: 'orange' | 'green' | 'amber' | 'red' | 'neutral' }): string {
  const tints: Record<string, { bg: string; border: string; text: string; bar: string }> = {
    orange: { bg: BRAND.cream, border: '#FFC7A3', text: BRAND.orangeDark, bar: BRAND.orange },
    green: { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d', bar: '#22c55e' },
    amber: { bg: '#fff7ed', border: '#fed7aa', text: '#92400e', bar: '#f59e0b' },
    red: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c', bar: '#ef4444' },
    neutral: { bg: '#f8fafc', border: '#e2e8f0', text: '#334155', bar: '#94a3b8' },
  };
  const t = tints[opts.tint || 'orange'];
  return `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="background:${t.bg};border:1px solid ${t.border};border-left:4px solid ${t.bar};border-radius:14px;margin:0 0 24px;"><tr>
      <td style="padding:18px 20px;">
        ${opts.eyebrow ? `<p style="font-family:${FONT};font-size:11px;font-weight:700;color:${t.text};margin:0 0 8px;text-transform:uppercase;letter-spacing:0.08em;">${opts.eyebrow}</p>` : ''}
        <div style="font-family:${FONT};font-size:14px;color:${t.text};line-height:1.7;">${opts.body}</div>
      </td>
    </tr></table>`;
}

/** Bulleted list for use inside a card. */
function emailList(items: string[]): string {
  return `<ul style="margin:0;padding:0 0 0 18px;line-height:1.9;">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
}

/** Neat "label · value" table for the facts a reader will look for (plan, dates, amounts, codes). */
function emailDetails(rows: { label: string; value: string }[]): string {
  const body = rows
    .map(
      (r, i) => `<tr>
        <td style="padding:11px 16px;font-family:${FONT};font-size:12px;font-weight:700;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.06em;width:38%;${i ? 'border-top:1px solid #f0efed;' : ''}">${r.label}</td>
        <td style="padding:11px 16px;font-family:${FONT};font-size:14px;font-weight:600;color:${BRAND.ink};${i ? 'border-top:1px solid #f0efed;' : ''}">${r.value}</td>
      </tr>`,
    )
    .join('');
  return `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:14px;margin:0 0 24px;">${body}</table>`;
}

/** "Button not working?" fallback link. */
function emailLinkFallback(url: string): string {
  return `<p style="font-family:${FONT};font-size:12px;color:${BRAND.faint};margin:0;line-height:1.6;word-break:break-all;">Button not working? Copy this link into your browser:<br/><a href="${url}" style="color:${BRAND.orangeDark};">${url}</a></p>`;
}

/**
 * Full HTML document: orange brand bar, white header with the Site Logo, a
 * body slot, and a branded footer. Every template builds its own `bodyHtml`
 * and passes it here. The logo is a placeholder that send() resolves, so
 * this stays synchronous.
 */
function emailShell(opts: { preheader: string; eyebrow: string; bodyHtml: string }): string {
  const year = new Date().getFullYear();
  const link = (label: string, path: string) =>
    `<a href="${FRONTEND_URL}${path}" style="color:${BRAND.orangeDark};font-weight:600;text-decoration:none;">${label}</a>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Piitrade</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT};-webkit-text-size-adjust:100%;">
  <!-- Preheader: the inbox preview snippet. Hidden in the email itself. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${opts.preheader}</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="padding:32px 16px;background:#f4f4f5;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e7e5e4;">
        <!-- Brand bar -->
        <tr><td style="height:6px;line-height:6px;font-size:0;background:${BRAND.orange};background-image:linear-gradient(90deg,${BRAND.orange} 0%,${BRAND.orangeMid} 50%,${BRAND.orangeDark} 100%);">&nbsp;</td></tr>
        <!-- Header: Site Logo + what this email is about -->
        <tr><td style="padding:24px 40px 20px;border-bottom:1px solid #f5f5f4;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"><tr>
            <td align="left" style="vertical-align:middle;">${LOGO_PLACEHOLDER}</td>
            <td align="right" style="vertical-align:middle;">
              <span style="display:inline-block;font-family:${FONT};font-size:11px;font-weight:700;color:${BRAND.orangeDark};background:${BRAND.cream};border:1px solid ${BRAND.creamBorder};border-radius:999px;padding:6px 12px;text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;">${opts.eyebrow}</span>
            </td>
          </tr></table>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px 40px;">
          ${opts.bodyHtml}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:${BRAND.cream};padding:26px 40px;border-top:1px solid ${BRAND.creamBorder};">
          <p style="font-family:${FONT};font-size:13px;font-weight:700;color:${BRAND.orangeDark};margin:0 0 6px;">Piitrade Marketplace</p>
          <p style="font-family:${FONT};font-size:12px;color:${BRAND.muted};margin:0 0 14px;line-height:1.6;">Shop Smart. Shop Trusted. Buy and sell with people you can rely on.</p>
          <p style="font-family:${FONT};font-size:12px;color:${BRAND.muted};margin:0 0 14px;line-height:1.9;">
            ${link('Browse listings', '/listings')} &nbsp;&middot;&nbsp; ${link('Post a listing', '/listings/create')} &nbsp;&middot;&nbsp; ${link('Help centre', '/help')} &nbsp;&middot;&nbsp; ${link('Safety tips', '/safety')}
          </p>
          <p style="font-family:${FONT};font-size:12px;color:${BRAND.muted};margin:0;">
            Need a hand? <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND.orangeDark};font-weight:600;text-decoration:none;">${SUPPORT_EMAIL}</a>
          </p>
          <p style="font-family:${FONT};font-size:11px;color:${BRAND.faint};margin:16px 0 0;line-height:1.6;">You are receiving this because of activity on your Piitrade account.<br/>&copy; ${year} Piitrade Marketplace. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────────
// Every function keeps its original signature, subject line and links; only
// the wording and presentation are improved, and all user-supplied text is escaped.

export async function sendEmailVerificationEmail(to: string, name: string, verificationToken: string): Promise<void> {
  const verificationUrl = `${FRONTEND_URL}/auth/verify-email?token=${encodeURIComponent(verificationToken)}`;
  const subject = 'Verify your Piitrade account';
  const bodyHtml = `
    ${emailTitle('Confirm your email address')}
    ${emailGreeting(name)}
    ${emailP('Welcome to Piitrade! Please confirm your email address to activate your account. You will be able to sign in as soon as it is verified.', { mb: 24 })}
    ${emailButton('Verify my email &rarr;', verificationUrl)}
    ${emailCard({ eyebrow: 'Link expires in 24 hours', tint: 'amber', body: 'For your security, this link works once and only for the account it was sent to. If it expires, you can request a fresh one from the sign-in page.' })}
    ${emailP("Didn't create a Piitrade account? You can safely ignore this email. Nothing will happen unless the link is opened.", { muted: true })}
    ${emailLinkFallback(verificationUrl)}`;
  const html = emailShell({ preheader: 'One quick step: confirm your email to activate your Piitrade account.', eyebrow: 'Account verification', bodyHtml });
  await send(to, subject, html);
}

export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  const subject = 'Welcome to Piitrade Marketplace! 🎉';
  const bodyHtml = `
    ${emailTitle(`Welcome to Piitrade, ${esc(name || 'friend')}! 🎉`)}
    ${emailP('Your account is ready. Piitrade connects buyers and sellers in one trusted marketplace, and you can start right away.', { mb: 24 })}
    ${emailCard({
      eyebrow: 'Get started in minutes',
      tint: 'orange',
      body: emailList([
        '<strong>Browse</strong> thousands of listings across every supported country',
        '<strong>Post</strong> your first listing and reach buyers straight away',
        '<strong>Open a Merchant account</strong> to showcase everything you sell in one place',
        '<strong>Save favourites</strong> and set alerts so you never miss a deal',
      ]),
    })}
    ${emailButton('Start exploring &rarr;', FRONTEND_URL)}
    ${emailHelpLine('Need help getting started? Reach us at')}`;
  const html = emailShell({ preheader: 'Your Piitrade account is ready. Here is how to make the most of it.', eyebrow: 'Welcome', bodyHtml });
  await send(to, subject, html);
}

export async function sendPasswordResetEmail(to: string, name: string, resetToken: string): Promise<void> {
  const resetUrl = `${FRONTEND_URL}/auth/reset-password?token=${encodeURIComponent(resetToken)}`;
  const subject = 'Reset your Piitrade password';
  const bodyHtml = `
    ${emailTitle('Reset your password')}
    ${emailGreeting(name)}
    ${emailP('We received a request to reset the password for your Piitrade account. Use the button below to choose a new one.', { mb: 24 })}
    ${emailButton('Choose a new password &rarr;', resetUrl)}
    ${emailCard({ eyebrow: 'Link expires in 1 hour', tint: 'amber', body: "Didn't ask for this? Ignore this email and your password stays exactly as it is. If you keep getting these emails, contact us so we can help secure your account." })}
    ${emailLinkFallback(resetUrl)}`;
  const html = emailShell({ preheader: 'Use this link within 1 hour to set a new Piitrade password.', eyebrow: 'Password reset', bodyHtml });
  await send(to, subject, html);
}

export async function sendImageApprovedEmail(to: string, name: string, listingTitle?: string): Promise<void> {
  const subject = 'Your image has been approved ✅';
  const listingNote = listingTitle
    ? `The image for your listing <strong style="color:${BRAND.orangeDark};">${esc(listingTitle)}</strong> passed our moderation review and is now live on the marketplace.`
    : 'An image you uploaded passed our moderation review and is now live on the marketplace.';
  const bodyHtml = `
    ${emailTitle('Your image is approved ✅', 'success')}
    ${emailGreeting(name)}
    ${emailP(listingNote, { mb: 24 })}
    ${emailButton('View my listings &rarr;', `${FRONTEND_URL}/profile/listings`)}
    ${emailHelpLine()}`;
  const html = emailShell({ preheader: 'Good news: your uploaded image is approved and live.', eyebrow: 'Image review', bodyHtml });
  await send(to, subject, html);
}

export async function sendImageRejectedEmail(to: string, name: string, reason?: string, listingTitle?: string): Promise<void> {
  const subject = 'Image moderation update — action required';
  const listingNote = listingTitle ? `for your listing <strong style="color:${BRAND.orangeDark};">${esc(listingTitle)}</strong> ` : '';
  const bodyHtml = `
    ${emailTitle('Your image needs a replacement', 'danger')}
    ${emailGreeting(name)}
    ${emailP(`An image you uploaded ${listingNote}didn't meet our content guidelines, so it has been removed.`)}
    ${reason ? emailCard({ eyebrow: 'Why it was removed', tint: 'red', body: esc(reason) }) : ''}
    ${emailP(`You are welcome to upload a replacement. Please take a quick look at our <a href="${FRONTEND_URL}/safety" style="color:${BRAND.orangeDark};font-weight:600;">community guidelines</a> first so the new image is approved quickly.`, { mb: 24 })}
    ${emailButton('Upload a new image &rarr;', `${FRONTEND_URL}/listings/create`)}
    ${emailHelpLine()}`;
  const html = emailShell({ preheader: 'One of your images was removed. See why and how to replace it.', eyebrow: 'Image review', bodyHtml });
  await send(to, subject, html);
}

export async function sendListingApprovedEmail(to: string, name: string, listingTitle: string, expiresAt: Date | null): Promise<void> {
  const subject = 'Your listing has been approved \u2705';
  const expiryStr = expiresAt
    ? expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'indefinitely (no expiry set)';
  const bodyHtml = `
    ${emailTitle('Your listing is live! \u2705', 'success')}
    ${emailGreeting(name)}
    ${emailP(`Great news: <strong style="color:${BRAND.orangeDark};">${esc(listingTitle)}</strong> has been reviewed and approved. Buyers can find it on the marketplace right now.`)}
    ${emailDetails([{ label: 'Listing', value: esc(listingTitle) }, { label: 'Status', value: '<span style="color:#15803d;">&#9679; Live</span>' }, { label: 'Active until', value: expiryStr }])}
    ${emailP('We will send you a reminder before it expires.', { muted: true })}
    ${emailButton('View my listings \u2192', `${FRONTEND_URL}/profile/listings`)}
    ${emailHelpLine()}`;
  const html = emailShell({ preheader: `"${esc(listingTitle)}" is now live on Piitrade.`, eyebrow: 'Listing approved', bodyHtml });
  await send(to, subject, html);
}

export async function sendListingExpiredEmail(to: string, name: string, listingTitle: string): Promise<void> {
  const renewUrl = `${FRONTEND_URL}/profile/subscription`;
  const subject = 'Your listing has expired \u2014 renew to keep it active';
  const bodyHtml = `
    ${emailTitle('Your listing has expired \u23f0', 'warning')}
    ${emailGreeting(name)}
    ${emailP(`<strong style="color:${BRAND.orangeDark};">${esc(listingTitle)}</strong> has expired and is no longer visible to buyers.`)}
    ${emailCard({
      eyebrow: 'What happens next',
      tint: 'amber',
      body: emailList([
        'Your listing is <strong>paused</strong>. Buyers cannot see it right now.',
        'Renew your subscription to bring it back online.',
        'If you choose not to renew, it simply stays hidden.',
      ]),
    })}
    ${emailButton('Renew my subscription \u2192', renewUrl)}
    ${emailHelpLine()}`;
  const html = emailShell({ preheader: `"${esc(listingTitle)}" has expired. Renew to put it back in front of buyers.`, eyebrow: 'Listing expired', bodyHtml });
  await send(to, subject, html);
}

export async function sendListingLikedEmail(
  to: string,
  ownerName: string,
  listingTitle: string,
  listingId: string,
  likerName: string,
  likerUserId?: string,
): Promise<void> {
  const subject = `Someone liked your listing: ${listingTitle} ❤️`;
  const listingUrl = `${FRONTEND_URL}/listings/${listingId}`;
  const likerProfileUrl = likerUserId ? `${FRONTEND_URL}/profile/${likerUserId}` : null;
  const likerDisplay = likerProfileUrl
    ? `<a href="${likerProfileUrl}" style="color:${BRAND.orangeDark};font-weight:600;text-decoration:none;">${esc(likerName)}</a>`
    : `<strong>${esc(likerName)}</strong>`;
  const bodyHtml = `
    ${emailTitle('Someone liked your listing ❤️')}
    ${emailGreeting(ownerName)}
    ${emailP(`${likerDisplay} just liked <strong style="color:${BRAND.orangeDark};">${esc(listingTitle)}</strong>. That is a great sign: buyers are noticing it.`)}
    ${emailCard({ eyebrow: 'Liked by', tint: 'orange', body: `<span style="font-size:16px;font-weight:800;color:${BRAND.orangeDark};">${esc(likerName)}</span>` })}
    ${emailButton('View your listing &rarr;', listingUrl)}
    ${emailP('Tip: replying quickly to messages and keeping your photos sharp helps interested buyers become real ones.', { muted: true })}
    ${emailHelpLine()}`;
  const html = emailShell({ preheader: `${esc(likerName)} liked your listing "${esc(listingTitle)}".`, eyebrow: 'Listing activity', bodyHtml });
  await send(to, subject, html);
}

/**
 * Store subscription renewal reminder. Sent once per renewal window (10% of
 * the package length out, 1–30 days; see renewalWindowDays() and the reminder
 * job in routes/storeRentals.ts, which tracks StoreRental.renewalReminderSentAt
 * so it never repeats for the same rental). Links to the Store Dashboard, where
 * the same "Renew" button used for a fresh application handles a renewal.
 */
export async function sendStoreRenewalReminderEmail(
  to: string,
  name: string,
  storeName: string,
  tier: 'FREE' | 'GOLD' | 'PLATINUM',
  planName: string,
  daysRemaining: number,
  expiresAt: Date,
): Promise<void> {
  const expiryStr = expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const tierLabel = tier === 'PLATINUM' ? 'Platinum \ud83d\udc8e' : tier === 'GOLD' ? 'Gold \ud83e\udd47' : 'Free';
  const dayWord = `${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
  const subject = `Your ${planName} Merchant subscription ends in ${dayWord}`;
  const bodyHtml = `
    ${emailTitle(`Time to renew ${esc(storeName)}`, 'warning')}
    ${emailGreeting(name)}
    ${emailP(`Your <strong>${tierLabel}</strong> subscription for <strong>${esc(storeName)}</strong> ends on <strong>${expiryStr}</strong>, which is ${dayWord} from now.`)}
    ${emailP(`Renew before then to keep your Merchant Dashboard${tier === 'FREE' ? '' : ` and ${tierLabel} visibility`} running without a gap. If it lapses, your existing listings stay online exactly as they are. You would only lose the dashboard and premium placement until you renew.`)}
    ${emailDetails([{ label: 'Merchant', value: esc(storeName) }, { label: 'Plan', value: `${esc(planName)} &middot; ${tierLabel}` }, { label: 'Ends on', value: `<span style="color:#b45309;">${expiryStr}</span>` }])}
    ${emailButton('Renew my Merchant account \u2192', `${FRONTEND_URL}/dashboard/store-rental`)}
    ${emailHelpLine()}`;
  const html = emailShell({ preheader: `${esc(storeName)} ends ${expiryStr}. Renew to avoid any gap.`, eyebrow: 'Renewal reminder', bodyHtml });
  await send(to, subject, html);
}

export async function sendSubscriptionActivatedEmail(to: string, name: string, packageName: string, expiresAt: Date): Promise<void> {
  const expiryStr = expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject = `Your ${packageName} subscription is now active \ud83c\udf89`;
  const bodyHtml = `
    ${emailTitle('Subscription activated! \ud83c\udf89', 'success')}
    ${emailGreeting(name)}
    ${emailP(`Your <strong style="color:${BRAND.orangeDark};">${esc(packageName)}</strong> subscription has been approved and is active. You can post listings right away.`)}
    ${emailDetails([{ label: 'Plan', value: esc(packageName) }, { label: 'Status', value: '<span style="color:#15803d;">&#9679; Active</span>' }, { label: 'Active until', value: expiryStr }])}
    ${emailButton('Post a listing \u2192', `${FRONTEND_URL}/listings/create`)}
    ${emailHelpLine()}`;
  const html = emailShell({ preheader: `Your ${esc(packageName)} subscription is active until ${expiryStr}.`, eyebrow: 'Subscription active', bodyHtml });
  await send(to, subject, html);
}

export interface PaymentReceiptEmailData {
  receiptNumber: string;
  itemLabel: string;
  amountText: string; // e.g. "UGX 25,000"
  paidAt: Date;
  isTest: boolean;
}

/** Payment receipt: the PDF is attached and a copy stays under Profile → Payment receipts. */
export async function sendPaymentReceiptEmail(to: string, name: string, d: PaymentReceiptEmailData, pdf: Buffer): Promise<void> {
  const when = d.paidAt.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' });
  const subject = `${d.isTest ? '[TEST] ' : ''}Your Piitrade receipt ${d.receiptNumber}`;
  const bodyHtml = `
    ${emailTitle('Payment received \u2705', 'success')}
    ${emailGreeting(name)}
    ${emailP('Thank you! We received your Mobile Money payment. The details are below.')}
    ${emailDetails([
      { label: 'Item', value: esc(d.itemLabel) },
      { label: 'Amount paid', value: `<span style="font-size:18px;font-weight:800;color:#15803d;">${esc(d.amountText)}</span>` },
      { label: 'Date', value: esc(when) },
      { label: 'Receipt code', value: `<span style="font-family:monospace;letter-spacing:1px;">${esc(d.receiptNumber)}</span>` },
    ])}
    ${emailP('Your receipt is attached as a PDF, and a copy is saved on your profile under <em>Payment receipts</em>.')}
    ${d.isTest ? emailCard({ eyebrow: 'Test payment', tint: 'amber', body: 'This payment was made in the sandbox, so no real money was charged.' }) : ''}
    ${emailButton('View my receipts &rarr;', `${FRONTEND_URL}/profile#receipts`)}
    ${emailHelpLine('Need help with this payment? Quote the tracking code and write to')}`;
  const html = emailShell({ preheader: `Receipt ${esc(d.receiptNumber)}: ${esc(d.amountText)} for ${esc(d.itemLabel)}.`, eyebrow: 'Payment receipt', bodyHtml });
  await send(to, subject, html, [{ filename: `Piitrade-receipt-${d.receiptNumber}.pdf`, content: pdf, contentType: 'application/pdf' }]);
}

// ─────────────────────────────────────────────────────────────────────────
// Listing alerts ("a listing matching your alert was just posted")
// ─────────────────────────────────────────────────────────────────────────

export interface ListingAlertEmail {
  alertName: string;
  listingTitle: string;
  priceText: string;
  location: string;
  listingId: string;
  /** First listing photo (stored path or URL). Optional: the card simply omits the picture without it. */
  imageUrl?: string | null;
  /** e.g. NEW / USED. Optional. */
  condition?: string | null;
}

export function buildListingAlertEmail(name: string, a: ListingAlertEmail): { subject: string; html: string } {
  const title = esc(a.listingTitle);
  const alertName = esc(a.alertName);
  const url = `${FRONTEND_URL}/listings/${encodeURIComponent(a.listingId)}`;
  const subject = `New match: ${a.listingTitle}`.replace(/[\r\n]+/g, ' ').slice(0, 120);
  const photo = a.imageUrl ? absoluteAssetUrl(a.imageUrl) : null;
  const condition = a.condition ? esc(a.condition.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())) : '';

  // The listing "product card": photo on top, then alert pill, title, price and place.
  const listingCard = `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="background:#ffffff;border:1px solid #e7e5e4;border-radius:16px;overflow:hidden;margin:0 0 24px;">
      ${photo ? `<tr><td style="padding:0;line-height:0;font-size:0;background:#f5f5f4;"><a href="${url}" style="text-decoration:none;"><img src="${esc(photo)}" alt="${title}" width="518" style="display:block;width:100%;max-width:518px;height:auto;max-height:320px;border:0;" /></a></td></tr>` : ''}
      <tr><td style="padding:22px 22px 20px;">
        <span style="display:inline-block;font-family:${FONT};font-size:11px;font-weight:700;color:${BRAND.orangeDark};background:${BRAND.cream};border:1px solid ${BRAND.creamBorder};border-radius:999px;padding:5px 11px;letter-spacing:0.04em;">&#128276; Matched your alert &ldquo;${alertName}&rdquo;</span>
        <p style="font-family:${FONT};font-size:20px;line-height:1.35;font-weight:800;color:${BRAND.ink};margin:14px 0 8px;letter-spacing:-0.2px;">${title}</p>
        <p style="font-family:${FONT};font-size:24px;font-weight:800;color:${BRAND.orangeDark};margin:0 0 12px;letter-spacing:-0.3px;">${esc(a.priceText)}</p>
        <p style="font-family:${FONT};font-size:13px;color:${BRAND.muted};margin:0;line-height:1.7;">
          ${a.location ? `&#128205; ${esc(a.location)}` : ''}${a.location && condition ? ' &nbsp;&middot;&nbsp; ' : ''}${condition ? `&#10003; ${condition}` : ''}
        </p>
      </td></tr>
    </table>`;

  const bodyHtml = `
    ${emailTitle('A new listing matches your alert')}
    ${emailGreeting(name)}
    ${emailP('Good news: something you have been watching for was just posted. Be quick, the best listings get snapped up fast.', { mb: 20 })}
    ${listingCard}
    ${emailButton('View this listing &rarr;', url)}
    ${emailP(`Want fewer or different alerts? <a href="${FRONTEND_URL}/profile/alerts" style="color:${BRAND.orangeDark};font-weight:600;">Manage or turn off your alerts</a> any time.`, { muted: true, mb: 0 })}`;
  // The preheader is raw HTML in emailShell, so it is escaped like everything else a seller controls.
  const html = emailShell({ preheader: esc(`${a.listingTitle} \u2014 ${a.priceText}${a.location ? ` \u00b7 ${a.location}` : ''}`), eyebrow: 'Listing alert', bodyHtml });
  return { subject, html };
}

export async function sendListingAlertEmail(to: string, name: string, alert: ListingAlertEmail): Promise<void> {
  const { subject, html } = buildListingAlertEmail(name, alert);
  await send(to, subject, html);
}
