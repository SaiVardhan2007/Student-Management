import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { validate, z, objectId } from '../middleware/validate.js';
import { Book, BookIssue, Student, getSettings } from '../models/index.js';
import { asyncHandler, ok, created, paginate, filtersFromQuery, requireValidId } from '../utils/http.js';
import { AppError } from '../utils/AppError.js';
import { ownStudentIds } from '../services/access.js';
import { audit } from '../services/audit.js';

const r = Router();
r.use(protect);
const admin = authorize('admin');
const MAX_ACTIVE_LOANS = 5;

const bookSchema = z.object({
  title: z.string().trim().min(1).max(200),
  authors: z.array(z.string().trim().min(1).max(100)).min(1, 'Add at least one author'),
  isbn: z
    .string()
    .trim()
    .regex(/^[0-9Xx-]{10,17}$/, 'ISBN must be 10–13 digits'),
  category: z.string().trim().max(80).optional(),
  totalCopies: z.coerce.number().int().min(1).max(10000),
});
const issueSchema = z.object({ book: objectId, student: objectId });

r.get(
  '/books',
  asyncHandler(async (req, res) => {
    const { items, meta } = await paginate(Book, req, {
      filter: filtersFromQuery(req.query, { category: 'string' }),
      searchFields: ['title', 'authors', 'isbn'],
      allowedSort: ['title', 'category', 'availableCopies'],
      defaultSort: { title: 1 },
    });
    ok(res, items, 'OK', 200, meta);
  })
);

r.post(
  '/books',
  admin,
  validate(bookSchema),
  asyncHandler(async (req, res) => {
    const b = await Book.create({ ...req.body, availableCopies: req.body.totalCopies });
    await audit(req, 'BOOK_ADDED', 'Book', b._id);
    created(res, b, 'Book added');
  })
);

r.patch(
  '/books/:id',
  admin,
  validate(bookSchema.partial()),
  asyncHandler(async (req, res) => {
    requireValidId(req.params.id);
    const b = await Book.findById(req.params.id);
    if (!b) throw AppError.notFound('Book not found');
    if (req.body.totalCopies !== undefined) {
      const out = b.totalCopies - b.availableCopies;
      if (req.body.totalCopies < out) throw AppError.badRequest(`${out} copies are currently issued; total cannot be lower`);
      b.availableCopies = req.body.totalCopies - out;
    }
    b.set(req.body);
    await b.save();
    ok(res, b, 'Book updated');
  })
);

r.delete(
  '/books/:id',
  admin,
  asyncHandler(async (req, res) => {
    requireValidId(req.params.id);
    if (await BookIssue.exists({ book: req.params.id, returnedAt: null }))
      throw AppError.conflict('Copies of this book are currently issued');
    const b = await Book.findByIdAndDelete(req.params.id);
    if (!b) throw AppError.notFound('Book not found');
    ok(res, null, 'Book deleted');
  })
);

r.post(
  '/issue',
  admin,
  validate(issueSchema),
  asyncHandler(async (req, res) => {
    const [student, settings] = await Promise.all([Student.findById(req.body.student), getSettings()]);
    if (!student || student.status !== 'active') throw AppError.badRequest('Student not found or not active');
    if ((await BookIssue.countDocuments({ student: student._id, returnedAt: null })) >= MAX_ACTIVE_LOANS)
      throw AppError.conflict(`Borrowing limit reached (${MAX_ACTIVE_LOANS} books)`);
    if (await BookIssue.exists({ student: student._id, book: req.body.book, returnedAt: null }))
      throw AppError.conflict('This student already has this book');
    // atomic decrement prevents issuing more copies than available
    const book = await Book.findOneAndUpdate(
      { _id: req.body.book, availableCopies: { $gt: 0 } },
      { $inc: { availableCopies: -1 } },
      { new: true }
    );
    if (!book) throw AppError.conflict('No copies available (or book not found)');
    const issue = await BookIssue.create({
      book: book._id,
      student: student._id,
      dueDate: new Date(Date.now() + settings.libraryLoanDays * 86400000),
      issuedBy: req.user._id,
    });
    await audit(req, 'BOOK_ISSUED', 'BookIssue', issue._id);
    created(res, issue, 'Book issued');
  })
);

r.post(
  '/return/:id',
  admin,
  asyncHandler(async (req, res) => {
    requireValidId(req.params.id);
    const issue = await BookIssue.findById(req.params.id);
    if (!issue) throw AppError.notFound('Issue record not found');
    if (issue.returnedAt) throw AppError.conflict('Book already returned');
    const settings = await getSettings();
    issue.returnedAt = new Date();
    const lateDays = Math.max(Math.ceil((issue.returnedAt - issue.dueDate) / 86400000), 0);
    issue.fine = lateDays * settings.libraryFinePerDay;
    await issue.save();
    await Book.updateOne({ _id: issue.book }, { $inc: { availableCopies: 1 } });
    await audit(req, 'BOOK_RETURNED', 'BookIssue', issue._id, { fine: issue.fine });
    ok(res, issue, issue.fine ? `Returned late. Fine: ${issue.fine}` : 'Book returned');
  })
);

r.get(
  '/issues',
  authorize('admin', 'student', 'parent'),
  asyncHandler(async (req, res) => {
    const filter = filtersFromQuery(req.query, { student: 'id', book: 'id' });
    if (req.query.status === 'active') filter.returnedAt = null;
    if (req.query.status === 'returned') filter.returnedAt = { $ne: null };
    if (req.user.role !== 'admin') filter.student = { $in: await ownStudentIds(req) };
    const { items, meta } = await paginate(BookIssue, req, {
      filter,
      allowedSort: ['issuedAt', 'dueDate'],
      defaultSort: { issuedAt: -1 },
      populate: [
        { path: 'book', select: 'title isbn' },
        { path: 'student', select: 'studentId firstName lastName' },
      ],
    });
    const settings = await getSettings();
    ok(
      res,
      items.map((i) => ({
        ...i,
        overdue: !i.returnedAt && new Date(i.dueDate) < new Date(),
        currentFine: i.returnedAt
          ? i.fine
          : Math.max(Math.ceil((Date.now() - new Date(i.dueDate)) / 86400000), 0) * settings.libraryFinePerDay,
      })),
      'OK',
      200,
      meta
    );
  })
);

export default r;
