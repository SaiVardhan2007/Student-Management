// Library: books, issuing, returning and fines. Routes call these; they use the Book and BookIssue models.
import { Book, BookIssue, Student, getSettings } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { paginate, filtersFromQuery, requireValidId } from '@/lib/query';
import type { Ctx } from '@/lib/context';
import { ownStudentIds } from '@/services/access';
import { audit } from '@/services/audit';

const MAX_ACTIVE_LOANS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days late (rounded up). Returns 0 if the book is not late. */
function daysLate(dueDate: Date, returnedOn: Date) {
  const days = Math.ceil((returnedOn.getTime() - new Date(dueDate).getTime()) / MS_PER_DAY);
  return Math.max(days, 0);
}

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
  const { totalCopies, ...rest } = ctx.body;
  delete rest.availableCopies; // only changed through issue/return/total adjustments
  b.set(rest);
  await b.save();
  if (totalCopies !== undefined) {
    // Adjust availability by the change in total, atomically, so copies issued/returned meanwhile are not clobbered.
    // The filter makes sure availableCopies never drops below zero (i.e. fewer total than currently issued).
    const delta = totalCopies - b.totalCopies;
    const updated = await Book.findOneAndUpdate(
      { _id: b._id, availableCopies: { $gte: -delta } },
      { $set: { totalCopies }, $inc: { availableCopies: delta } },
      { new: true }
    );
    if (!updated) {
      const issuedCopies = b.totalCopies - b.availableCopies;
      throw AppError.badRequest(`${issuedCopies} copies are currently issued; total cannot be lower`);
    }
    return ok(updated, 'Book updated');
  }
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
  // One atomic update: only decrement if a copy is available, so two requests can't issue the last copy twice
  const book = await Book.findOneAndUpdate({ _id: ctx.body.book, availableCopies: { $gt: 0 } }, { $inc: { availableCopies: -1 } }, { new: true });
  if (!book) throw AppError.conflict('No copies available (or book not found)');
  let issue;
  try {
    issue = await BookIssue.create({
      book: book._id,
      student: student._id,
      dueDate: new Date(Date.now() + settings.libraryLoanDays * MS_PER_DAY),
      issuedBy: ctx.user._id,
    });
  } catch (err) {
    // give the copy back so a failed insert doesn't leak stock
    await Book.updateOne({ _id: book._id }, { $inc: { availableCopies: 1 } });
    throw err;
  }
  // Re-check after creating: concurrent requests may both have passed the checks above. Keep the earliest issue only.
  const [active, dup] = await Promise.all([
    BookIssue.countDocuments({ student: student._id, returnedAt: null }),
    BookIssue.find({ student: student._id, book: book._id, returnedAt: null }).sort({ _id: 1 }).select('_id').lean(),
  ]);
  if (active > MAX_ACTIVE_LOANS || (dup.length > 1 && String(dup[0]._id) !== String(issue._id))) {
    await BookIssue.deleteOne({ _id: issue._id, returnedAt: null });
    await Book.updateOne({ _id: book._id }, { $inc: { availableCopies: 1 } });
    throw AppError.conflict(active > MAX_ACTIVE_LOANS ? `Borrowing limit reached (${MAX_ACTIVE_LOANS} books)` : 'This student already has this book');
  }
  await audit(ctx, 'BOOK_ISSUED', 'BookIssue', issue._id);
  return created(issue, 'Book issued');
}

export async function returnBook(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const existing = await BookIssue.findById(ctx.params.id);
  if (!existing) throw AppError.notFound('Issue record not found');
  const settings = await getSettings();
  const returnedAt = new Date();
  // Claim the return atomically: only one request can flip returnedAt from null, so copies are restored exactly once
  const issue = await BookIssue.findOneAndUpdate(
    { _id: existing._id, returnedAt: null },
    // Fine rule: every started late day costs the per-day fine from settings
    { $set: { returnedAt, fine: daysLate(existing.dueDate, returnedAt) * settings.libraryFinePerDay } },
    { new: true }
  );
  if (!issue) throw AppError.conflict('Book already returned');
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
  const now = new Date();
  const issues = items.map((i) => ({
    ...i,
    overdue: !i.returnedAt && new Date(i.dueDate) < now,
    // returned books keep their saved fine; books still out are fined up to today
    currentFine: i.returnedAt ? i.fine : daysLate(i.dueDate, now) * settings.libraryFinePerDay,
  }));
  return ok(issues, 'OK', 200, meta);
}
