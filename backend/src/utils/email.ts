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

async function send(to: string, subject: string, html: string): Promise<void> {
  if (resend) {
    try {
      await resend.emails.send({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to,
        subject,
        html,
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
// A single shared header / footer / button / card system so every
// transactional email (verification, welcome, password reset, moderation,
// listing, subscription, likes...) shares one consistent Piitrade brand
// identity, instead of each template carrying its own ad-hoc colour scheme
// and a placeholder "Pi" logo mark unrelated to the site's actual branding.
//
// Design notes:
//  - Built with nested <table>s throughout (never flexbox/grid), since
//    table layout is still the model most reliably rendered across email
//    clients, including older Outlook/Word-engine builds that ignore
//    modern CSS layout entirely.
//  - The logo mark is pure CSS/text (an orange rounded square with a "P"),
//    not an <img>. That sidesteps the "images blocked by default" problem
//    most webmail clients have — there is nothing to fall back from
//    because nothing is an image to begin with.
//  - Brand colour is the site's actual orange (`brand-600` / `premium-gold`
//    equivalents used across the frontend: #FF6500 → #F55906 → #E94B00),
//    not the blue/green/red/pink gradients the previous templates used
//    per-category. Card tints below still vary by context (green for a
//    success state, amber for a warning, red for a rejection reason) so
//    the *meaning* of a callout is still visually obvious — only the
//    brand header/footer/button are now fixed to the Piitrade identity.

const BRAND = {
  orange: '#FF6500',
  orangeMid: '#F55906',
  orangeDark: '#E94B00',
  cream: '#FFF4EC',
} as const;

const FONT = "Inter,Helvetica Neue,Arial,sans-serif";

/** Table-based logo lockup: orange "P" mark + "Piitrade" wordmark. Text/CSS
 *  only — no <img>, so there's nothing that can show up as a broken image
 *  or get stripped by an email client's image-blocking. */
function emailLogoLockup(): string {
  return `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr>
      <td style="width:40px;height:40px;background:#ffffff;border-radius:10px;text-align:center;vertical-align:middle;">
        <span style="font-family:Georgia,'Playfair Display',serif;font-weight:900;font-size:20px;color:${BRAND.orangeDark};line-height:40px;">P</span>
      </td>
      <td style="padding-left:10px;vertical-align:middle;">
        <span style="font-family:${FONT};font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Piitrade</span>
      </td>
    </tr></table>`;
}

/** Branded CTA button — solid Piitrade orange, table-based so it renders
 *  reliably (as a coloured, clickable block) even in clients that ignore
 *  the anchor's own padding/border-radius styling. */
function emailButton(label: string, url: string): string {
  return `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:4px 0 28px;"><tr>
      <td style="background:${BRAND.orange};border-radius:12px;">
        <a href="${url}" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-weight:700;font-size:15px;color:#ffffff;text-decoration:none;">${label}</a>
      </td>
    </tr></table>`;
}

/** A rounded, tinted content card — used for status blocks, warnings,
 *  reasons, and highlighted details ("card-based content areas"). */
function emailCard(opts: { eyebrow?: string; body: string; tint?: 'orange' | 'green' | 'amber' | 'red' | 'neutral' }): string {
  const tints: Record<string, { bg: string; border: string; text: string }> = {
    orange: { bg: BRAND.cream, border: '#FFC7A3', text: BRAND.orangeDark },
    green: { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' },
    amber: { bg: '#fff7ed', border: '#fed7aa', text: '#92400e' },
    red: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' },
    neutral: { bg: '#f8fafc', border: '#e2e8f0', text: '#334155' },
  };
  const t = tints[opts.tint || 'orange'];
  return `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="background:${t.bg};border:1.5px solid ${t.border};border-radius:16px;margin:0 0 24px;"><tr>
      <td style="padding:20px;">
        ${opts.eyebrow ? `<p style="font-family:${FONT};font-size:12px;font-weight:700;color:${t.text};margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em;">${opts.eyebrow}</p>` : ''}
        <div style="font-family:${FONT};font-size:14px;color:${t.text};line-height:1.7;">${opts.body}</div>
      </td>
    </tr></table>`;
}

/** Full HTML document shell: branded header, a body-content slot, and a
 *  consistent branded footer. Every template below builds its own
 *  `bodyHtml` and passes it in here rather than assembling its own
 *  <html>/<head>/header/footer from scratch. */
function emailShell(opts: { preheader: string; eyebrow: string; bodyHtml: string }): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Piitrade</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT};">
  <!-- Preheader: this is what shows as the inbox preview snippet. It's
       visually hidden in the rendered email itself. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${opts.preheader}</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="padding:32px 16px;background:#f4f4f5;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;">
        <!-- Branded header -->
        <tr><td style="background:linear-gradient(135deg,${BRAND.orange} 0%,${BRAND.orangeMid} 50%,${BRAND.orangeDark} 100%);padding:32px 40px 28px;">
          ${emailLogoLockup()}
          <p style="font-family:${FONT};color:rgba(255,255,255,0.9);font-size:13px;margin:12px 0 0;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">${opts.eyebrow}</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px;">
          ${opts.bodyHtml}
        </td></tr>
        <!-- Branded footer -->
        <tr><td style="background:${BRAND.cream};padding:24px 40px;border-top:1px solid #FFE4D1;">
          <p style="font-family:${FONT};font-size:13px;font-weight:700;color:${BRAND.orangeDark};margin:0 0 4px;">Piitrade Marketplace</p>
          <p style="font-family:${FONT};font-size:12px;color:#78716c;margin:0 0 10px;line-height:1.6;">
            The trusted online marketplace connecting buyers and sellers across UAE, Uganda, Kenya and China.
          </p>
          <p style="font-family:${FONT};font-size:12px;color:#78716c;margin:0;">
            Need help? <a href="mailto:support@piitrade.com" style="color:${BRAND.orangeDark};font-weight:600;text-decoration:none;">support@piitrade.com</a>
          </p>
          <p style="font-family:${FONT};font-size:11px;color:#a8a29e;margin:14px 0 0;">&copy; ${year} Piitrade Marketplace. All rights reserved.</p>
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
// Every function below keeps its original signature, subject line, and
// links/business-logic exactly as before — only the HTML presentation is
// rewritten to use the shared design system above.

export async function sendEmailVerificationEmail(to: string, name: string, verificationToken: string): Promise<void> {
  const verificationUrl = `${FRONTEND_URL}/auth/verify-email?token=${encodeURIComponent(verificationToken)}`;
  const subject = 'Verify your Piitrade account';
  const bodyHtml = `
    <h1 style="font-family:${FONT};font-size:26px;font-weight:800;color:${BRAND.orangeDark};margin:0 0 12px;">Confirm your email</h1>
    <p style="font-family:${FONT};font-size:15px;color:#374151;line-height:1.7;margin:0 0 24px;">
      Hi ${name}, thanks for joining Piitrade. Please confirm your email address to activate your account — you won't be able to log in until it's verified.
    </p>
    ${emailButton('Verify My Email →', verificationUrl)}
    ${emailCard({ eyebrow: 'Expires soon', tint: 'amber', body: 'This verification link expires in <strong>24 hours</strong> and can only be used once. If it expires, you can request a new one from the login screen.' })}
    <p style="font-family:${FONT};font-size:12px;color:#9ca3af;margin:0 0 4px;line-height:1.6;">
      For your security, this link only works for the account it was sent to. If you didn't create a Piitrade account, you can safely ignore this email.
    </p>
    <p style="font-family:${FONT};font-size:12px;color:#9ca3af;margin:0;word-break:break-all;">
      Button not working? Copy this link: <a href="${verificationUrl}" style="color:${BRAND.orangeDark};">${verificationUrl}</a>
    </p>`;
  const html = emailShell({ preheader: 'Confirm your email to activate your Piitrade account.', eyebrow: 'Account Verification', bodyHtml });
  await send(to, subject, html);
}

export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  const subject = 'Welcome to Piitrade Marketplace! 🎉';
  const bodyHtml = `
    <h1 style="font-family:${FONT};font-size:26px;font-weight:800;color:${BRAND.orangeDark};margin:0 0 12px;">Welcome, ${name}! 🎉</h1>
    <p style="font-family:${FONT};font-size:15px;color:#374151;line-height:1.7;margin:0 0 24px;">
      Your account has been successfully created on Piitrade Marketplace — the premier platform connecting buyers and sellers across UAE, Uganda, Kenya and China.
    </p>
    ${emailCard({
      eyebrow: 'What you can do now',
      tint: 'orange',
      body: `<ul style="margin:0;padding:0 0 0 18px;line-height:2;">
        <li>Browse thousands of listings across every supported country</li>
        <li>Post your first listing — it's free!</li>
        <li>Set up your seller store</li>
        <li>Save your favourite items</li>
      </ul>`,
    })}
    ${emailButton('Start Exploring →', FRONTEND_URL)}
    <p style="font-family:${FONT};font-size:13px;color:#6b7280;margin:0;">
      Need help getting started? Contact us at <a href="mailto:support@piitrade.com" style="color:${BRAND.orangeDark};text-decoration:none;font-weight:600;">support@piitrade.com</a>
    </p>`;
  const html = emailShell({ preheader: 'Your Piitrade account is ready — here is what to do next.', eyebrow: 'Welcome to Piitrade', bodyHtml });
  await send(to, subject, html);
}

export async function sendPasswordResetEmail(to: string, name: string, resetToken: string): Promise<void> {
  const resetUrl = `${FRONTEND_URL}/auth/reset-password?token=${encodeURIComponent(resetToken)}`;
  const subject = 'Reset your Piitrade password';
  const bodyHtml = `
    <h1 style="font-family:${FONT};font-size:26px;font-weight:800;color:${BRAND.orangeDark};margin:0 0 12px;">Password reset request</h1>
    <p style="font-family:${FONT};font-size:15px;color:#374151;line-height:1.7;margin:0 0 16px;">
      Hi ${name}, we received a request to reset the password for your Piitrade account.
    </p>
    <p style="font-family:${FONT};font-size:15px;color:#374151;line-height:1.7;margin:0 0 24px;">
      Click the button below to set a new password. This link expires in <strong>1 hour</strong>.
    </p>
    ${emailButton('Reset My Password →', resetUrl)}
    ${emailCard({ tint: 'amber', body: "⚠️ If you didn't request this, you can safely ignore this email — your password won't change." })}
    <p style="font-family:${FONT};font-size:13px;color:#6b7280;margin:0 0 4px;word-break:break-all;">
      Button not working? Copy this link: <a href="${resetUrl}" style="color:${BRAND.orangeDark};">${resetUrl}</a>
    </p>`;
  const html = emailShell({ preheader: 'Reset your Piitrade password — this link expires in 1 hour.', eyebrow: 'Password Reset', bodyHtml });
  await send(to, subject, html);
}

export async function sendImageApprovedEmail(to: string, name: string, listingTitle?: string): Promise<void> {
  const subject = 'Your image has been approved ✅';
  const listingNote = listingTitle
    ? `Your image for the listing <strong style="color:${BRAND.orangeDark};">${listingTitle}</strong> has been reviewed and approved by our moderation team. It is now live on the marketplace.`
    : 'One of your uploaded images has been reviewed and approved by our moderation team. It is now live on the marketplace.';
  const bodyHtml = `
    <h1 style="font-family:${FONT};font-size:24px;font-weight:800;color:#15803d;margin:0 0 12px;">Image approved! ✅</h1>
    <p style="font-family:${FONT};font-size:15px;color:#374151;line-height:1.7;margin:0 0 12px;">Hi ${name},</p>
    <p style="font-family:${FONT};font-size:14px;color:#374151;line-height:1.7;margin:0 0 20px;">${listingNote}</p>
    ${emailButton('View My Listings →', `${FRONTEND_URL}/profile/listings`)}
    <p style="font-family:${FONT};font-size:13px;color:#6b7280;margin:0;">Questions? <a href="mailto:support@piitrade.com" style="color:${BRAND.orangeDark};font-weight:600;">support@piitrade.com</a></p>`;
  const html = emailShell({ preheader: 'Your uploaded image has been approved and is now live.', eyebrow: 'Image Moderation Update', bodyHtml });
  await send(to, subject, html);
}

export async function sendImageRejectedEmail(to: string, name: string, reason?: string, listingTitle?: string): Promise<void> {
  const subject = 'Image moderation update — action required';
  const listingNote = listingTitle ? `for the listing <strong style="color:${BRAND.orangeDark};">${listingTitle}</strong> ` : '';
  const bodyHtml = `
    <h1 style="font-family:${FONT};font-size:24px;font-weight:800;color:#b91c1c;margin:0 0 12px;">Image not approved ❌</h1>
    <p style="font-family:${FONT};font-size:15px;color:#374151;line-height:1.7;margin:0 0 12px;">Hi ${name},</p>
    <p style="font-family:${FONT};font-size:14px;color:#374151;line-height:1.7;margin:0 0 16px;">
      An image you uploaded ${listingNote}did not meet our content guidelines and has been removed.
    </p>
    ${reason ? emailCard({ eyebrow: 'Reason', tint: 'red', body: reason }) : ''}
    <p style="font-family:${FONT};font-size:14px;color:#374151;line-height:1.7;margin:0 0 20px;">
      You're welcome to upload a replacement image. Please review our
      <a href="${FRONTEND_URL}/safety" style="color:${BRAND.orangeDark};font-weight:600;">community guidelines</a> before re-uploading.
    </p>
    ${emailButton('Upload New Image →', `${FRONTEND_URL}/listings/create`)}
    <p style="font-family:${FONT};font-size:13px;color:#6b7280;margin:0;">Questions? <a href="mailto:support@piitrade.com" style="color:${BRAND.orangeDark};font-weight:600;">support@piitrade.com</a></p>`;
  const html = emailShell({ preheader: 'An uploaded image needs a replacement — see why inside.', eyebrow: 'Image Moderation Update', bodyHtml });
  await send(to, subject, html);
}

export async function sendListingApprovedEmail(to: string, name: string, listingTitle: string, expiresAt: Date | null): Promise<void> {
  const subject = 'Your listing has been approved \u2705';
  const expiryStr = expiresAt
    ? expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'indefinitely (no expiry set)';
  const bodyHtml = `
    <h1 style="font-family:${FONT};font-size:24px;font-weight:800;color:#15803d;margin:0 0 12px;">Your listing is now live! \u2705</h1>
    <p style="font-family:${FONT};font-size:15px;color:#374151;line-height:1.7;margin:0 0 12px;">Hi ${name},</p>
    <p style="font-family:${FONT};font-size:14px;color:#374151;line-height:1.7;margin:0 0 16px;">
      Great news! Your listing <strong style="color:${BRAND.orangeDark};">${listingTitle}</strong> has been reviewed and approved by our team. It is now live on the marketplace.
    </p>
    ${emailCard({ eyebrow: 'Listing active until', tint: 'orange', body: `<span style="font-size:20px;font-weight:800;color:${BRAND.orangeDark};">${expiryStr}</span><br/><span style="font-size:12px;color:#78716c;">You will receive a reminder before your listing expires.</span>` })}
    ${emailButton('View My Listings \u2192', `${FRONTEND_URL}/profile/listings`)}
    <p style="font-family:${FONT};font-size:13px;color:#6b7280;margin:0;">Questions? <a href="mailto:support@piitrade.com" style="color:${BRAND.orangeDark};font-weight:600;">support@piitrade.com</a></p>`;
  const html = emailShell({ preheader: `Your listing "${listingTitle}" is now live on Piitrade.`, eyebrow: 'Listing Approved', bodyHtml });
  await send(to, subject, html);
}

export async function sendListingExpiredEmail(to: string, name: string, listingTitle: string): Promise<void> {
  const renewUrl = `${FRONTEND_URL}/profile/subscription`;
  const subject = 'Your listing has expired \u2014 renew to keep it active';
  const bodyHtml = `
    <h1 style="font-family:${FONT};font-size:24px;font-weight:800;color:#92400e;margin:0 0 12px;">Your listing has expired \u23f0</h1>
    <p style="font-family:${FONT};font-size:15px;color:#374151;line-height:1.7;margin:0 0 12px;">Hi ${name},</p>
    <p style="font-family:${FONT};font-size:14px;color:#374151;line-height:1.7;margin:0 0 16px;">
      Your listing <strong style="color:${BRAND.orangeDark};">${listingTitle}</strong> has expired and is no longer visible to buyers on the marketplace.
    </p>
    ${emailCard({
      eyebrow: 'What happens next?',
      tint: 'amber',
      body: `<ul style="margin:0;padding:0 0 0 18px;line-height:2;">
        <li>Your listing is now <strong>dormant</strong> \u2014 buyers cannot view it.</li>
        <li>Renew your subscription to reactivate your listing.</li>
        <li>If you don't renew, your listing will remain hidden.</li>
      </ul>`,
    })}
    ${emailButton('Renew My Subscription \u2192', renewUrl)}
    <p style="font-family:${FONT};font-size:13px;color:#6b7280;margin:0;">Questions? <a href="mailto:support@piitrade.com" style="color:${BRAND.orangeDark};font-weight:600;">support@piitrade.com</a></p>`;
  const html = emailShell({ preheader: `"${listingTitle}" has expired — renew to bring it back.`, eyebrow: 'Listing Expiry Notice', bodyHtml });
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
    ? `<a href="${likerProfileUrl}" style="color:${BRAND.orangeDark};font-weight:600;text-decoration:none;">${likerName}</a>`
    : `<strong>${likerName}</strong>`;
  const bodyHtml = `
    <h1 style="font-family:${FONT};font-size:24px;font-weight:800;color:${BRAND.orangeDark};margin:0 0 12px;">Someone liked your listing! ❤️</h1>
    <p style="font-family:${FONT};font-size:15px;color:#374151;line-height:1.7;margin:0 0 12px;">Hi ${ownerName},</p>
    <p style="font-family:${FONT};font-size:14px;color:#374151;line-height:1.7;margin:0 0 16px;">
      ${likerDisplay} just liked your listing <strong style="color:${BRAND.orangeDark};">${listingTitle}</strong>. This is a great sign — your listing is getting attention!
    </p>
    ${emailCard({ eyebrow: 'Liked by', tint: 'orange', body: `<span style="font-size:16px;font-weight:800;color:${BRAND.orangeDark};">${likerName}</span>` })}
    ${emailButton('View Your Listing →', listingUrl)}
    <p style="font-family:${FONT};font-size:13px;color:#6b7280;margin:0;">Questions? <a href="mailto:support@piitrade.com" style="color:${BRAND.orangeDark};font-weight:600;">support@piitrade.com</a></p>`;
  const html = emailShell({ preheader: `${likerName} liked your listing "${listingTitle}".`, eyebrow: 'Listing Activity', bodyHtml });
  await send(to, subject, html);
}

/**
 * Store subscription renewal reminder — sent once per renewal window, not
 * daily: 30 days out for an ANNUAL plan, 3 days out for MONTHLY (see
 * getRenewalWindowDays() and the reminder job in routes/storeRentals.ts,
 * which tracks StoreRental.renewalReminderSentAt so this never repeats for
 * the same rental). Links straight to the Store Dashboard, where the same
 * "Renew" button already used for a fresh application handles a renewal —
 * no separate flow, no re-entering store details, just confirming the plan
 * and paying.
 */
export async function sendStoreRenewalReminderEmail(
  to: string,
  name: string,
  storeName: string,
  tier: 'FREE' | 'GOLD' | 'PLATINUM',
  plan: 'MONTHLY' | 'ANNUAL',
  daysRemaining: number,
  expiresAt: Date,
): Promise<void> {
  const expiryStr = expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const tierLabel = tier === 'PLATINUM' ? 'Platinum \ud83d\udc8e' : tier === 'GOLD' ? 'Gold \ud83e\udd47' : 'Free';
  const subject = `Your ${plan === 'ANNUAL' ? 'yearly' : 'monthly'} store subscription ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
  const bodyHtml = `
    <h1 style="font-family:${FONT};font-size:24px;font-weight:800;color:${BRAND.orangeDark};margin:0 0 12px;">Time to renew ${storeName}</h1>
    <p style="font-family:${FONT};font-size:15px;color:#374151;line-height:1.7;margin:0 0 12px;">Hi ${name},</p>
    <p style="font-family:${FONT};font-size:14px;color:#374151;line-height:1.7;margin:0 0 16px;">
      Your <strong>${tierLabel}</strong> store subscription for <strong>${storeName}</strong> ends on <strong>${expiryStr}</strong> — ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} from now.
      Renewing before then keeps your Store Dashboard, listing placements, and ${tier === 'FREE' ? '' : `${tierLabel} visibility `}running without any gap. If it lapses, your existing listings stay online exactly as they are — you just lose the dashboard and premium placement until you renew.
    </p>
    ${emailCard({ eyebrow: 'Subscription ends', tint: 'amber', body: `<span style="font-size:20px;font-weight:800;color:#b45309;">${expiryStr}</span>` })}
    ${emailButton('Renew My Store \u2192', `${FRONTEND_URL}/dashboard/store-rental`)}
    <p style="font-family:${FONT};font-size:13px;color:#6b7280;margin:0;">Questions? <a href="mailto:support@piitrade.com" style="color:${BRAND.orangeDark};font-weight:600;">support@piitrade.com</a></p>`;
  const html = emailShell({ preheader: `${storeName} ends ${expiryStr} — renew to avoid any gap.`, eyebrow: 'Renewal Reminder', bodyHtml });
  await send(to, subject, html);
}

export async function sendSubscriptionActivatedEmail(to: string, name: string, packageName: string, expiresAt: Date): Promise<void> {
  const expiryStr = expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject = `Your ${packageName} subscription is now active \ud83c\udf89`;
  const bodyHtml = `
    <h1 style="font-family:${FONT};font-size:24px;font-weight:800;color:#15803d;margin:0 0 12px;">Subscription activated! \ud83c\udf89</h1>
    <p style="font-family:${FONT};font-size:15px;color:#374151;line-height:1.7;margin:0 0 12px;">Hi ${name},</p>
    <p style="font-family:${FONT};font-size:14px;color:#374151;line-height:1.7;margin:0 0 16px;">
      Your <strong style="color:${BRAND.orangeDark};">${packageName}</strong> subscription has been approved and is now active. You can now post listings on the marketplace.
    </p>
    ${emailCard({ eyebrow: 'Active until', tint: 'green', body: `<span style="font-size:20px;font-weight:800;color:#15803d;">${expiryStr}</span>` })}
    ${emailButton('Post a Listing \u2192', `${FRONTEND_URL}/listings/create`)}
    <p style="font-family:${FONT};font-size:13px;color:#6b7280;margin:0;">Questions? <a href="mailto:support@piitrade.com" style="color:${BRAND.orangeDark};font-weight:600;">support@piitrade.com</a></p>`;
  const html = emailShell({ preheader: `Your ${packageName} subscription is active until ${expiryStr}.`, eyebrow: 'Subscription Activated', bodyHtml });
  await send(to, subject, html);
}
