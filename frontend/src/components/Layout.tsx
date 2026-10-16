import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, Bell, Bot, LayoutDashboard, LogOut, Menu, Package, Users, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useRealtime } from '../realtime/RealtimeContext';
import { statusLabel, timeAgo } from '../lib/format';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/shipments', label: 'Shipments', icon: Package },
  { to: '/analytics', label: 'Sales analytics', icon: BarChart3 },
  { to: '/assistant', label: 'AI assistant', icon: Bot },
];

function ConnectionPill() {
  const { state } = useRealtime();
  const label = state === 'open' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Offline';
  return (
    <span className={`conn conn-${state}`} title={`Real-time updates: ${label}`}>
      <span className="conn-dot" aria-hidden /> {label}
    </span>
  );
}

function NotificationBell() {
  const { feed, unread, markRead } = useRealtime();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="bell" ref={ref}>
      <button
        className="icon-btn"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          markRead();
        }}
      >
        <Bell size={19} />
        {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Recent notifications">
          <p className="bell-title">Live shipment activity</p>
          {feed.length === 0 ? (
            <p className="muted small">No events yet. Status changes made by anyone will appear here instantly.</p>
          ) : (
            <ul>
              {feed.map((e, i) => (
                <li key={`${e.shipmentId}-${e.timestamp}-${i}`}>
                  <span className="mono">{e.trackingNumber}</span>
                  <span>
                    {e.event === 'shipment_created' ? 'created' : `${statusLabel(e.previousStatus)} → ${statusLabel(e.status)}`}
                  </span>
                  <span className="muted small">{e.changedBy} · {timeAgo(e.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>ShipOps</span>
          <button className="icon-btn nav-close" onClick={() => setNavOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <nav aria-label="Main">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={18} aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="avatar" aria-hidden>{user?.name.slice(0, 1)}</span>
            <div>
              <p className="user-name">{user?.name}</p>
              <p className="user-role">{user?.role.toLowerCase()}</p>
            </div>
          </div>
          <button className="nav-link logout" onClick={() => logout()}>
            <LogOut size={18} aria-hidden /> Sign out
          </button>
        </div>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn nav-toggle" onClick={() => setNavOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <div className="topbar-right">
            <ConnectionPill />
            <NotificationBell />
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
