import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Megaphone, Package, Pin, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAnnouncements, useDashboardStats } from '../api/hooks';
import { errorMessage } from '../api/client';
import { ErrorState, PageHeader, Spinner, StatCard } from '../components/ui';
import { formatNumber, STATUS_COLORS, statusLabel, timeAgo } from '../lib/format';

function Announcements() {
  const { data, isLoading, error } = useAnnouncements();
  return (
    <section className="card">
      <div className="card-head">
        <h2><Megaphone size={17} aria-hidden /> Intranet announcements</h2>
        {data && <span className="chip">{data.source === 'sharepoint' ? 'SharePoint' : 'Mock data'}</span>}
      </div>
      {isLoading ? <Spinner /> : error ? <ErrorState message={errorMessage(error)} /> : (
        <ul className="announcements">
          {data?.data.map((a) => (
            <li key={a.id}>
              <div className="ann-title">
                {a.pinned && <Pin size={14} className="pin" aria-label="Pinned" />}
                <strong>{a.title}</strong>
              </div>
              <p>{a.body}</p>
              <span className="small muted">{a.category} · {a.author} · {timeAgo(a.publishedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DashboardPage() {
  const { data, isLoading, error, refetch } = useDashboardStats();

  if (isLoading) return <Spinner label="Loading dashboard…" />;
  if (error || !data) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;

  const dist = data.statusDistribution.map((d) => ({ ...d, label: statusLabel(d.status), fill: STATUS_COLORS[d.status] }));
  const delivered = dist.find((d) => d.status === 'Delivered')?.count ?? 0;
  const exceptions = dist.find((d) => d.status === 'Exception')?.count ?? 0;
  const active = data.totalShipments - delivered - (dist.find((d) => d.status === 'Cancelled')?.count ?? 0);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live overview. Updates automatically when any shipment changes." />

      <div className="stat-grid">
        <StatCard label="Total customers" value={formatNumber(data.totalCustomers)} icon={<Users size={20} />} sub={<Link to="/customers">Manage customers →</Link>} />
        <StatCard label="Total shipments" value={formatNumber(data.totalShipments)} icon={<Package size={20} />} tone="accent" sub={`${formatNumber(active)} in progress`} />
        <StatCard label="Delivered" value={formatNumber(delivered)} icon={<CheckCircle2 size={20} />} sub={data.totalShipments ? `${Math.round((delivered / data.totalShipments) * 100)}% of all shipments` : '—'} />
        <StatCard label="Exceptions" value={formatNumber(exceptions)} icon={<AlertTriangle size={20} />} tone={exceptions ? 'warn' : 'default'} sub={exceptions ? <Link to="/shipments?status=Exception">Review exceptions →</Link> : 'All clear'} />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Shipment status distribution</h2></div>
          <div className="chart-wrap" role="img" aria-label="Bar chart of shipments per status">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dist} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={56} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip cursor={{ fill: 'var(--hover)' }} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {dist.map((d) => <Cell key={d.status} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Share by status</h2></div>
          <div className="donut-row">
            <div className="chart-wrap donut" role="img" aria-label="Donut chart of shipment status share">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={dist.filter((d) => d.count > 0)} dataKey="count" nameKey="label" innerRadius={58} outerRadius={92} paddingAngle={2} stroke="none">
                    {dist.filter((d) => d.count > 0).map((d) => <Cell key={d.status} fill={d.fill} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="legend">
              {dist.map((d) => (
                <li key={d.status}>
                  <span className="legend-dot" style={{ background: d.fill }} aria-hidden />
                  <span>{d.label}</span>
                  <strong>{d.count}</strong>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <Announcements />
    </>
  );
}
