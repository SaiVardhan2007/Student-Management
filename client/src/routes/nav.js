/** Sidebar navigation, filtered by role. `end` makes the NavLink exact. */
export const NAV = [
  { group: 'Overview', items: [
    { to: '/', label: 'Dashboard', icon: 'dashboard', roles: ['admin', 'faculty', 'student', 'parent'], end: true },
    { to: '/notices', label: 'Notices', icon: 'message', roles: ['admin', 'faculty', 'student', 'parent'] },
    { to: '/calendar', label: 'Academic Calendar', icon: 'calendar', roles: ['admin', 'faculty', 'student', 'parent'] },
  ] },
  { group: 'People', items: [
    { to: '/students', label: 'Students', icon: 'users', roles: ['admin', 'faculty'] },
    { to: '/my-children', label: 'My Children', icon: 'users', roles: ['parent'] },
    { to: '/faculty', label: 'Faculty', icon: 'user', roles: ['admin'] },
    { to: '/users', label: 'User Accounts', icon: 'key', roles: ['admin'] },
  ] },
  { group: 'Academics', items: [
    { to: '/academic-setup', label: 'Academic Setup', icon: 'building', roles: ['admin'] },
    { to: '/subjects', label: 'Subjects', icon: 'book', roles: ['admin', 'faculty', 'student'] },
    { to: '/timetable', label: 'Timetable', icon: 'clock', roles: ['admin', 'faculty', 'student', 'parent'] },
    { to: '/attendance', label: 'Attendance', icon: 'checkCircle', roles: ['admin', 'faculty', 'student', 'parent'] },
    { to: '/marks', label: 'Marks Entry', icon: 'clipboard', roles: ['admin', 'faculty'] },
    { to: '/results', label: 'Results', icon: 'chart', roles: ['student', 'parent'] },
    { to: '/exams', label: 'Examinations', icon: 'file', roles: ['admin', 'faculty', 'student', 'parent'] },
    { to: '/assignments', label: 'Assignments', icon: 'paperclip', roles: ['admin', 'faculty', 'student'] },
    { to: '/materials', label: 'Study Materials', icon: 'layers', roles: ['admin', 'faculty', 'student'] },
  ] },
  { group: 'Student Services', items: [
    { to: '/documents', label: 'Documents', icon: 'file', roles: ['admin', 'student', 'parent'] },
    { to: '/complaints', label: 'Support Tickets', icon: 'inbox', roles: ['admin', 'faculty', 'student', 'parent'] },
    { to: '/achievements', label: 'Achievements', icon: 'award', roles: ['admin', 'faculty', 'student', 'parent'] },
    { to: '/fees', label: 'Fees', icon: 'dollar', roles: ['admin', 'student', 'parent'] },
    { to: '/placements', label: 'Placements', icon: 'briefcase', roles: ['admin', 'student'] },
    { to: '/library', label: 'Library', icon: 'book', roles: ['admin', 'student', 'parent'] },
  ] },
  { group: 'Administration', items: [
    { to: '/reports', label: 'Reports', icon: 'chart', roles: ['admin', 'faculty'] },
    { to: '/import', label: 'Bulk Import', icon: 'upload', roles: ['admin'] },
    { to: '/audit-logs', label: 'Audit Logs', icon: 'shield', roles: ['admin'] },
    { to: '/settings', label: 'Settings', icon: 'settings', roles: ['admin'] },
  ] },
];

export const TITLES = {
  '': 'Dashboard', notices: 'Notices', calendar: 'Academic Calendar', students: 'Students', 'my-children': 'My Children', faculty: 'Faculty', users: 'User Accounts',
  'academic-setup': 'Academic Setup', subjects: 'Subjects', timetable: 'Timetable', attendance: 'Attendance', marks: 'Marks Entry', results: 'Results',
  exams: 'Examinations', assignments: 'Assignments', materials: 'Study Materials', documents: 'Documents', complaints: 'Support Tickets', achievements: 'Achievements',
  fees: 'Fees', placements: 'Placements', library: 'Library', reports: 'Reports', import: 'Bulk Import', 'audit-logs': 'Audit Logs', settings: 'Settings',
  notifications: 'Notifications', profile: 'My Profile', new: 'New', corrections: 'Corrections', submissions: 'Submissions',
};
