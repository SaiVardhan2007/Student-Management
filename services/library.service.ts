import { Book, BookIssue, Student, getSettings } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { paginate, filtersFromQuery, requireValidId } from '@/lib/query';
import type { Ctx } from '@/lib/context';
import { ownStudentIds } from '@/services/access';
import { audit } from '@/services/audit';

const MAX_ACTIVE_LOANS = 5;

export async function listBooks(ctx: Ctx) {
  const { items, meta } = await paginate(Book, ctx, {
    filter: filtersFromQuery(ctx.query, { category: 'string' }),
    searchFields: ['title', 'authors', 'isbn'],
    allowedSort: ['title', 'category', 'availableCopies'],
    defaultSort: { title: 1 },
  });
  return ok(items, 'OK', 200, meta);
}

export async function createBook(ctx: Ctx) {
  const b = await Book.create({ ...ctx.body, availableCopies: ctx.body.totalCopies });
  await audit(ctx, 'BOOK_ADDED', 'Book', b._id);
  return created(b, 'Book added');
}

export async function updateBook(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const b = await Book.findById(ctx.params.id);
  if (!b) throw AppError.notFound('Book not found');
  if (ctx.body.totalCopies !== undefined) {
    const out = b.totalCopies - b.availableCopies;
    if (ctx.body.totalCopies < out) throw AppError.badRequest(`${out} copies are currently issued; total cannot be lower`);
    b.availableCopies = ctx.body.totalCopies - out;
  }
  b.set(ctx.body);
  await b.save();
  return ok(b, 'Book updated');
}

export async function deleteBook(ctx: Ctx) {
  requireValidId(ctx.params.id);
  if (await BookIssue.exists({ book: ctx.params.id, returnedAt: null })) throw AppError.conflict('Copies of this book are currently issued');
  const b = await Book.findByIdAndDelete(ctx.params.id);
  if (!b) throw AppError.notFound('Book not found');
  return ok(null, 'Book deleted');
}

export async function issueBook(ctx: Ctx) {
  const [student, settings] = await Promise.all([Student.findById(ctx.body.student), getSettings()]);
  if (!student || student.status !== 'active') throw AppError.badRequest('Student not found or not active');
  if ((await BookIssue.countDocuments({ student: student._id, returnedAt: null })) >= MAX_ACTIVE_LOANS)
    throw AppError.conflict(`Borrowing limit reached (${MAX_ACTIVE_LOANS} books)`);
  if (await BookIssue.exists({ student: student._id, book: ctx.body.book, returnedAt: null }))
    throw AppError.conflict('This student already has this book');
  // atomic decrement prevents issuing more copies than available
  const book = await Book.findOneAndUpdate({ _id: ctx.body.book, availableCopies: { $gt: 0 } }, { $inc: { availableCopies: -1 } }, { new: true });
  if (!book) throw AppError.conflict('No copies available (or book not found)');
  const issue = await BookIssue.create({
    book: book._id,
    student: student._id,
    dueDate: new Date(Date.now() + settings.libraryLoanDays * 86400000),
    issuedBy: ctx.user._id,
  });
  await audit(ctx, 'BOOK_ISSUED', 'BookIssue', issue._id);
  return created(issue, 'Book issued');
}

export async function returnBook(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const issue = await BookIssue.findById(ctx.params.id);
  if (!issue) throw AppError.notFound('Issue record not found');
  if (issue.returnedAt) throw AppError.conflict('Book already returned');
  const settings = await getSettings();
  issue.returnedAt = new Date();
  const lateDays = Math.max(Math.ceil((issue.returnedAt.getTime() - issue.dueDate.getTime()) / 86400000), 0);
  issue.fine = lateDays * settings.libraryFinePerDay;
  await issue.save();
  await Book.updateOne({ _id: issue.book }, { $inc: { availableCopies: 1 } });
  await audit(ctx, 'BOOK_RETURNED', 'BookIssue', issue._id, { fine: issue.fine });
  return ok(issue, issue.fine ? `Returned late. Fine: ${issue.fine}` : 'Book returned');
}

export async function listIssues(ctx: Ctx) {
  const filter: Record<string, any> = filtersFromQuery(ctx.query, { student: 'id', book: 'id' });
  if (ctx.query.status === 'active') filter.returnedAt = null;
  if (ctx.query.status === 'returned') filter.returnedAt = { $ne: null };
  if (ctx.user.role !== 'admin') filter.student = { $in: await ownStudentIds(ctx) };
  const { items, meta } = await paginate(BookIssue, ctx, {
    filter,
    allowedSort: ['issuedAt', 'dueDate'],
    defaultSort: { issuedAt: -1 },
    populate: [
      { path: 'book', select: 'title isbn' },
      { path: 'student', select: 'studentId firstName lastName' },
    ],
  });
  const settings = await getSettings();
  return ok(
    items.map((i) => ({
      ...i,
      overdue: !i.returnedAt && new Date(i.dueDate) < new Date(),
      currentFine: i.returnedAt ? i.fine : Math.max(Math.ceil((Date.now() - new Date(i.dueDate).getTime()) / 86400000), 0) * settings.libraryFinePerDay,
    })),
    'OK',
    200,
    meta
  );
}
