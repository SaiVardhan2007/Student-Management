'use client';

// Home page. Shows a different dashboard for each role: admin, faculty, or student/parent (the parent
// view reuses the student dashboard). Data comes from /dashboard/admin, /dashboard/faculty and /dashboard/student.

import { useState } from 'react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '@/components/providers/auth-provider';
import { useFetch } from '@/hooks';
import { Alert, Badge, Card, EmptyState, ErrorState, PageHeader, ProgressBar, Skeleton, StatCard } from '@/components/ui';
import { fmtDate, fmtDateTime, titleCase } from '@/lib/format';

const CHART_COLOR = '#2563eb';

// Wraps a chart so it fills its container, or shows an empty message when there is nothing to plot.
function ChartBox({ children, empty }: any) {
  if (empty) return <EmptyState icon="chart" title="No data yet" message="Charts appear once data has been recorded." />;
  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Admin view ----------
function AdminDashboard() {
  const { data, loading, error, reload } = useFetch('/dashboard/admin');
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const c = data?.counts || {};

  // Subtitle example: "2025-26 · Semester 3". A single space keeps the header height while loading.
  let subtitle = ' ';
  if (data) {
    subtitle = data.currentYear?.name || 'No current academic year';
    if (data.currentSemester) subtitle += ` · ${data.currentSemester.name}`;
  }

  return (
    <div className="page">
      <PageHeader title="Admin dashboard" subtitle={subtitle} />
      <div className="grid grid-stats">
        <StatCard label="Total students" value={c.totalStudents} sub={`${c.activeStudents ?? '—'} active`} loading={loading} />
        <StatCard label="Faculty" value={c.totalFaculty} loading={loading} />
        <StatCard label="Departments" value={c.departments} sub={`${c.programs ?? '—'} programs`} loading={loading} />
        <StatCard label="Subjects" value={c.subjects} loading={loading} />
        <StatCard label="Pending complaints" value={c.pendingComplaints} tone={c.pendingComplaints ? 'warn' : ''} loading={loading} />
        <StatCard label="Documents to verify" value={c.pendingDocuments} tone={c.pendingDocuments ? 'warn' : ''} loading={loading} />
      </div>

      <div className="grid grid-2">
        <Card title="Attendance — last 30 days">
          <ChartBox empty={!loading && !data?.attendance?.length}>
            <LineChart data={data?.attendance || []} margin={{ left: -20, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ec" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} fontSize={12} />
              <YAxis domain={[0, 100]} fontSize={12} unit="%" />
              <Tooltip formatter={(v) => [`${v}%`, 'Attendance']} />
              <Line type="monotone" dataKey="percentage" stroke={CHART_COLOR} strokeWidth={2} dot={false} />
            </LineChart>
          </ChartBox>
        </Card>
        <Card title="Performance — grade distribution">
          <ChartBox empty={!loading && !data?.performance?.some((p) => p.count)}>
            <BarChart data={data?.performance || []} margin={{ left: -20, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ec" />
              <XAxis dataKey="grade" fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip formatter={(v) => [v, 'Students']} />
              <Bar dataKey="count" fill={CHART_COLOR} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartBox>
        </Card>
      </div>

      <div className="grid grid-3">
        <Card title="Students by department">
          <ChartBox empty={!loading && !data?.studentsByDepartment?.length}>
            <BarChart data={data?.studentsByDepartment || []} layout="vertical" margin={{ left: 10, right: 8 }}>
              <XAxis type="number" allowDecimals={false} fontSize={12} />
              <YAxis type="category" dataKey="name" fontSize={12} width={50} />
              <Tooltip />
              <Bar dataKey="count" fill={CHART_COLOR} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartBox>
        </Card>
        <Card
          title="Recent registrations"
          actions={
            <Link href="/students" className="small">
              View all
            </Link>
          }
        >
          {loading ? (
            <Skeleton height={80} />
          ) : !data.recentStudents.length ? (
            <p className="muted">No students yet.</p>
          ) : (
            <ul className="list">
              {data.recentStudents.map((s) => (
                <li key={s._id} className="row-between">
                  <Link href={`/students/${s._id}`}>
                    {s.firstName} {s.lastName}
                  </Link>
                  <span className="faint small">
                    {s.studentId} · {fmtDate(s.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title="Recent notices"
          actions={
            <Link href="/notices" className="small">
              View all
            </Link>
          }
        >
          {loading ? (
            <Skeleton height={80} />
          ) : !data.recentNotices.length ? (
            <p className="muted">No notices published.</p>
          ) : (
            <ul className="list">
              {data.recentNotices.map((n) => (
                <li key={n._id} className="row-between">
                  <span>{n.title}</span>
                  <Badge value={n.priority} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Recent activity"
        actions={
          <Link href="/audit-logs" className="small">
            Audit log
          </Link>
        }
      >
        {loading ? (
          <Skeleton height={80} />
        ) : !data.recentActivities.length ? (
          <p className="muted">No activity recorded yet.</p>
        ) : (
          <ul className="list">
            {data.recentActivities.map((a) => (
              <li key={a._id} className="row-between">
                <span>
                  <span className="strong">{a.userName || 'System'}</span>{' '}
                  <span className="muted">— {titleCase(a.action.toLowerCase())}</span>
                </span>
                <span className="faint small">{fmtDateTime(a.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------- Faculty view ----------
function FacultyDashboard() {
  const { data, loading, error, reload } = useFetch('/dashboard/faculty');
  if (error) return <ErrorState message={error} onRetry={reload} />;
  return (
    <div className="page">
      <PageHeader title="Faculty dashboard" subtitle="Your classes at a glance" />
      <div className="grid grid-stats">
        <StatCard label="Subjects taught" value={data?.subjects.length} loading={loading} />
        <StatCard label="Students" value={data?.studentCount} loading={loading} />
        <StatCard
          label="Submissions to evaluate"
          value={data?.pendingEvaluations}
          tone={data?.pendingEvaluations ? 'warn' : ''}
          loading={loading}
        />
        <StatCard
          label="Attendance corrections"
          value={data?.pendingCorrections}
          tone={data?.pendingCorrections ? 'warn' : ''}
          loading={loading}
        />
      </div>
      <div className="grid grid-2">
        <Card
          title="Today's classes"
          actions={
            <Link href="/timetable" className="small">
              Timetable
            </Link>
          }
        >
          {loading ? (
            <Skeleton height={60} />
          ) : !data.todayClasses.length ? (
            <p className="muted">No classes scheduled today.</p>
          ) : (
            <ul className="list">
              {data.todayClasses.map((s) => (
                <li key={s._id} className="row-between">
                  <span>
                    <strong>
                      {s.startTime}–{s.endTime}
                    </strong>{' '}
                    · {s.subject?.code} {s.subject?.name}
                  </span>
                  <span className="faint small">
                    {s.section?.name} · {s.room}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Upcoming exams">
          {loading ? (
            <Skeleton height={60} />
          ) : !data.upcomingExams.length ? (
            <p className="muted">No upcoming exams.</p>
          ) : (
            <ul className="list">
              {data.upcomingExams.map((x) => (
                <li key={x._id} className="row-between">
                  <span>{x.name}</span>
                  <span className="faint small">
                    {fmtDate(x.date)} · {x.startTime}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card
        title="My subjects"
        actions={
          <Link href="/attendance" className="small">
            Mark attendance
          </Link>
        }
      >
        {loading ? (
          <Skeleton height={60} />
        ) : !data.subjects.length ? (
          <EmptyState title="No subjects assigned" message="Ask the administrator to assign subjects to you." />
        ) : (
          <div className="row">
            {data.subjects.map((s) => (
              <Badge key={s._id} tone="primary">
                {s.code} · {s.name}
              </Badge>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- Student / parent view ----------
function StudentDashboard() {
  const { user } = useAuth();
  const isParent = user.role === 'parent';
  // Only parents need the list of their children (for the child picker).
  const children = useFetch('/students', { limit: 50 }, { enabled: isParent });
  // Empty means "let the server pick the default student for this account".
  const [childId, setChildId] = useState('');
  const { data, loading, error, reload } = useFetch('/dashboard/student', childId ? { student: childId } : undefined);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!loading && !data)
    return (
      <EmptyState
        icon="user"
        title="No student profile linked"
        message={isParent ? 'Ask the administrator to link your child to this account.' : 'Your account has no student profile yet.'}
      />
    );

  const att = data?.attendance;
  // Subjects where attendance is under the minimum percentage
  const low = att?.subjects?.filter((s) => s.belowThreshold) || [];

  let title;
  if (isParent) {
    title = `Parent dashboard${data ? ` — ${data.student.name}` : ''}`;
  } else {
    title = `Welcome${data ? `, ${data.student.name.split(' ')[0]}` : ''}`;
  }

  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle={data ? `${data.student.studentId} · Semester ${data.student.semester}` : ' '}
        actions={
          // Child picker is only useful when the parent has more than one child
          isParent &&
          children.data?.length > 1 && (
            <select
              className="select"
              aria-label="Select child"
              value={childId || data?.student._id || ''}
              onChange={(e) => setChildId(e.target.value)}
            >
              {children.data.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.firstName} {c.lastName}
                </option>
              ))}
            </select>
          )
        }
      />
      {low.length > 0 && (
        <Alert tone="warning">
          <strong>Attendance warning:</strong> below {att.threshold}% in {low.map((s) => `${s.code} (${s.percentage}%)`).join(', ')}.
        </Alert>
      )}
      <div className="grid grid-stats">
        <StatCard
          label="Overall attendance"
          value={att?.overall.percentage != null ? `${att.overall.percentage}%` : '—'}
          tone={att?.overall.belowThreshold ? 'danger' : ''}
          sub={att ? `Minimum required ${att.threshold}%` : ''}
          loading={loading}
        />
        <StatCard label="CGPA" value={data?.cgpa || '—'} sub="Cumulative grade point average" loading={loading} />
        <StatCard label="Pending assignments" value={data?.pendingAssignments.length} loading={loading} />
        {!isParent && <StatCard label="Unread notifications" value={data?.unreadNotifications} loading={loading} />}
      </div>
      <div className="grid grid-2">
        <Card
          title="Attendance by subject"
          actions={
            <Link href="/attendance" className="small">
              Details
            </Link>
          }
        >
          {loading ? (
            <Skeleton height={100} />
          ) : !att.subjects.length ? (
            <p className="muted">No attendance recorded yet.</p>
          ) : (
            <div className="stack">
              {att.subjects.map((s) => (
                <div key={s.subject}>
                  <div className="row-between small">
                    <span>
                      {s.code} · {s.name}
                    </span>
                    <strong>{s.percentage ?? '—'}%</strong>
                  </div>
                  <ProgressBar value={s.percentage} threshold={att.threshold} label={`${s.name} attendance`} />
                </div>
              ))}
            </div>
          )}
        </Card>
        <div className="stack">
          <Card
            title="Upcoming assignments"
            actions={
              // Parents cannot open assignment pages, so no links for them
              !isParent && (
                <Link href="/assignments" className="small">
                  View all
                </Link>
              )
            }
          >
            {loading ? (
              <Skeleton height={60} />
            ) : !data.pendingAssignments.length ? (
              <p className="muted">Nothing pending. 🎉</p>
            ) : (
              <ul className="list">
                {data.pendingAssignments.slice(0, 5).map((a) => (
                  <li key={a._id} className="row-between">
                    <span>
                      {isParent ? a.title : <Link href={`/assignments/${a._id}`}>{a.title}</Link>}{' '}
                      <span className="faint small">{a.subject?.code}</span>
                    </span>
                    <span className="faint small">Due {fmtDate(a.deadline)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card
            title="Upcoming exams"
            actions={
              <Link href="/exams" className="small">
                Schedule
              </Link>
            }
          >
            {loading ? (
              <Skeleton height={60} />
            ) : !data.upcomingExams.length ? (
              <p className="muted">No exams scheduled.</p>
            ) : (
              <ul className="list">
                {data.upcomingExams.map((x) => (
                  <li key={x._id} className="row-between">
                    <span>
                      {x.subject?.code} · {x.name}
                    </span>
                    <span className="faint small">
                      {fmtDate(x.date)} {x.startTime}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// Picks the view that matches the logged-in user's role.
export default function Dashboard() {
  const { user } = useAuth();
  if (user.role === 'admin') return <AdminDashboard />;
  if (user.role === 'faculty') return <FacultyDashboard />;
  return <StudentDashboard />;
}
