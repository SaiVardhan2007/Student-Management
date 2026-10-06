import type { Role } from './context';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles: Role[];
  /** exact match only (the dashboard) */
  end?: boolean;
}
export interface NavGroup {
  group: string;
  items: NavItem[];
}

const ALL: Role[] = ['admin', 'faculty', 'student', 'parent'];

/**
 * Sidebar navigation, grouped by what people are trying to do and filtered by role.
 * Every entry maps to a page that existed before the migration — nothing is added or removed.
 */
export const NAV: NavGroup[] = [
  {
    group: 'Overview',
    items: [{ href: '/', label: 'Dashboard', icon: 'dashboard', roles: ALL, end: true }],
  },
  {
    group: 'People',
    items: [
      { href: '/students', label: 'Students', icon: 'users', roles: ['admin', 'faculty'] },
      { href: '/my-children', label: 'My Children', icon: 'users', roles: ['parent'] },
      { href: '/faculty', label: 'Faculty', icon: 'user', roles: ['admin'] },
      { href: '/users', label: 'User Accounts', icon: 'key', roles: ['admin'] },
    ],
  },
  {
    group: 'Academics',
    items: [
      { href: '/academic-setup', label: 'Academic Setup', icon: 'building', roles: ['admin'] },
      { href: '/subjects', label: 'Subjects', icon: 'book', roles: ['admin', 'faculty', 'student'] },
      { href: '/timetable', label: 'Timetable', icon: 'clock', roles: ALL },
      { href: '/calendar', label: 'Academic Calendar', icon: 'calendar', roles: ALL },
    ],
  },
  {
    group: 'Attendance & Exams',
    items: [
      { href: '/attendance', label: 'Attendance', icon: 'checkCircle', roles: ALL },
      { href: '/exams', label: 'Examinations', icon: 'file', roles: ALL },
      { href: '/marks', label: 'Marks Entry', icon: 'clipboard', roles: ['admin', 'faculty'] },
      { href: '/results', label: 'Results', icon: 'chart', roles: ['student', 'parent'] },
    ],
  },
  {
    group: 'Coursework',
    items: [
      { href: '/assignments', label: 'Assignments', icon: 'paperclip', roles: ['admin', 'faculty', 'student'] },
      { href: '/materials', label: 'Study Materials', icon: 'layers', roles: ['admin', 'faculty', 'student'] },
    ],
  },
  {
    group: 'Communication',
    items: [
      { href: '/notices', label: 'Notices', icon: 'message', roles: ALL },
      { href: '/notifications', label: 'Notifications', icon: 'bell', roles: ALL },
    ],
  },
  {
    group: 'Student Services',
    items: [
      { href: '/documents', label: 'Documents', icon: 'file', roles: ['admin', 'student', 'parent'] },
      { href: '/complaints', label: 'Support Tickets', icon: 'inbox', roles: ALL },
      { href: '/achievements', label: 'Achievements', icon: 'award', roles: ALL },
      { href: '/fees', label: 'Fees', icon: 'dollar', roles: ['admin', 'student', 'parent'] },
      { href: '/placements', label: 'Placements', icon: 'briefcase', roles: ['admin', 'student'] },
      { href: '/library', label: 'Library', icon: 'book', roles: ['admin', 'student', 'parent'] },
    ],
  },
  {
    group: 'Administration',
    items: [
      { href: '/reports', label: 'Reports', icon: 'chart', roles: ['admin', 'faculty'] },
      { href: '/import', label: 'Bulk Import', icon: 'upload', roles: ['admin'] },
      { href: '/audit-logs', label: 'Audit Logs', icon: 'shield', roles: ['admin'] },
      { href: '/settings', label: 'Settings', icon: 'settings', roles: ['admin'] },
    ],
  },
];

/** Page titles used by the breadcrumb trail. */
export const TITLES: Record<string, string> = {
  '': 'Dashboard',
  notices: 'Notices',
  calendar: 'Academic Calendar',
  students: 'Students',
  'my-children': 'My Children',
  faculty: 'Faculty',
  users: 'User Accounts',
  'academic-setup': 'Academic Setup',
  subjects: 'Subjects',
  timetable: 'Timetable',
  attendance: 'Attendance',
  marks: 'Marks Entry',
  results: 'Results',
  exams: 'Examinations',
  assignments: 'Assignments',
  materials: 'Study Materials',
  documents: 'Documents',
  complaints: 'Support Tickets',
  achievements: 'Achievements',
  fees: 'Fees',
  placements: 'Placements',
  library: 'Library',
  reports: 'Reports',
  import: 'Bulk Import',
  'audit-logs': 'Audit Logs',
  settings: 'Settings',
  notifications: 'Notifications',
  profile: 'My Profile',
  new: 'New',
  corrections: 'Corrections',
  submissions: 'Submissions',
};
