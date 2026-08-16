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

const FROM_NAME = '3R Elite Marketplace';
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

export async function sendEmailVerificationEmail(to: string, name: string, verificationToken: string): Promise<void> {
  const verificationUrl = `${FRONTEND_URL}/auth/verify-email?token=${encodeURIComponent(verificationToken)}`;
  const subject = 'Verify your 3R Elite account';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;font-family:Inter,Helvetica Neue,Arial,sans-serif;background:#f0f9ff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(2,132,199,0.10);">
        <tr><td style="background:linear-gradient(135deg,#0284c7 0%,#0369a1 50%,#1d4ed8 100%);padding:40px 40px 32px;">
          <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:8px;">
            <div style="width:40px;height:40px;background:rgba(197,160,89,0.2);border:2px solid rgba(197,160,89,0.4);border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:900;color:#C5A059;font-size:16px;line-height:40px;text-align:center;">3R</div>
            <span style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">3R <em style="font-style:italic;">Elite</em></span>
          </div>
          <p style="color:rgba(255,255,255,0.9);font-size:14px;margin:0;">Account Verification</p>
        </td></tr>
        <tr><td style="padding:40px;">
          <h1 style="font-size:28px;font-weight:800;color:#0284c7;margin:0 0 12px;">Confirm your email</h1>
          <p style="font-size:16px;color:#374151;line-height:1.7;margin:0 0 24px;">
            Hi ${name}, please confirm your email address to complete new-account verification.
          </p>
          <a href="${verificationUrl}" style="display:inline-block;background:linear-gradient(135deg,#0284c7,#0369a1);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;margin-bottom:24px;">Verify My Email →</a>
          <p style="font-size:13px;color:#6b7280;margin:0;word-break:break-all;">
            Or copy this link: <a href="${verificationUrl}" style="color:#0284c7;">${verificationUrl}</a>
          </p>
          <p style="font-size:12px;color:#9ca3af;margin:16px 0 0;">This verification link expires in 24 hours.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  await send(to, subject, html);
}

export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  const subject = 'Welcome to 3R Elite Marketplace! 🎉';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;font-family:Inter,Helvetica Neue,Arial,sans-serif;background:#f0f9ff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(2,132,199,0.10);">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0284c7 0%,#0369a1 50%,#1d4ed8 100%);padding:40px 40px 32px;">
          <table width="100%"><tr>
            <td>
              <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:8px;">
                <div style="width:40px;height:40px;background:rgba(197,160,89,0.2);border:2px solid rgba(197,160,89,0.4);border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:900;color:#C5A059;font-size:16px;line-height:40px;text-align:center;">3R</div>
                <span style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">3R <em style="font-style:italic;">Elite</em></span>
              </div>
              <p style="color:rgba(255,255,255,0.9);font-size:14px;margin:0;">The Premier Online Marketplace</p>
            </td>
          </tr></table>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px;">
          <h1 style="font-size:28px;font-weight:800;color:#0284c7;margin:0 0 12px;">Welcome, ${name}! 🎉</h1>
          <p style="font-size:16px;color:#374151;line-height:1.7;margin:0 0 24px;">
            Your account has been successfully created on 3R Elite Marketplace — the premier platform connecting buyers and sellers across UAE and Uganda.
          </p>
          <div style="background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:16px;padding:24px;margin-bottom:28px;">
            <p style="font-size:14px;font-weight:700;color:#0284c7;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.05em;">What you can do now:</p>
            <ul style="margin:0;padding:0 0 0 20px;color:#374151;font-size:14px;line-height:2;">
              <li>Browse thousands of listings across UAE &amp; Uganda</li>
              <li>Post your first listing — it's free!</li>
              <li>Set up your seller store</li>
              <li>Save your favourite items</li>
            </ul>
          </div>
          <a href="${FRONTEND_URL}" style="display:inline-block;background:linear-gradient(135deg,#0284c7,#0369a1);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;margin-bottom:28px;">Start Exploring →</a>
          <hr style="border:none;border-top:1px solid #e0f2fe;margin:0 0 24px;" />
          <p style="font-size:13px;color:#6b7280;margin:0;">
            Need help? Contact us at <a href="mailto:support@piitrade.com" style="color:#0284c7;text-decoration:none;font-weight:600;">support@piitrade.com</a>
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e0f2fe;">
          <p style="font-size:12px;color:#9ca3af;margin:0;text-align:center;">&copy; ${new Date().getFullYear()} 3R Elite Marketplace. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  await send(to, subject, html);
}

export async function sendPasswordResetEmail(to: string, name: string, resetToken: string): Promise<void> {
  const resetUrl = `${FRONTEND_URL}/auth/reset-password?token=${encodeURIComponent(resetToken)}`;
  const subject = 'Reset your 3R Elite password';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;font-family:Inter,Helvetica Neue,Arial,sans-serif;background:#f0f9ff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(2,132,199,0.10);">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0284c7 0%,#0369a1 50%,#1d4ed8 100%);padding:40px 40px 32px;">
          <table width="100%"><tr>
            <td>
              <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:8px;">
                <div style="width:40px;height:40px;background:rgba(197,160,89,0.2);border:2px solid rgba(197,160,89,0.4);border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:900;color:#C5A059;font-size:16px;line-height:40px;text-align:center;">3R</div>
                <span style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">3R <em style="font-style:italic;">Elite</em></span>
              </div>
              <p style="color:rgba(255,255,255,0.9);font-size:14px;margin:0;">The Premier Online Marketplace</p>
            </td>
          </tr></table>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px;">
          <h1 style="font-size:26px;font-weight:800;color:#0284c7;margin:0 0 12px;">Password Reset Request</h1>
          <p style="font-size:16px;color:#374151;line-height:1.7;margin:0 0 24px;">
            Hi ${name}, we received a request to reset the password for your 3R Elite account.
          </p>
          <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 24px;">
            Click the button below to set a new password. This link expires in <strong>1 hour</strong>.
          </p>
          <a href="${resetUrl}" style="display:inline-block;background:linear-gradient(135deg,#0284c7,#0369a1);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;margin-bottom:28px;">Reset My Password →</a>
          <div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:12px;padding:16px;margin-bottom:24px;">
            <p style="font-size:13px;color:#92400e;margin:0;line-height:1.6;">
              ⚠️ If you didn't request this, you can safely ignore this email. Your password won't change.
            </p>
          </div>
          <p style="font-size:13px;color:#6b7280;margin:0;word-break:break-all;">
            Or copy this link: <a href="${resetUrl}" style="color:#0284c7;">${resetUrl}</a>
          </p>
          <hr style="border:none;border-top:1px solid #e0f2fe;margin:24px 0;" />
          <p style="font-size:13px;color:#6b7280;margin:0;">
            Need help? Contact us at <a href="mailto:support@piitrade.com" style="color:#0284c7;text-decoration:none;font-weight:600;">support@piitrade.com</a>
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e0f2fe;">
          <p style="font-size:12px;color:#9ca3af;margin:0;text-align:center;">&copy; ${new Date().getFullYear()} 3R Elite Marketplace. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  await send(to, subject, html);
}

export async function sendImageApprovedEmail(to: string, name: string, listingTitle?: string): Promise<void> {
  const subject = 'Your image has been approved ✅';
  const listingNote = listingTitle
    ? `<p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 16px;">
        Your image for the listing <strong style="color:#0284c7;">${listingTitle}</strong> has been reviewed and approved by our moderation team. It is now live on the marketplace.
       </p>`
    : `<p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 16px;">
        One of your uploaded images has been reviewed and approved by our moderation team. It is now live on the marketplace.
       </p>`;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;font-family:Inter,Helvetica Neue,Arial,sans-serif;background:#f0fdf4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(22,163,74,0.10);">
        <tr><td style="background:linear-gradient(135deg,#16a34a 0%,#15803d 60%,#166534 100%);padding:36px 40px 28px;">
          <span style="font-size:24px;font-weight:800;color:#ffffff;">3R Elite</span>
          <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:4px 0 0;">Image Moderation Update</p>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          <h1 style="font-size:24px;font-weight:800;color:#16a34a;margin:0 0 12px;">Image Approved! ✅</h1>
          <p style="font-size:16px;color:#374151;line-height:1.7;margin:0 0 12px;">Hi ${name},</p>
          ${listingNote}
          <a href="${FRONTEND_URL}/profile/listings" style="display:inline-block;background:linear-gradient(135deg,#16a34a,#15803d);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;margin-bottom:24px;">View My Listings →</a>
          <hr style="border:none;border-top:1px solid #dcfce7;margin:0 0 20px;" />
          <p style="font-size:13px;color:#6b7280;margin:0;">Questions? <a href="mailto:support@piitrade.com" style="color:#16a34a;font-weight:600;">support@piitrade.com</a></p>
        </td></tr>
        <tr><td style="background:#f0fdf4;padding:16px 40px;border-top:1px solid #dcfce7;">
          <p style="font-size:12px;color:#9ca3af;margin:0;text-align:center;">&copy; ${new Date().getFullYear()} 3R Elite Marketplace. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  await send(to, subject, html);
}

export async function sendImageRejectedEmail(to: string, name: string, reason?: string, listingTitle?: string): Promise<void> {
  const subject = 'Image moderation update — action required';
  const reasonNote = reason
    ? `<div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:12px;padding:16px;margin-bottom:20px;">
        <p style="font-size:13px;font-weight:700;color:#92400e;margin:0 0 6px;">Reason:</p>
        <p style="font-size:13px;color:#92400e;margin:0;">${reason}</p>
       </div>`
    : '';
  const listingNote = listingTitle ? `for the listing <strong style="color:#dc2626;">${listingTitle}</strong>` : '';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;font-family:Inter,Helvetica Neue,Arial,sans-serif;background:#fff1f2;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(220,38,38,0.10);">
        <tr><td style="background:linear-gradient(135deg,#dc2626 0%,#b91c1c 60%,#991b1b 100%);padding:36px 40px 28px;">
          <span style="font-size:24px;font-weight:800;color:#ffffff;">3R Elite</span>
          <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:4px 0 0;">Image Moderation Update</p>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          <h1 style="font-size:24px;font-weight:800;color:#dc2626;margin:0 0 12px;">Image Not Approved ❌</h1>
          <p style="font-size:16px;color:#374151;line-height:1.7;margin:0 0 12px;">Hi ${name},</p>
          <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 16px;">
            An image you uploaded ${listingNote} did not meet our content guidelines and has been removed.
          </p>
          ${reasonNote}
          <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 20px;">
            You are welcome to upload a replacement image. Please review our
            <a href="${FRONTEND_URL}/safety" style="color:#dc2626;font-weight:600;">community guidelines</a> before re-uploading.
          </p>
          <a href="${FRONTEND_URL}/listings/create" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;margin-bottom:24px;">Upload New Image →</a>
          <hr style="border:none;border-top:1px solid #fee2e2;margin:0 0 20px;" />
          <p style="font-size:13px;color:#6b7280;margin:0;">Questions? <a href="mailto:support@piitrade.com" style="color:#dc2626;font-weight:600;">support@piitrade.com</a></p>
        </td></tr>
        <tr><td style="background:#fff1f2;padding:16px 40px;border-top:1px solid #fee2e2;">
          <p style="font-size:12px;color:#9ca3af;margin:0;text-align:center;">&copy; ${new Date().getFullYear()} 3R Elite Marketplace. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  await send(to, subject, html);
}

export async function sendListingApprovedEmail(to: string, name: string, listingTitle: string, expiresAt: Date | null): Promise<void> {
  const subject = 'Your listing has been approved \u2705';
  const expiryStr = expiresAt
    ? expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'indefinitely (no expiry set)';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;font-family:Inter,Helvetica Neue,Arial,sans-serif;background:#f0f9ff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(2,132,199,0.10);">
        <tr><td style="background:linear-gradient(135deg,#0284c7 0%,#0369a1 50%,#1d4ed8 100%);padding:36px 40px 28px;">
          <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:8px;">
            <div style="width:40px;height:40px;background:rgba(197,160,89,0.2);border:2px solid rgba(197,160,89,0.4);border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:900;color:#C5A059;font-size:16px;line-height:40px;text-align:center;">3R</div>
            <span style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">3R <em style="font-style:italic;">Elite</em></span>
          </div>
          <p style="color:rgba(255,255,255,0.9);font-size:14px;margin:4px 0 0;">Listing Approved</p>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          <h1 style="font-size:24px;font-weight:800;color:#16a34a;margin:0 0 12px;">Your listing is now live! \u2705</h1>
          <p style="font-size:16px;color:#374151;line-height:1.7;margin:0 0 12px;">Hi ${name},</p>
          <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 16px;">
            Great news! Your listing <strong style="color:#0284c7;">${listingTitle}</strong> has been reviewed and approved by our team. It is now live on the marketplace.
          </p>
          <div style="background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:16px;padding:20px;margin-bottom:24px;">
            <p style="font-size:13px;font-weight:700;color:#0284c7;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.05em;">Listing active until</p>
            <p style="font-size:20px;font-weight:800;color:#0284c7;margin:0;">${expiryStr}</p>
            <p style="font-size:12px;color:#6b7280;margin:6px 0 0;">You will receive a reminder before your listing expires.</p>
          </div>
          <a href="${FRONTEND_URL}/profile/listings" style="display:inline-block;background:linear-gradient(135deg,#0284c7,#0369a1);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;margin-bottom:24px;">View My Listings \u2192</a>
          <hr style="border:none;border-top:1px solid #e0f2fe;margin:0 0 20px;" />
          <p style="font-size:13px;color:#6b7280;margin:0;">Questions? <a href="mailto:support@piitrade.com" style="color:#0284c7;font-weight:600;">support@piitrade.com</a></p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e0f2fe;">
          <p style="font-size:12px;color:#9ca3af;margin:0;text-align:center;">&copy; ${new Date().getFullYear()} 3R Elite Marketplace. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  await send(to, subject, html);
}

export async function sendListingExpiredEmail(to: string, name: string, listingTitle: string): Promise<void> {
  const renewUrl = `${FRONTEND_URL}/profile/subscription`;
  const subject = 'Your listing has expired \u2014 renew to keep it active';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;font-family:Inter,Helvetica Neue,Arial,sans-serif;background:#fff7ed;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(245,158,11,0.10);">
        <tr><td style="background:linear-gradient(135deg,#d97706 0%,#b45309 60%,#92400e 100%);padding:36px 40px 28px;">
          <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:8px;">
            <div style="width:40px;height:40px;background:rgba(255,255,255,0.2);border:2px solid rgba(255,255,255,0.4);border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:900;color:#ffffff;font-size:16px;line-height:40px;text-align:center;">3R</div>
            <span style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">3R <em style="font-style:italic;">Elite</em></span>
          </div>
          <p style="color:rgba(255,255,255,0.9);font-size:14px;margin:4px 0 0;">Listing Expiry Notice</p>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          <h1 style="font-size:24px;font-weight:800;color:#d97706;margin:0 0 12px;">Your listing has expired \u23f0</h1>
          <p style="font-size:16px;color:#374151;line-height:1.7;margin:0 0 12px;">Hi ${name},</p>
          <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 16px;">
            Your listing <strong style="color:#d97706;">${listingTitle}</strong> has expired and is no longer visible to buyers on the marketplace.
          </p>
          <div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:16px;padding:20px;margin-bottom:24px;">
            <p style="font-size:13px;font-weight:700;color:#92400e;margin:0 0 8px;">What happens next?</p>
            <ul style="margin:0;padding:0 0 0 18px;color:#92400e;font-size:13px;line-height:2;">
              <li>Your listing is now <strong>dormant</strong> \u2014 buyers cannot view it.</li>
              <li>Renew your subscription to reactivate your listing.</li>
              <li>If you don't renew, your listing will remain hidden.</li>
            </ul>
          </div>
          <a href="${renewUrl}" style="display:inline-block;background:linear-gradient(135deg,#d97706,#b45309);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;margin-bottom:24px;">Renew My Subscription \u2192</a>
          <hr style="border:none;border-top:1px solid #fed7aa;margin:0 0 20px;" />
          <p style="font-size:13px;color:#6b7280;margin:0;">Questions? <a href="mailto:support@piitrade.com" style="color:#d97706;font-weight:600;">support@piitrade.com</a></p>
        </td></tr>
        <tr><td style="background:#fff7ed;padding:16px 40px;border-top:1px solid #fed7aa;">
          <p style="font-size:12px;color:#9ca3af;margin:0;text-align:center;">&copy; ${new Date().getFullYear()} 3R Elite Marketplace. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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
  const profileSection = likerProfileUrl
    ? `<a href="${likerProfileUrl}" style="color:#0284c7;font-weight:600;text-decoration:none;">${likerName}</a>`
    : `<strong>${likerName}</strong>`;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;font-family:Inter,Helvetica Neue,Arial,sans-serif;background:#fff1f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(219,39,119,0.10);">
        <tr><td style="background:linear-gradient(135deg,#db2777 0%,#be185d 60%,#9d174d 100%);padding:36px 40px 28px;">
          <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:8px;">
            <div style="width:40px;height:40px;background:rgba(197,160,89,0.2);border:2px solid rgba(197,160,89,0.4);border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:900;color:#C5A059;font-size:16px;line-height:40px;text-align:center;">3R</div>
            <span style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">3R <em style="font-style:italic;">Elite</em></span>
          </div>
          <p style="color:rgba(255,255,255,0.9);font-size:14px;margin:4px 0 0;">Listing Activity</p>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          <h1 style="font-size:24px;font-weight:800;color:#db2777;margin:0 0 12px;">Someone liked your listing! ❤️</h1>
          <p style="font-size:16px;color:#374151;line-height:1.7;margin:0 0 12px;">Hi ${ownerName},</p>
          <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 16px;">
            ${profileSection} just liked your listing <strong style="color:#db2777;">${listingTitle}</strong>. This is a great sign — your listing is getting attention!
          </p>
          <div style="background:#fff1f5;border:1.5px solid #fbcfe8;border-radius:16px;padding:20px;margin-bottom:24px;">
            <p style="font-size:13px;font-weight:700;color:#9d174d;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.05em;">Liked by</p>
            <p style="font-size:16px;font-weight:800;color:#db2777;margin:0;">${likerName}</p>
          </div>
          <a href="${listingUrl}" style="display:inline-block;background:linear-gradient(135deg,#db2777,#be185d);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;margin-bottom:24px;">View Your Listing →</a>
          <hr style="border:none;border-top:1px solid #fbcfe8;margin:0 0 20px;" />
          <p style="font-size:13px;color:#6b7280;margin:0;">Questions? <a href="mailto:support@piitrade.com" style="color:#db2777;font-weight:600;">support@piitrade.com</a></p>
        </td></tr>
        <tr><td style="background:#fff1f5;padding:16px 40px;border-top:1px solid #fbcfe8;">
          <p style="font-size:12px;color:#9ca3af;margin:0;text-align:center;">&copy; ${new Date().getFullYear()} 3R Elite Marketplace. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  await send(to, subject, html);
}

export async function sendSubscriptionActivatedEmail(to: string, name: string, packageName: string, expiresAt: Date): Promise<void> {
  const expiryStr = expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject = `Your ${packageName} subscription is now active \ud83c\udf89`;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;font-family:Inter,Helvetica Neue,Arial,sans-serif;background:#f0fdf4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(22,163,74,0.10);">
        <tr><td style="background:linear-gradient(135deg,#16a34a 0%,#15803d 60%,#166534 100%);padding:36px 40px 28px;">
          <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:8px;">
            <div style="width:40px;height:40px;background:rgba(255,255,255,0.2);border:2px solid rgba(255,255,255,0.4);border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:900;color:#ffffff;font-size:16px;line-height:40px;text-align:center;">3R</div>
            <span style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">3R <em style="font-style:italic;">Elite</em></span>
          </div>
          <p style="color:rgba(255,255,255,0.9);font-size:14px;margin:4px 0 0;">Subscription Activated</p>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          <h1 style="font-size:24px;font-weight:800;color:#16a34a;margin:0 0 12px;">Subscription Activated! \ud83c\udf89</h1>
          <p style="font-size:16px;color:#374151;line-height:1.7;margin:0 0 12px;">Hi ${name},</p>
          <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 16px;">
            Your <strong style="color:#16a34a;">${packageName}</strong> subscription has been approved and is now active. You can now post listings on the marketplace.
          </p>
          <div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:16px;padding:20px;margin-bottom:24px;">
            <p style="font-size:13px;font-weight:700;color:#15803d;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.05em;">Active until</p>
            <p style="font-size:20px;font-weight:800;color:#16a34a;margin:0;">${expiryStr}</p>
          </div>
          <a href="${FRONTEND_URL}/listings/create" style="display:inline-block;background:linear-gradient(135deg,#16a34a,#15803d);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;margin-bottom:24px;">Post a Listing \u2192</a>
          <hr style="border:none;border-top:1px solid #dcfce7;margin:0 0 20px;" />
          <p style="font-size:13px;color:#6b7280;margin:0;">Questions? <a href="mailto:support@piitrade.com" style="color:#16a34a;font-weight:600;">support@piitrade.com</a></p>
        </td></tr>
        <tr><td style="background:#f0fdf4;padding:16px 40px;border-top:1px solid #dcfce7;">
          <p style="font-size:12px;color:#9ca3af;margin:0;text-align:center;">&copy; ${new Date().getFullYear()} 3R Elite Marketplace. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  await send(to, subject, html);
}
