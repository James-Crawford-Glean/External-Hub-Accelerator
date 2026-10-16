// Notification bell: an unread-count bubble and a dropdown of in-app
// notifications. Opening one marks it read and follows its href.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { fetchNotifications, markNotificationRead, type AppNotification } from '../../lib/api/notifications';

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const next = await fetchNotifications();
        if (!cancelled) setAlerts(next);
      } catch {
        if (!cancelled) setAlerts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, refreshKey]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openAlert = useCallback((n: AppNotification) => {
    setOpen(false);
    setAlerts((prev) => prev.filter((a) => a.id !== n.id));
    void markNotificationRead(n.id).then(() => setRefreshKey((k) => k + 1));
  }, []);

  const count = alerts.length;
  return (
    <div className="ps-topbar__new ps-notif" ref={ref}>
      <button
        type="button"
        className="ps-topbar__icon-btn"
        aria-label={count ? `Notifications (${count})` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={16} />
        {count > 0 && <span className="ps-notif__count">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="ps-topbar__new-menu ps-notif__menu" role="menu">
          <div className="ps-notif__header">
            <span>Notifications</span>
            {count > 0 && <span className="ps-notif__meta">{count} unread</span>}
          </div>
          <div className="ps-notif__list">
            {alerts.length === 0 ? (
              <div className="ps-notif__empty">{loading ? 'Loading…' : 'No new notifications'}</div>
            ) : (
              alerts.map((n) => (
                <Link key={n.id} to={n.href} className="ps-notif__link" onClick={() => openAlert(n)}>
                  <span className="ps-notif__title">{n.title}</span>
                  {n.body && <span className="ps-notif__meta">{n.body}</span>}
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
