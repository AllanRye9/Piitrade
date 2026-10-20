import { Router, Response, NextFunction } from 'express';
import { KycDocumentType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

const router = Router();

const VALID_DOCUMENT_TYPES: KycDocumentType[] = [
  'NATIONAL_ID',
  'PASSPORT',
  'DRIVERS_LICENSE',
  'BUSINESS_LICENSE',
];

// Document types that require both a front and a back upload. Everything
// else (passport identity page, business licence) is a single document —
// see Doc 2 §4 / Doc 1 Cluster 4: "require only the passport's
// identity/information page... do not require a back-side upload."
const KYC_PURPOSES = ['PERSONAL', 'WEBSTORE', 'PARTNER'];

const TWO_SIDED_DOCUMENT_TYPES: KycDocumentType[] = ['NATIONAL_ID', 'DRIVERS_LICENSE'];

/**
 * GET /api/kyc/status
 * Authenticated — returns the current user's own KYC state so the frontend
 * can show "not started / pending review / approved / rejected" UI.
 */
router.get('/status', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        kycStatus: true,
        kycDocumentType: true,
        kycDocumentUrl: true,
        kycDocumentBackUrl: true,
        kycSelfieUrl: true,
        kycFullName: true,
        kycSubmittedAt: true,
        kycReviewedAt: true,
        kycRejectionReason: true,
        kycPurpose: true,
        kycBusinessName: true,
        kycBusinessRegNumber: true,
        kycPhone: true,
        kycAddress: true,
      },
    });
    if (!user) return next(createError('User not found', 404));
    res.json(user);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/kyc/draft
 * Authenticated — returns the current user's in-progress (not yet
 * submitted) verification draft, if any, so the frontend can restore the
 * form after a refresh, closed tab, dropped connection, or navigation away
 * mid-flow. Draft documents were already uploaded server-side via
 * POST /api/upload/kyc-document when originally selected (see PUT
 * /api/kyc/draft below), so this never has to touch browser storage.
 */
router.get('/draft', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        kycDraftDocumentType: true,
        kycDraftFullName: true,
        kycDraftDocumentUrl: true,
        kycDraftDocumentBackUrl: true,
        kycDraftSelfieUrl: true,
        kycDraftUpdatedAt: true,
      },
    });
    if (!user) return next(createError('User not found', 404));
    res.json(user);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/kyc/draft
 * Authenticated — upserts the in-progress verification draft. Called
 * whenever the user changes the document type / full name, or right after
 * a document image finishes uploading, so partial progress is never lost.
 * Every field is optional and only provided fields are updated, so the
 * frontend can save each change (e.g. just a new documentUrl) independently
 * without having to resend the whole form.
 */
router.put('/draft', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { documentType, fullName, documentUrl, documentBackUrl, selfieUrl } = req.body;

    if (documentType !== undefined && documentType !== null && !VALID_DOCUMENT_TYPES.includes(documentType)) {
      return next(createError(`documentType must be one of: ${VALID_DOCUMENT_TYPES.join(', ')}`, 400));
    }

    const data: Record<string, unknown> = { kycDraftUpdatedAt: new Date() };
    if (documentType !== undefined) data.kycDraftDocumentType = documentType || null;
    if (fullName !== undefined) data.kycDraftFullName = typeof fullName === 'string' ? fullName.slice(0, 200) : null;
    if (documentUrl !== undefined) data.kycDraftDocumentUrl = documentUrl || null;
    if (documentBackUrl !== undefined) data.kycDraftDocumentBackUrl = documentBackUrl || null;
    if (selfieUrl !== undefined) data.kycDraftSelfieUrl = selfieUrl || null;

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data,
      select: {
        kycDraftDocumentType: true,
        kycDraftFullName: true,
        kycDraftDocumentUrl: true,
        kycDraftDocumentBackUrl: true,
        kycDraftSelfieUrl: true,
        kycDraftUpdatedAt: true,
      },
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/kyc/draft
 * Authenticated — discards the in-progress draft (e.g. the user manually
 * clears the form, or switches document type in a way that invalidates
 * prior uploads). POST /kyc/submit also clears the draft automatically on
 * a successful submission.
 */
router.delete('/draft', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        kycDraftDocumentType: null,
        kycDraftFullName: null,
        kycDraftDocumentUrl: null,
        kycDraftDocumentBackUrl: null,
        kycDraftSelfieUrl: null,
        kycDraftUpdatedAt: null,
      },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/kyc/submit
 * Authenticated — submit (or resubmit after a rejection) identity documents
 * for review. Document/selfie files must already be uploaded via
 * POST /api/upload and their returned CDN URLs passed here.
 *
 * documentBackUrl is required for two-sided document types (national ID,
 * driver's licence) and rejected for single-sided ones (passport, business
 * licence) — the requirement is driven entirely by documentType, so the
 * frontend can't submit a mismatched pair by mistake.
 */
router.post('/submit', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { documentType, documentUrl, documentBackUrl, selfieUrl, fullName } = req.body;

    // ── Brief standard form ─────────────────────────────────────────────────────
    // A Webstore or Partner verification also needs who/where the business is and how to reach it.
    // A personal verification (just selling as an individual) stays document-only as before.
    const purpose = String(req.body.purpose ?? 'PERSONAL').toUpperCase();
    if (!KYC_PURPOSES.includes(purpose)) {
      return next(createError(`purpose must be one of: ${KYC_PURPOSES.join(', ')}`, 400));
    }
    const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const businessName = clean(req.body.businessName, 160);
    const businessRegNumber = clean(req.body.businessRegNumber, 80);
    const phone = clean(req.body.phone, 30);
    const address = clean(req.body.address, 300);
    if (purpose !== 'PERSONAL') {
      if (businessName.length < 2) return next(createError('Business or store name is required', 400));
      if (!/^\+?[0-9][0-9\s-]{7,18}$/.test(phone)) return next(createError('Enter a valid contact phone number', 400));
      if (address.length < 5) return next(createError('Business address is required', 400));
    }

    if (!documentType || !VALID_DOCUMENT_TYPES.includes(documentType)) {
      return next(createError(`documentType must be one of: ${VALID_DOCUMENT_TYPES.join(', ')}`, 400));
    }
    if (!documentUrl || typeof documentUrl !== 'string') {
      return next(createError('documentUrl is required — upload the document via /api/upload first', 400));
    }
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      return next(createError('fullName is required', 400));
    }

    const requiresBack = TWO_SIDED_DOCUMENT_TYPES.includes(documentType);
    if (requiresBack && (!documentBackUrl || typeof documentBackUrl !== 'string')) {
      return next(createError('Please upload the back of your ID.', 400));
    }
    // For single-sided types (passport, business licence) any stray
    // documentBackUrl left over from switching document types is simply
    // discarded below rather than validated against.

    const existing = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { kycStatus: true },
    });
    if (existing?.kycStatus === 'PENDING') {
      return next(createError('Your KYC submission is already pending review', 409));
    }
    if (existing?.kycStatus === 'APPROVED') {
      return next(createError('You are already a KYC-verified seller', 409));
    }

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        kycStatus: 'PENDING',
        kycDocumentType: documentType,
        kycDocumentUrl: documentUrl,
        kycDocumentBackUrl: requiresBack ? documentBackUrl : null,
        kycSelfieUrl: selfieUrl || null,
        kycFullName: fullName.trim(),
        kycSubmittedAt: new Date(),
        kycReviewedAt: null,
        kycReviewedBy: null,
        kycRejectionReason: null,
        kycPurpose: purpose,
        kycBusinessName: purpose === 'PERSONAL' ? null : businessName,
        kycBusinessRegNumber: purpose === 'PERSONAL' ? null : businessRegNumber || null,
        kycPhone: purpose === 'PERSONAL' ? null : phone,
        kycAddress: purpose === 'PERSONAL' ? null : address,
        // A successful submission promotes the draft to a real submission,
        // so the draft itself is no longer needed — clear it rather than
        // leaving stale in-progress data behind.
        kycDraftDocumentType: null,
        kycDraftFullName: null,
        kycDraftDocumentUrl: null,
        kycDraftDocumentBackUrl: null,
        kycDraftSelfieUrl: null,
        kycDraftUpdatedAt: null,
      },
      select: {
        kycStatus: true,
        kycDocumentType: true,
        kycSubmittedAt: true,
      },
    });

    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

export default router;
