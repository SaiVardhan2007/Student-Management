import { Company, Job, Application, Student } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { paginate, filtersFromQuery, requireValidId } from '@/lib/query';
import { studentProfile } from '@/lib/auth';
import type { Ctx } from '@/lib/context';
import { crud } from '@/services/crud';
import { cgpaOf } from '@/services/grading';
import { notifyUsers, notifyStudents } from '@/services/notify';
import { audit } from '@/services/audit';

export const companies = crud({
  Model: Company,
  entity: 'Company',
  searchFields: ['name', 'industry'],
  allowedSort: ['name'],
  defaultSort: { name: 1 },
  dependents: [{ Model: Job, field: 'company', label: 'job opening(s)' }],
});

function eligibility(job: any, student: any, cgpa: number) {
  const reasons: string[] = [];
  if (job.eligibility?.minCgpa && cgpa < job.eligibility.minCgpa)
    reasons.push(`Minimum CGPA ${job.eligibility.minCgpa} required (yours: ${cgpa})`);
  if (job.eligibility?.programs?.length && !job.eligibility.programs.some((p: any) => String(p._id || p) === String(student.program)))
    reasons.push('Your program is not eligible');
  if (student.status !== 'active') reasons.push('Only active students can apply');
  if (new Date(job.deadline) < new Date()) reasons.push('Application deadline has passed');
  return { eligible: !reasons.length, reasons };
}

const JOB_POP = [
  { path: 'company', select: 'name website industry' },
  { path: 'eligibility.programs', select: 'name code' },
];

export async function listJobs(ctx: Ctx) {
  const filter = filtersFromQuery(ctx.query, { company: 'id' });
  if (ctx.user.role === 'student') filter.isPublished = true;
  else if (ctx.query.isPublished) filter.isPublished = ctx.query.isPublished === 'true';
  const { items, meta } = await paginate(Job, ctx, {
    filter,
    searchFields: ['title', 'location'],
    allowedSort: ['deadline', 'package', 'title'],
    defaultSort: { deadline: -1 },
    populate: JOB_POP,
  });
  let out: any[] = items;
  if (ctx.user.role === 'student') {
    const s = await studentProfile(ctx);
    const cgpa = await cgpaOf(s._id);
    const apps = await Application.find({ student: s._id, job: { $in: items.map((j) => j._id) } })
      .select('job status')
      .lean();
    const map = new Map(apps.map((a: any) => [String(a.job), a.status]));
    out = items.map((j) => ({ ...j, ...eligibility(j, s, cgpa), applicationStatus: map.get(String(j._id)) || null }));
  }
  return ok(out, 'OK', 200, meta);
}

export async function createJob(ctx: Ctx) {
  if (!(await Company.exists({ _id: ctx.body.company }))) throw AppError.badRequest('Company not found');
  const j = await Job.create(ctx.body);
  if (j.isPublished) await notifyStudents({}, { title: 'New placement drive', message: j.title, type: 'placement', link: '/placements' });
  await audit(ctx, 'JOB_CREATED', 'Job', j._id);
  return created(j, 'Job opening created');
}

export async function updateJob(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const j = await Job.findById(ctx.params.id);
  if (!j) throw AppError.notFound('Job not found');
  const wasPublished = j.isPublished;
  j.set(ctx.body);
  await j.save();
  if (!wasPublished && j.isPublished)
    await notifyStudents({}, { title: 'New placement drive', message: j.title, type: 'placement', link: '/placements' });
  await audit(ctx, 'JOB_UPDATED', 'Job', j._id);
  return ok(j, 'Job updated');
}

export async function deleteJob(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const j = await Job.findById(ctx.params.id);
  if (!j) throw AppError.notFound('Job not found');
  await Application.deleteMany({ job: j._id });
  await j.deleteOne();
  return ok(null, 'Job deleted');
}

export async function apply(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const job = await Job.findOne({ _id: ctx.params.id, isPublished: true });
  if (!job) throw AppError.notFound('Job not found');
  const s = await studentProfile(ctx);
  const chk = eligibility(job, s, await cgpaOf(s._id));
  if (!chk.eligible)
    throw AppError.badRequest(
      `You are not eligible: ${chk.reasons.join('; ')}`,
      chk.reasons.map((m) => ({ field: 'eligibility', message: m }))
    );
  if (await Application.exists({ job: job._id, student: s._id })) throw AppError.conflict('You have already applied to this job');
  const a = await Application.create({ job: job._id, student: s._id, history: [{ status: 'applied', by: ctx.user._id }] });
  await audit(ctx, 'JOB_APPLIED', 'Application', a._id);
  return created(a, 'Application submitted');
}

export async function listApplications(ctx: Ctx) {
  const filter = filtersFromQuery(ctx.query, { job: 'id', status: 'string', student: 'id' });
  if (ctx.user.role === 'student') filter.student = (await studentProfile(ctx))._id;
  const { items, meta } = await paginate(Application, ctx, {
    filter,
    allowedSort: ['createdAt', 'status'],
    populate: [
      { path: 'student', select: 'studentId firstName lastName' },
      { path: 'job', select: 'title package company', populate: { path: 'company', select: 'name' } },
    ],
  });
  return ok(items, 'OK', 200, meta);
}

export async function updateApplicationStatus(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const a = await Application.findById(ctx.params.id).populate('job', 'title');
  if (!a) throw AppError.notFound('Application not found');
  a.status = ctx.body.status;
  a.history.push({ status: a.status, by: ctx.user._id });
  await a.save();
  const s = await Student.findById(a.student).select('user');
  if (s?.user)
    await notifyUsers([s.user], {
      title: `Application update: ${a.status}`,
      message: a.job?.title,
      type: 'placement',
      link: '/placements',
    });
  await audit(ctx, 'APPLICATION_STATUS_CHANGED', 'Application', a._id, { status: a.status });
  return ok(a, 'Status updated');
}
