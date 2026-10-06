'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useSettings } from '@/components/providers/settings-provider';
import { NAV, TITLES } from '@/lib/nav';
import { canAccessPath } from '@/lib/permissions';
import Icon from '@/components/ui/icon';
import { Avatar, PageLoader } from '@/components/ui';
import { useDismiss, useFetch } from '@/hooks';
import { api, fetchImageUrl } from '@/lib/api-client';
import { fmtDateTime, titleCase } from '@/lib/format';

function Logo({ logo }: any) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url;
    if (logo)
      fetchImageUrl(logo)
        .then((u) => {
          url = u;
          setSrc(u);
        })
        .catch(() => setSrc(null));
    return () => url && URL.revokeObjectURL(url);
  }, [logo]);
  return <span className="brand-logo">{src ? <img src={src} alt="" /> : <Icon name="graduation" size={18} />}</span>;
}

function Breadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split('/').filter(Boolean);
  const crumbs: { to: string; label: string; current?: boolean }[] = [{ to: '/', label: 'Home' }];
  let acc = '';
  parts.forEach((p, i) => {
    acc += `/${p}`;
    const label = TITLES[p] || (/^[a-f\d]{24}$/i.test(p) ? 'Details' : titleCase(p));
    crumbs.push({ to: acc, label, current: i === parts.length - 1 });
  });
  if (parts.length === 0)
    return (
      <span className="crumbs">
        <span className="current">Dashboard</span>
      </span>
    );
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <span key={c.to} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          {i > 0 && <Icon name="chevronRight" size={12} />}
          {c.current ? (
            <span className="current" aria-current="page">
              {c.label}
            </span>
          ) : (
            <Link href={c.to}>{c.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), open);
  const count = useFetch('/notifications/unread-count');
  const recent = useFetch('/notifications', { limit: 6 }, { enabled: open });
  const router = useRouter();
  const navigate = (to: string) => router.push(to);

  // light polling so new notifications show up without a reload
  useEffect(() => {
    const t = setInterval(count.reload, 60000);
    return () => clearInterval(t);
  }, [count.reload]);

  const openItem = async (n) => {
    setOpen(false);
    if (!n.isRead) {
      await api.patch(`/notifications/${n._id}/read`).catch(() => {});
      count.reload();
    }
    if (n.link) navigate(n.link);
  };
  const unread = count.data?.count || 0;

  return (
    <div className="dropdown" ref={ref}>
      <button
        className="btn btn-ghost btn-icon bell"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
      >
        <Icon name="bell" />
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="dropdown-menu notif-panel" role="menu">
          <div className="row-between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <strong>Notifications</strong>
            <Link href="/notifications" onClick={() => setOpen(false)} className="small">
              View all
            </Link>
          </div>
          {recent.loading && (
            <p className="muted small" style={{ padding: 14 }}>
              Loading…
            </p>
          )}
          {recent.error && (
            <p className="small" style={{ padding: 14, color: 'var(--danger)' }}>
              {recent.error}
            </p>
          )}
          {!recent.loading && recent.data?.length === 0 && (
            <p className="muted small" style={{ padding: 14 }}>
              You&apos;re all caught up.
            </p>
          )}
          {recent.data?.map((n) => (
            <button
              key={n._id}
              className={`notif-item ${n.isRead ? '' : 'unread'}`}
              style={{ width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', background: undefined }}
              onClick={() => openItem(n)}
            >
              <div className="strong small">{n.title}</div>
              {n.message && <div className="muted small">{n.message}</div>}
              <div className="faint small">{fmtDateTime(n.createdAt)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), open);
  const router = useRouter();
  const navigate = (to: string) => router.push(to);
  return (
    <div className="dropdown" ref={ref}>
      <button
        className="btn btn-ghost"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ padding: '0 6px' }}
      >
        <Avatar name={user.name} />
        <span className="hide-sm" style={{ textAlign: 'left', lineHeight: 1.2 }}>
          <span className="strong" style={{ display: 'block' }}>
            {user.name}
          </span>
          <span className="faint small" style={{ textTransform: 'capitalize' }}>
            {user.role}
          </span>
        </span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="dropdown-menu" role="menu">
          <button
            className="item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/profile');
            }}
          >
            <Icon name="user" size={16} /> My profile
          </button>
          <button
            className="item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/notifications');
            }}
          >
            <Icon name="bell" size={16} /> Notifications
          </button>
          <button className="item" role="menuitem" onClick={logout}>
            <Icon name="logout" size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [pathname]);

  // signed-out visitors (expired session) go to the sign-in page, remembering where they were
  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, router, pathname]);
  if (loading || !user) return <PageLoader label="Restoring your session…" />;

  const allowed = canAccessPath(user.role, pathname);
  const isActive = (i: { href: string; end?: boolean }) => (i.end ? pathname === i.href : pathname === i.href || pathname.startsWith(i.href + '/'));
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(user.role)) })).filter((g) => g.items.length);

  return (
    <div className="app">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Sidebar">
        <div className="brand">
          <Logo logo={settings.logo} />
          <span style={{ lineHeight: 1.2 }}>{settings.collegeName}</span>
        </div>
        <nav className="nav" aria-label="Main navigation">
          {groups.map((g) => (
            <div key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  className={isActive(i) ? 'active' : ''}
                  aria-current={isActive(i) ? 'page' : undefined}
                >
                  <Icon name={i.icon} size={17} /> {i.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon menu-btn" onClick={() => setOpen(true)} aria-label="Open navigation menu">
            <Icon name="menu" />
          </button>
          <div className="grow">
            <Breadcrumbs />
          </div>
          <NotificationBell />
          <UserMenu />
        </header>
        <main id="main-content" className="content" tabIndex={-1} style={{ outline: 'none' }}>
          {user.mustChangePassword && pathname !== '/profile' && (
            <div className="alert alert-warning" role="alert" style={{ marginBottom: 16 }}>
              You are signed in with a temporary password. <Link href="/profile">Change your password</Link> to secure your account.
            </div>
          )}
          {allowed ? (
            children
          ) : (
            <div className="state" role="alert" style={{ minHeight: '50vh' }}>
              <Icon name="shield" size={36} />
              <h3>Access denied</h3>
              <p>Your role does not have access to this page.</p>
              <Link className="btn btn-primary" href="/">
                Back to dashboard
              </Link>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
