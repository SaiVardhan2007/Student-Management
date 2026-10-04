import { Router } from 'express';
import { protect, authorize, studentProfile } from '../middleware/auth.js';
import { validate, z, objectId, dateField } from '../middleware/validate.js';
import { Company, Job, Application, Student, APPLICATION_STATUSES } from '../models/index.js';
import { crud } from '../controllers/crud.js';
import { asyncHandler, ok, created, paginate, filtersFromQuery, requireValidId } from '../utils/http.js';
import { AppError } from '../utils/AppError.js';
import { cgpaOf } from '../services/grading.js';
import { notifyUsers, notifyStudents } from '../services/notify.js';
import { audit } from '../services/audit.js';

const r = Router();
r.use(protect);
const admin = authorize('admin');

const companySchema = z.object({
  name: z.string().trim().min(2).max(150),
  website: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(100).optional(),
  description: z.string().trim().max(1000).optional(),
});
const jobSchema = z.object({
  company: objectId,
  title: z.string().trim().min(2).max(150),
  description: z.string().trim().max(3000).optional(),
  location: z.string().trim().max(100).optional(),
  package: z.coerce.number().min(0).max(1000000000).optional(),
  deadline: dateField,
  isPublished: z.boolean().optional(),
  eligibility: z
    .object({
      minCgpa: z.coerce.number().min(0).max(10).default(0),
      programs: z.array(objectId).default([]),
      maxActiveBacklogs: z.coerce.number().int().min(0).default(0),
    })
    .default({}),
});
const statusSchema = z.object({ status: z.enum(APPLICATION_STATUSES) });

const companies = crud({
  Model: Company,
  entity: 'Company',
  searchFields: ['name', 'industry'],
  allowedSort: ['name'],
  defaultSort: { name: 1 },
  dependents: [{ Model: Job, field: 'company', label: 'job opening(s)' }],
});
r.get('/companies', admin, companies.list);
r.post('/companies', admin, validate(companySchema), companies.create);
r.patch('/companies/:id', admin, validate(companySchema.partial()), companies.update);
r.delete('/companies/:id', admin, companies.remove);

function eligibility(job, student, cgpa) {
  const reasons = [];
  if (job.eligibility?.minCgpa && cgpa < job.eligibility.minCgpa)
    reasons.push(`Minimum CGPA ${job.eligibility.minCgpa} required (yours: ${cgpa})`);
  if (job.eligibility?.programs?.length && !job.eligibility.programs.some((p) => String(p._id || p) === String(student.program)))
    reasons.push('Your program is not eligible');
  if (student.status !== 'active') reasons.push('Only active students can apply');
  if (new Date(job.deadline) < new Date()) reasons.push('Application deadline has passed');
  return { eligible: !reasons.length, reasons };
}

const JOB_POP = [
  { path: 'company', select: 'name website industry' },
  { path: 'eligibility.programs', select: 'name code' },
];

r.get(
  '/jobs',
  authorize('admin', 'student'),
  asyncHandler(async (req, res) => {
    const filter = filtersFromQuery(req.query, { company: 'id' });
    if (req.user.role === 'student') filter.isPublished = true;
    else if (req.query.isPublished) filter.isPublished = req.query.isPublished === 'true';
    const { items, meta } = await paginate(Job, req, {
      filter,
      searchFields: ['title', 'location'],
      allowedSort: ['deadline', 'package', 'title'],
      defaultSort: { deadline: -1 },
      populate: JOB_POP,
    });
    let out = items;
    if (req.user.role === 'student') {
      const s = await studentProfile(req);
      const cgpa = await cgpaOf(s._id);
      const apps = await Application.find({ student: s._id, job: { $in: items.map((j) => j._id) } })
        .select('job status')
        .lean();
      const map = new Map(apps.map((a) => [String(a.job), a.status]));
      out = items.map((j) => ({ ...j, ...eligibility(j, s, cgpa), applicationStatus: map.get(String(j._id)) || null }));
    }
    ok(res, out, 'OK', 200, meta);
  })
);

r.post(
  '/jobs',
  admin,
  validate(jobSchema),
  asyncHandler(async (req, res) => {
    if (!(await Company.exists({ _id: req.body.company }))) throw AppError.badRequest('Company not found');
    const j = await Job.create(req.body);
    if (j.isPublished) await notifyStudents({}, { title: 'New placement drive', message: j.title, type: 'placement', link: '/placements' });
    await audit(req, 'JOB_CREATED', 'Job', j._id);
    created(res, j, 'Job opening created');
  })
);

r.patch(
  '/jobs/:id',
  admin,
  validate(jobSchema.partial()),
  asyncHandler(async (req, res) => {
    requireValidId(req.params.id);
    const j = await Job.findById(req.params.id);
    if (!j) throw AppError.notFound('Job not found');
    const wasPublished = j.isPublished;
    j.set(req.body);
    await j.save();
    if (!wasPublished && j.isPublished)
      await notifyStudents({}, { title: 'New placement drive', message: j.title, type: 'placement', link: '/placements' });
    await audit(req, 'JOB_UPDATED', 'Job', j._id);
    ok(res, j, 'Job updated');
  })
);

r.delete(
  '/jobs/:id',
  admin,
  asyncHandler(async (req, res) => {
    requireValidId(req.params.id);
    const j = await Job.findById(req.params.id);
    if (!j) throw AppError.notFound('Job not found');
    await Application.deleteMany({ job: j._id });
    await j.deleteOne();
    ok(res, null, 'Job deleted');
  })
);

r.post(
  '/jobs/:id/apply',
  authorize('student'),
  asyncHandler(async (req, res) => {
    requireValidId(req.params.id);
    const job = await Job.findOne({ _id: req.params.id, isPublished: true });
    if (!job) throw AppError.notFound('Job not found');
    const s = await studentProfile(req);
    const chk = eligibility(job, s, await cgpaOf(s._id));
    if (!chk.eligible)
      throw AppError.badRequest(
        `You are not eligible: ${chk.reasons.join('; ')}`,
        chk.reasons.map((m) => ({ field: 'eligibility', message: m }))
      );
    if (await Application.exists({ job: job._id, student: s._id })) throw AppError.conflict('You have already applied to this job');
    const a = await Application.create({ job: job._id, student: s._id, history: [{ status: 'applied', by: req.user._id }] });
    await audit(req, 'JOB_APPLIED', 'Application', a._id);
    created(res, a, 'Application submitted');
  })
);

r.get(
  '/applications',
  authorize('admin', 'student'),
  asyncHandler(async (req, res) => {
    const filter = filtersFromQuery(req.query, { job: 'id', status: 'string', student: 'id' });
    if (req.user.role === 'student') filter.student = (await studentProfile(req))._id;
    const { items, meta } = await paginate(Application, req, {
      filter,
      allowedSort: ['createdAt', 'status'],
      populate: [
        { path: 'student', select: 'studentId firstName lastName' },
        { path: 'job', select: 'title package company', populate: { path: 'company', select: 'name' } },
      ],
    });
    ok(res, items, 'OK', 200, meta);
  })
);

r.patch(
  '/applications/:id/status',
  admin,
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    requireValidId(req.params.id);
    const a = await Application.findById(req.params.id).populate('job', 'title');
    if (!a) throw AppError.notFound('Application not found');
    a.status = req.body.status;
    a.history.push({ status: a.status, by: req.user._id });
    await a.save();
    const s = await Student.findById(a.student).select('user');
    if (s?.user)
      await notifyUsers([s.user], {
        title: `Application update: ${a.status}`,
        message: a.job?.title,
        type: 'placement',
        link: '/placements',
      });
    await audit(req, 'APPLICATION_STATUS_CHANGED', 'Application', a._id, { status: a.status });
    ok(res, a, 'Status updated');
  })
);

export default r;
