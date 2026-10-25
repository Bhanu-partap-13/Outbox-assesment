import { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';
import { api } from '../api';
import { Alert } from './ui';

export default function Login() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const authError = new URLSearchParams(location.search).get('authError');
    if (authError) setError(authError === 'google_not_configured'
      ? 'Google sign-in is not configured yet. Ask the workspace administrator to finish setup.'
      : 'Google sign-in could not be completed. Please try again.');
    api<{ google: boolean }>('/auth/config').then(result => setConfigured(result.google))
      .catch(e => setError(e.message));
  }, []);
  return <main className="login-page">
    <section className="login-card">
      <div className="wordmark" style={{ margin: '0 0 16px', fontSize: '26px' }}>OUTBOX LABS</div>
      <h1>Login</h1>
      <a className="google-button" href="/api/auth/google"><LogIn size={16} />Login with Google</a>
      <p className="login-caption">Sign in to your Outbox Labs workspace</p>
      {error && <Alert>{error}</Alert>}
      {configured === false && !error && <p className="setup-note">Google sign-in setup is pending.</p>}
    </section>
  </main>;
}
