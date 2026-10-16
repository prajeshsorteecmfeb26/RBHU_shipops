import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../api/client';
import { Button, TextField } from '../components/ui';
import { loginSchema, type LoginValues } from '../schemas';

const DEMO_USERS = [
  { label: 'Admin', email: 'admin@shipops.local', password: 'Admin@123', note: 'full access incl. delete' },
  { label: 'Operator', email: 'operator@shipops.local', password: 'Operator@123', note: 'create & update' },
  { label: 'Viewer', email: 'viewer@shipops.local', password: 'Viewer@123', note: 'read-only' },
];

export function LoginPage() {
  const { user, login, logoutReason } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const from = (location.state as { from?: string } | null)?.from ?? '/';
  if (user) return <Navigate to={from} replace />;

  const onSubmit = async (v: LoginValues) => {
    setServerError(null);
    try {
      await login(v.email, v.password);
      navigate(from, { replace: true });
    } catch (err) {
      setServerError(errorMessage(err));
    }
  };

  return (
    <div className="login-page">
      <div className="login-art" aria-hidden>
        <div className="login-art-inner">
          <img src="/favicon.svg" alt="" width={48} height={48} />
          <h2>ShipOps Console</h2>
          <p>Customers, shipments, sales analytics and an AI assistant, with live status updates across your team.</p>
          <div className="route-line">
            <span>Mumbai</span><i /><span>Pune</span><i /><span>Bengaluru</span>
          </div>
        </div>
      </div>

      <div className="login-panel">
        <form className="login-card" onSubmit={handleSubmit(onSubmit)} noValidate>
          <h1>Sign in</h1>
          <p className="muted">Mock authentication for the assessment. In production this is Microsoft Entra ID single sign-on.</p>

          {(serverError || logoutReason) && (
            <div className="alert alert-error" role="alert">{serverError ?? logoutReason}</div>
          )}

          <TextField label="Email" type="email" autoComplete="username" error={errors.email?.message} {...register('email')} />
          <TextField label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
          <Button type="submit" loading={isSubmitting} icon={<LogIn size={16} />} className="btn-block">Sign in</Button>

          <div className="demo-users">
            <p className="small muted">Demo accounts (seeded):</p>
            {DEMO_USERS.map((u) => (
              <button
                type="button"
                key={u.email}
                className="demo-user"
                onClick={() => {
                  setValue('email', u.email, { shouldValidate: true });
                  setValue('password', u.password, { shouldValidate: true });
                }}
              >
                <strong>{u.label}</strong>
                <span className="small muted">{u.note}</span>
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
