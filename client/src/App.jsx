import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import { PageLoader } from './components/ui.jsx';

const page = (loader) => lazy(loader);
const Login = page(() => import('./pages/Login.jsx'));
const ForgotPassword = page(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = page(() => import('./pages/ResetPassword.jsx'));
const Dashboard = page(() => import('./pages/Dashboard.jsx'));
const Profile = page(() => import('./pages/Profile.jsx'));
const Students = page(() => import('./pages/Students.jsx'));
const StudentDetail = page(() => import('./pages/StudentDetail.jsx'));
const Faculty = page(() => import('./pages/Faculty.jsx'));
const Users = page(() => import('./pages/Users.jsx'));
const AcademicSetup = page(() => import('./pages/AcademicSetup.jsx'));
const Subjects = page(() => import('./pages/Subjects.jsx'));
const Timetable = page(() => import('./pages/Timetable.jsx'));
const Attendance = page(() => import('./pages/Attendance.jsx'));
const Marks = page(() => import('./pages/Marks.jsx'));
const Results = page(() => import('./pages/Results.jsx'));
const Exams = page(() => import('./pages/Exams.jsx'));
const Assignments = page(() => import('./pages/Assignments.jsx'));
const AssignmentDetail = page(() => import('./pages/AssignmentDetail.jsx'));
const Materials = page(() => import('./pages/Materials.jsx'));
const Notices = page(() => import('./pages/Notices.jsx'));
const Notifications = page(() => import('./pages/Notifications.jsx'));
const Calendar = page(() => import('./pages/Calendar.jsx'));
const Documents = page(() => import('./pages/Documents.jsx'));
const Complaints = page(() => import('./pages/Complaints.jsx'));
const Achievements = page(() => import('./pages/Achievements.jsx'));
const Fees = page(() => import('./pages/Fees.jsx'));
const Placements = page(() => import('./pages/Placements.jsx'));
const Library = page(() => import('./pages/Library.jsx'));
const Reports = page(() => import('./pages/Reports.jsx'));
const Import = page(() => import('./pages/Import.jsx'));
const AuditLogs = page(() => import('./pages/AuditLogs.jsx'));
const Settings = page(() => import('./pages/Settings.jsx'));
const NotFound = page(() => import('./pages/NotFound.jsx'));

/** Requires a signed-in user; optionally restricts by role. */
function Protected({ roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader label="Restoring your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/forbidden" replace />;
  return <Outlet />;
}

function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}

const Forbidden = () => (
  <div className="state" style={{ minHeight: '50vh' }}>
    <h3>Access denied</h3>
    <p>Your role does not have access to this page.</p>
  </div>
);

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<GuestOnly />}>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
        </Route>

        <Route element={<Protected />}>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="profile" element={<Profile />} />
            <Route path="notices" element={<Notices />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="subjects" element={<Subjects />} />
            <Route path="timetable" element={<Timetable />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="exams" element={<Exams />} />
            <Route path="complaints" element={<Complaints />} />
            <Route path="achievements" element={<Achievements />} />
            <Route path="forbidden" element={<Forbidden />} />

            <Route element={<Protected roles={['admin', 'faculty']} />}>
              <Route path="students" element={<Students />} />
              <Route path="marks" element={<Marks />} />
              <Route path="reports" element={<Reports />} />
            </Route>
            <Route path="students/:id" element={<StudentDetail />} />
            <Route element={<Protected roles={['admin', 'faculty', 'student']} />}>
              <Route path="assignments" element={<Assignments />} />
              <Route path="assignments/:id" element={<AssignmentDetail />} />
              <Route path="materials" element={<Materials />} />
            </Route>
            <Route element={<Protected roles={['student', 'parent']} />}>
              <Route path="results" element={<Results />} />
            </Route>
            <Route element={<Protected roles={['parent']} />}>
              <Route path="my-children" element={<Students />} />
            </Route>
            <Route element={<Protected roles={['admin', 'student', 'parent']} />}>
              <Route path="documents" element={<Documents />} />
              <Route path="fees" element={<Fees />} />
              <Route path="library" element={<Library />} />
            </Route>
            <Route element={<Protected roles={['admin', 'student']} />}>
              <Route path="placements" element={<Placements />} />
            </Route>
            <Route element={<Protected roles={['admin']} />}>
              <Route path="faculty" element={<Faculty />} />
              <Route path="users" element={<Users />} />
              <Route path="academic-setup" element={<AcademicSetup />} />
              <Route path="import" element={<Import />} />
              <Route path="audit-logs" element={<AuditLogs />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
