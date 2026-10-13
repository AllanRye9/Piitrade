"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
const router = (0, express_1.Router)();
const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Freelance', 'Internship', 'Temporary'];
const JOB_CATEGORIES = [
    'Technology', 'Finance', 'Healthcare', 'Education', 'Engineering',
    'Sales & Marketing', 'Admin & Support', 'Design & Creative',
    'Legal', 'Logistics & Transport', 'Hospitality', 'Construction', 'Other',
];
const QUALIFICATIONS = ["None Required", "High School", "Diploma", "Bachelor's", "Master's", "PhD", "Professional Cert"];
const COUNTRIES = ['UGANDA'];
router.get('/meta', (_req, res) => {
    res.json({
        categories: JOB_CATEGORIES,
        types: JOB_TYPES,
        qualifications: QUALIFICATIONS,
        countries: COUNTRIES,
    });
});
function normalizeEmploymentType(input) {
    if (typeof input !== 'string')
        return null;
    const value = input.trim().toLowerCase();
    if (!value)
        return null;
    const mapped = {
        'full-time': 'Full-time',
        'full time': 'Full-time',
        'part-time': 'Part-time',
        'part time': 'Part-time',
        contract: 'Contract',
        freelance: 'Freelance',
        internship: 'Internship',
        temporary: 'Temporary',
    };
    return mapped[value] ?? null;
}
// GET /api/jobs — public, filterable
router.get('/', auth_1.optionalAuthenticate, async (req, res, next) => {
    try {
        const { country, type, employmentType, category, industry, role, location, q, status, page = '1', limit = '50', } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
        const isPrivileged = req.user?.role === 'ADMIN' || req.user?.role === 'AGENT';
        const selectedType = normalizeEmploymentType(employmentType || type);
        const selectedIndustry = (industry || category || '').trim();
        const selectedRole = (role || '').trim();
        const selectedLocation = (location || '').trim();
        const statusFilter = isPrivileged ? status : 'ACTIVE';
        const where = {
            ...(statusFilter ? { status: statusFilter } : {}),
            ...(country && COUNTRIES.includes(country) && { country }),
            ...(selectedType && { type: { equals: selectedType, mode: 'insensitive' } }),
            ...(selectedIndustry && { category: { contains: selectedIndustry, mode: 'insensitive' } }),
            ...(selectedLocation && { location: { contains: selectedLocation, mode: 'insensitive' } }),
            ...(selectedRole && { title: { contains: selectedRole, mode: 'insensitive' } }),
            ...(q && {
                OR: [
                    { title: { contains: q, mode: 'insensitive' } },
                    { company: { contains: q, mode: 'insensitive' } },
                    { description: { contains: q, mode: 'insensitive' } },
                    { location: { contains: q, mode: 'insensitive' } },
                    { category: { contains: q, mode: 'insensitive' } },
                    { type: { contains: q, mode: 'insensitive' } },
                ],
            }),
        };
        const [jobs, total] = await Promise.all([
            prisma_1.prisma.jobPost.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (pageNum - 1) * limitNum,
                take: limitNum,
            }),
            prisma_1.prisma.jobPost.count({ where }),
        ]);
        res.json({
            jobs,
            pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
        });
    }
    catch (err) {
        next(err);
    }
});
// ─── Applications (the ONLY way a CV reaches a recruiter) ────────────────────
// GET /api/jobs/applications/mine — the caller's own applications (drives the
// "Applied" state on the board). Declared before /:id so it is not shadowed.
router.get('/applications/mine', auth_1.authenticate, async (req, res, next) => {
    try {
        const applications = await prisma_1.prisma.jobApplication.findMany({
            where: { applicantId: req.user.userId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true, jobId: true, status: true, createdAt: true,
                job: { select: { title: true, company: true } },
            },
        });
        res.json({ applications });
    }
    catch (err) {
        next(err);
    }
});
// PATCH /api/jobs/applications/:id — poster/admin sets SUBMITTED | SHORTLISTED | REJECTED
router.patch('/applications/:id', auth_1.authenticate, async (req, res, next) => {
    try {
        const application = await prisma_1.prisma.jobApplication.findUnique({
            where: { id: req.params.id },
            include: { job: { select: { postedById: true, title: true } } },
        });
        if (!application)
            return next((0, errorHandler_1.createError)('Application not found', 404));
        if (application.job.postedById !== req.user.userId && req.user.role !== 'ADMIN') {
            return next((0, errorHandler_1.createError)('Not authorised', 403));
        }
        const { status } = req.body;
        if (status !== 'SUBMITTED' && status !== 'SHORTLISTED' && status !== 'REJECTED') {
            return next((0, errorHandler_1.createError)("status must be 'SUBMITTED', 'SHORTLISTED' or 'REJECTED'", 400));
        }
        const updated = await prisma_1.prisma.jobApplication.update({ where: { id: application.id }, data: { status } });
        if (status !== application.status && status !== 'SUBMITTED') {
            await prisma_1.prisma.notification.create({
                data: {
                    userId: application.applicantId,
                    type: 'SYSTEM',
                    title: status === 'SHORTLISTED' ? 'You were shortlisted' : 'Application update',
                    message: status === 'SHORTLISTED'
                        ? `Good news — you were shortlisted for "${application.job.title}".`
                        : `Your application for "${application.job.title}" was not taken forward.`,
                    data: { jobId: application.jobId, applicationId: application.id },
                },
            }).catch(() => { });
        }
        res.json({ application: updated });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/jobs/:id/apply — { documentId, coverNote?, phone? }
// documentId must be one of the applicant's OWN documents of type CV.
router.post('/:id/apply', auth_1.authenticate, async (req, res, next) => {
    try {
        const job = await prisma_1.prisma.jobPost.findUnique({ where: { id: req.params.id } });
        if (!job || job.status !== 'ACTIVE')
            return next((0, errorHandler_1.createError)('This job is no longer open for applications.', 404));
        if (job.postedById === req.user.userId)
            return next((0, errorHandler_1.createError)('You cannot apply to your own job posting.', 400));
        const { documentId, coverNote, phone } = req.body;
        if (typeof documentId !== 'string' || !documentId) {
            return next((0, errorHandler_1.createError)('Please choose a CV to attach to your application.', 400));
        }
        const doc = await prisma_1.prisma.userDocument.findUnique({ where: { id: documentId } });
        if (!doc || doc.userId !== req.user.userId || doc.type !== 'CV') {
            return next((0, errorHandler_1.createError)('Please choose one of your own CV documents.', 400));
        }
        const note = typeof coverNote === 'string' ? coverNote.trim().slice(0, 2000) : '';
        const contactPhone = typeof phone === 'string' ? phone.trim().slice(0, 40) : '';
        let application;
        try {
            application = await prisma_1.prisma.jobApplication.create({
                data: {
                    jobId: job.id,
                    applicantId: req.user.userId,
                    documentId: doc.id,
                    cvTitle: doc.title,
                    coverNote: note || null,
                    phone: contactPhone || null,
                },
            });
        }
        catch (e) {
            if (e?.code === 'P2002') {
                return next((0, errorHandler_1.createError)('You have already applied to this job.', 409));
            }
            throw e;
        }
        await prisma_1.prisma.notification.create({
            data: {
                userId: job.postedById,
                type: 'SYSTEM',
                title: 'New job application',
                message: `Someone applied for "${job.title}". Open the job's applications to review their CV.`,
                data: { jobId: job.id, applicationId: application.id },
            },
        }).catch(() => { });
        res.status(201).json({ application: { id: application.id, jobId: job.id, status: application.status } });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/jobs/:id/applications — the job's poster (or an admin) only
router.get('/:id/applications', auth_1.authenticate, async (req, res, next) => {
    try {
        const job = await prisma_1.prisma.jobPost.findUnique({ where: { id: req.params.id }, select: { id: true, title: true, company: true, postedById: true } });
        if (!job)
            return next((0, errorHandler_1.createError)('Job not found', 404));
        if (job.postedById !== req.user.userId && req.user.role !== 'ADMIN') {
            return next((0, errorHandler_1.createError)('Not authorised', 403));
        }
        const applications = await prisma_1.prisma.jobApplication.findMany({
            where: { jobId: job.id },
            orderBy: { createdAt: 'desc' },
        });
        const ids = [...new Set(applications.map((a) => a.applicantId))];
        const users = ids.length
            ? await prisma_1.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, phone: true, avatar: true, country: true } })
            : [];
        const byId = new Map(users.map((u) => [u.id, u]));
        res.json({
            job: { id: job.id, title: job.title, company: job.company },
            applications: applications.map((a) => ({ ...a, applicant: byId.get(a.applicantId) ?? null })),
        });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/jobs/:id — public for active jobs
router.get('/:id', auth_1.optionalAuthenticate, async (req, res, next) => {
    try {
        const job = await prisma_1.prisma.jobPost.findUnique({ where: { id: req.params.id } });
        if (!job)
            return next((0, errorHandler_1.createError)('Job not found', 404));
        const isPrivileged = req.user?.role === 'ADMIN' || req.user?.role === 'AGENT';
        if (!isPrivileged && job.status !== 'ACTIVE')
            return next((0, errorHandler_1.createError)('Job not found', 404));
        res.json(job);
    }
    catch (err) {
        next(err);
    }
});
// POST /api/jobs — admin/agent/company/organization
router.post('/', auth_1.authenticate, async (req, res, next) => {
    try {
        const posterRole = req.user.role;
        if (!['ADMIN', 'AGENT', 'COMPANY', 'ORGANIZATION'].includes(posterRole)) {
            return next((0, errorHandler_1.createError)('Only admins, agents, companies, and organizations can post jobs', 403));
        }
        const { title, company, location, type, category, qualification, description, salary, deadline, imageUrl, country } = req.body;
        if (!title?.trim() || !company?.trim() || !description?.trim()) {
            return next((0, errorHandler_1.createError)('Title, company and description are required', 400));
        }
        const normalizedType = normalizeEmploymentType(type) || 'Full-time';
        const job = await prisma_1.prisma.jobPost.create({
            data: {
                title: title.trim(),
                company: company.trim(),
                location: location?.trim() || '',
                type: normalizedType,
                category: JOB_CATEGORIES.includes(category) ? category : 'Other',
                qualification: QUALIFICATIONS.includes(qualification) ? qualification : 'None Required',
                description: description.trim(),
                salary: salary?.trim() || null,
                deadline: deadline?.trim() || null,
                imageUrl: imageUrl?.trim() || null,
                country: COUNTRIES.includes(country) ? country : 'UGANDA',
                status: posterRole === 'ADMIN' ? 'ACTIVE' : 'DRAFT',
                postedById: req.user.userId,
            },
        });
        res.status(201).json({
            job,
            moderation: posterRole === 'ADMIN' ? 'published' : 'pending_approval',
            message: posterRole === 'ADMIN'
                ? 'Job published successfully.'
                : 'Job submitted successfully and is pending admin approval.',
        });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/jobs/:id — admin/agent only
router.put('/:id', auth_1.authenticate, async (req, res, next) => {
    try {
        if (req.user.role !== 'ADMIN' && req.user.role !== 'AGENT') {
            return next((0, errorHandler_1.createError)('Only admins and agents can update jobs', 403));
        }
        const existing = await prisma_1.prisma.jobPost.findUnique({ where: { id: req.params.id } });
        if (!existing)
            return next((0, errorHandler_1.createError)('Job not found', 404));
        const { title, company, location, type, category, qualification, description, salary, deadline, imageUrl, country, status } = req.body;
        const validStatuses = ['ACTIVE', 'CLOSED', 'DRAFT'];
        const normalizedType = normalizeEmploymentType(type);
        const job = await prisma_1.prisma.jobPost.update({
            where: { id: req.params.id },
            data: {
                ...(title?.trim() && { title: title.trim() }),
                ...(company?.trim() && { company: company.trim() }),
                ...(location !== undefined && { location: location?.trim() || '' }),
                ...(normalizedType && { type: normalizedType }),
                ...(category && JOB_CATEGORIES.includes(category) && { category }),
                ...(qualification && QUALIFICATIONS.includes(qualification) && { qualification }),
                ...(description?.trim() && { description: description.trim() }),
                ...('salary' in req.body && { salary: salary?.trim() || null }),
                ...('deadline' in req.body && { deadline: deadline?.trim() || null }),
                ...('imageUrl' in req.body && { imageUrl: imageUrl?.trim() || null }),
                ...(country && COUNTRIES.includes(country) && { country }),
                ...(status && validStatuses.includes(status) && { status }),
            },
        });
        res.json(job);
    }
    catch (err) {
        next(err);
    }
});
// DELETE /api/jobs/:id — admin/agent only
router.delete('/:id', auth_1.authenticate, async (req, res, next) => {
    try {
        if (req.user.role !== 'ADMIN' && req.user.role !== 'AGENT') {
            return next((0, errorHandler_1.createError)('Only admins and agents can delete jobs', 403));
        }
        const existing = await prisma_1.prisma.jobPost.findUnique({ where: { id: req.params.id } });
        if (!existing)
            return next((0, errorHandler_1.createError)('Job not found', 404));
        await prisma_1.prisma.jobPost.delete({ where: { id: req.params.id } });
        res.json({ message: 'Job deleted' });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=jobs.js.map