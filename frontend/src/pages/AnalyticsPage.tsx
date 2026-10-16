import { useRef, useState, type DragEvent } from 'react';
import { Download, FileUp, TriangleAlert } from 'lucide-react';
import { useAnalyzeSales } from '../api/hooks';
import { errorMessage } from '../api/client';
import { PlotlyChart } from '../components/PlotlyChart';
import { Button, ErrorState, PageHeader, Spinner, StatCard } from '../components/ui';
import { formatNumber } from '../lib/format';

const MAX_MB = 5;

function downloadPng(b64: string, name: string) {
  const a = document.createElement('a');
  a.href = `data:image/png;base64,${b64}`;
  a.download = `${name}.png`;
  a.click();
}

export function AnalyticsPage() {
  const analyze = useAnalyzeSales();
  const [file, setFile] = useState<File | null>(null);
  const [includePng, setIncludePng] = useState(true);
  const [clientError, setClientError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    setClientError(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.csv')) return setClientError('Please choose a .csv file');
    if (f.size > MAX_MB * 1024 * 1024) return setClientError(`File is larger than ${MAX_MB} MB`);
    setFile(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files?.[0]);
  };

  const r = analyze.data;

  return (
    <>
      <PageHeader title="Sales analytics" subtitle="Upload a sales CSV (salesperson, revenue, region). Processed by the Python analytics service." />

      <section className="card">
        <div
          className={`dropzone ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
          aria-label="Choose or drop a CSV file"
        >
          <FileUp size={26} aria-hidden />
          <p><strong>{file ? file.name : 'Drop a CSV here or click to browse'}</strong></p>
          <p className="small muted">{file ? `${(file.size / 1024).toFixed(1)} KB` : `Columns: salesperson, revenue, region · max ${MAX_MB} MB`}</p>
          <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        <div className="upload-actions">
          <label className="checkbox">
            <input type="checkbox" checked={includePng} onChange={(e) => setIncludePng(e.target.checked)} />
            Also render PNG exports (Kaleido)
          </label>
          <Button disabled={!file} loading={analyze.isPending} onClick={() => file && analyze.mutate({ file, includePng })}>Analyze</Button>
        </div>
        {clientError && <div className="alert alert-error" role="alert">{clientError}</div>}
      </section>

      {analyze.isPending && <Spinner label="Crunching numbers…" />}
      {analyze.error && <ErrorState message={errorMessage(analyze.error)} />}

      {r && !analyze.isPending && (
        <>
          {r.warnings.length > 0 && (
            <div className="alert alert-warn" role="status">
              <TriangleAlert size={16} aria-hidden /> {r.warnings.join(' ')}
            </div>
          )}

          <div className="stat-grid">
            <StatCard label="Total revenue" value={formatNumber(r.summary.totalRevenue)} icon={<span>₹</span>} tone="accent" sub={`${r.summary.validRows} rows analysed`} />
            <StatCard label="Average deal" value={formatNumber(r.summary.averageRevenue)} icon={<span>x̄</span>} sub={`Median ${formatNumber(r.summary.medianRevenue)}`} />
            <StatCard label="Top region" value={r.summary.topRegion ?? '—'} icon={<span>◎</span>} sub={`${r.summary.regionCount} regions`} />
            <StatCard label="Top salesperson" value={r.summary.topSalesperson ?? '—'} icon={<span>★</span>} sub={`${r.summary.salespeopleCount} salespeople`} />
          </div>

          <div className="grid-2">
            <section className="card">
              <div className="card-head">
                <h2>Revenue by region</h2>
                {r.png?.revenueByRegion && <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={() => downloadPng(r.png!.revenueByRegion!, 'revenue-by-region')}>PNG</Button>}
              </div>
              <PlotlyChart figure={r.charts.revenueByRegion} label="Revenue by region bar chart" />
            </section>
            <section className="card">
              <div className="card-head">
                <h2>Top salespeople</h2>
                {r.png?.topSalespeople && <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={() => downloadPng(r.png!.topSalespeople!, 'top-salespeople')}>PNG</Button>}
              </div>
              <PlotlyChart figure={r.charts.topSalespeople} label="Top salespeople horizontal bar chart" />
            </section>
          </div>

          <section className="card">
            <div className="card-head"><h2>Summary statistics</h2></div>
            <dl className="stats-table">
              {([
                ['Rows (valid / total)', `${r.summary.validRows} / ${r.summary.totalRows}`],
                ['Total revenue', formatNumber(r.summary.totalRevenue)],
                ['Mean', formatNumber(r.summary.averageRevenue)],
                ['Median', formatNumber(r.summary.medianRevenue)],
                ['Std deviation', formatNumber(r.summary.stdDevRevenue)],
                ['Min / Max', `${formatNumber(r.summary.minRevenue)} / ${formatNumber(r.summary.maxRevenue)}`],
                ['25th / 75th percentile', `${formatNumber(r.summary.percentile25)} / ${formatNumber(r.summary.percentile75)}`],
              ] as const).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
            <div className="table-scroll">
              <table className="table compact">
                <thead><tr><th>Region</th><th className="right">Revenue</th><th className="right">Share</th><th className="right">Deals</th></tr></thead>
                <tbody>
                  {r.revenueByRegion.map((row) => (
                    <tr key={row.region}><td>{row.region}</td><td className="right">{formatNumber(row.revenue)}</td><td className="right">{row.share}%</td><td className="right">{row.deals}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
