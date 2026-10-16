import { useEffect, useRef } from 'react';

type PlotlyModule = typeof import('plotly.js-dist-min');

/**
 * Renders a Plotly figure produced by the analytics service.
 * plotly.js is large, so it is imported lazily and only on the Analytics page.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function PlotlyChart({ figure, label }: { figure: { data: any[]; layout: any }; label: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    let cancelled = false;
    let plotly: PlotlyModule | null = null;

    import('plotly.js-dist-min').then((mod) => {
      if (cancelled || !el) return;
      plotly = mod;
      // The card already shows a heading, so drop the in-chart title (kept for PNG exports)
      const layout = { ...figure.layout, title: undefined, margin: { ...figure.layout?.margin, t: 40 }, autosize: true, height: figure.layout?.height ?? 380 };
      mod.react(el, figure.data, layout, {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      });
    });

    // Purge synchronously and only what this effect drew; an async purge here would
    // race the next render (React StrictMode runs effects twice) and wipe the chart.
    return () => {
      cancelled = true;
      if (plotly && el) plotly.purge(el);
    };
  }, [figure]);

  return <div ref={ref} className="plotly-chart" role="img" aria-label={label} />;
}
