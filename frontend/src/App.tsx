import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from './auth/AuthContext';
import { RealtimeProvider } from './realtime/RealtimeContext';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CustomersPage } from './pages/CustomersPage';
import { ShipmentsPage } from './pages/ShipmentsPage';

// Heavier pages are code-split (Plotly, Markdown renderer)
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const AssistantPage = lazy(() => import('./pages/AssistantPage').then((m) => ({ default: m.AssistantPage })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <RealtimeProvider>{children}</RealtimeProvider>;
}

/** Last line of defence: a render error shows a recoverable screen instead of a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('UI error', error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="fatal">
          <h1>Something went wrong</h1>
          <p className="muted">{this.state.error.message}</p>
          <button className="btn btn-primary btn-md" onClick={() => window.location.assign('/')}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function NotFound() {
  return (
    <div className="state">
      <strong>Page not found</strong>
      <Link to="/">Back to dashboard</Link>
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<DashboardPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="shipments" element={<ShipmentsPage />} />
          <Route path="analytics" element={<Suspense fallback={<Spinner />}><AnalyticsPage /></Suspense>} />
          <Route path="assistant" element={<Suspense fallback={<Spinner />}><AssistantPage /></Suspense>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}



// Inside your main App component:
useEffect(() => {
  const ws = new WebSocket('ws://localhost:4000/ws');

  ws.onopen = () => console.log('WebSocket connected!');
  ws.onerror = (err) => console.error('WebSocket error:', err);

  return () => ws.close();
}, []);
