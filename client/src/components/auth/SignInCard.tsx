import { FormEvent, useState } from 'react';
import { signInWithPassword } from '../../services/firebase.js';

export function SignInCard() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signInWithPassword(email, password);
      setPassword('');
    } catch (signInError) {
      const code = signInError instanceof Error ? signInError.message : 'AUTHENTICATION_FAILED';
      setError(code.includes('invalid-credential') || code.includes('wrong-password') ? 'The email or password is incorrect.' : code === 'FIREBASE_CLIENT_NOT_CONFIGURED' ? 'Sign-in is not configured in this environment.' : 'Sign-in failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="card auth-card" aria-labelledby="sign-in-title">
    <p className="eyebrow">Authorized access</p>
    <h2 id="sign-in-title">Sign in to field operations</h2>
    <p className="note">Use the Firebase account assigned to your branch. Collections can be captured offline after the session is established.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <form className="portal-form" onSubmit={submit} noValidate>
      <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required disabled={busy} /></label>
      <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required disabled={busy} /></label>
      <button className="primary-button full-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </section>;
}