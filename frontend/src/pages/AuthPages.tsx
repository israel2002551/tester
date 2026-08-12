import { ArrowLeft, ArrowRight, BadgeCheck, Check, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Store, Truck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { Seo } from '../components/Seo';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

type AuthMode = 'login' | 'signup' | 'forgot' | 'reset';
type Intent = 'buyer' | 'seller' | 'supplier';

const intentContent = {
  buyer: { title: 'Shop with confidence.', text: 'Discover verified sellers, pay securely and keep every order in one place.', icon: ShieldCheck },
  seller: { title: 'Build a store people trust.', text: 'Manage listings, orders, customers and payouts from one focused seller centre.', icon: Store },
  supplier: { title: 'Grow through business demand.', text: 'Respond to qualified requests and manage supply opportunities in one portal.', icon: Truck },
};

export function AuthPage({ mode, intent = 'buyer' }: { mode: AuthMode; intent?: Intent }) {
  const navigate = useNavigate();
  const { signIn, signUp, configured, authUser } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const content = intentContent[intent];
  const IntentIcon = content.icon;

  if (authUser && (mode === 'login' || mode === 'signup')) return <Navigate to={intent === 'seller' ? '/seller/onboarding' : intent === 'supplier' ? '/supplier/dashboard' : '/account'} replace />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    try {
      if (mode === 'login') {
        await signIn(email, password);
        navigate('/account');
      } else if (mode === 'signup') {
        const result = await signUp({ email, password, displayName: String(form.get('displayName') ?? ''), intent });
        if (result.confirmationRequired) setMessage('Check your inbox to confirm your email, then return to sign in.');
        else navigate(intent === 'seller' ? '/seller/onboarding' : intent === 'supplier' ? '/supplier/dashboard' : '/account');
      } else if (mode === 'forgot') {
        if (!supabase) throw new Error('Authentication is not configured.');
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (resetError) throw resetError;
        setMessage('If an account matches that email, a secure reset link is on its way.');
      } else {
        if (!supabase) throw new Error('Authentication is not configured.');
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;
        setMessage('Your password has been updated. You can continue to your account.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not complete that request.');
    } finally {
      setBusy(false);
    }
  };

  const titles = {
    login: ['Welcome back', 'Sign in to continue to BUYSELL.'],
    signup: [`Create your ${intent} account`, 'A better marketplace experience starts here.'],
    forgot: ['Reset your password', 'We’ll send a secure reset link to your email.'],
    reset: ['Choose a new password', 'Use at least eight characters and avoid reused passwords.'],
  } as const;

  return (
    <><Seo title={titles[mode][0]} noIndex /><main id="main-content" className="auth-page"><aside className="auth-page__story"><Brand inverse /><div><span className="auth-story-icon"><IntentIcon /></span><span className="eyebrow eyebrow--light">Buy. Sell. Smile.</span><h1>{content.title}</h1><p>{content.text}</p><ul><li><Check /> Protected marketplace activity</li><li><Check /> Clear updates from start to finish</li><li><Check /> Support when you need it</li></ul></div><small>Trusted commerce, made for Nigeria.</small></aside><section className="auth-page__form-wrap"><div className="auth-card"><Link className="back-link" to="/"><ArrowLeft /> Back to marketplace</Link><header><span className="auth-card__mobile-logo"><Brand /></span><h2>{titles[mode][0]}</h2><p>{titles[mode][1]}</p></header>{!configured && <div className="form-alert form-alert--warning">Authentication is not configured in this environment.</div>}{error && <div className="form-alert" role="alert">{error}</div>}{message ? <div className="auth-success"><span><BadgeCheck /></span><p>{message}</p>{mode === 'reset' && <Link className="button button--primary" to="/account">Continue <ArrowRight /></Link>}</div> : <form onSubmit={submit}>{mode === 'signup' && <label><span>Full name</span><input name="displayName" autoComplete="name" required /></label>}{mode !== 'reset' && <label><span>Email address</span><div className="input-with-icon"><Mail /><input name="email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" required /></div></label>}{mode !== 'forgot' && <label><span>{mode === 'reset' ? 'New password' : 'Password'}</span><div className="input-with-icon"><LockKeyhole /><input name="password" type={showPassword ? 'text' : 'password'} minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>}{mode === 'login' && <div className="auth-card__between"><label><input type="checkbox" /> Remember me</label><Link to="/forgot-password">Forgot password?</Link></div>}<button className="button button--primary button--full button--large" disabled={busy || !configured}>{busy ? <><span className="spinner spinner--small" /> Please wait</> : <>{mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Update password'} <ArrowRight /></>}</button>{mode === 'signup' && <small className="auth-terms">By continuing, you agree to the <Link to="/terms">Terms</Link> and acknowledge the <Link to="/privacy">Privacy Notice</Link>.</small>}</form>}<footer>{mode === 'login' ? <>New to BUYSELL? <Link to="/signup">Create an account</Link></> : mode === 'signup' ? <>Already have an account? <Link to="/login">Sign in</Link></> : <Link to="/login">Return to sign in</Link>}</footer></div></section></main></>
  );
}

export function SignupChoicePage() {
  return <><Seo title="Join BUYSELL" noIndex /><main id="main-content" className="choice-page"><Brand /><div><span className="eyebrow">Join the marketplace</span><h1>How will you use BUYSELL?</h1><p>Choose the path that fits today. One account can support more roles later.</p></div><section><Link to="/signup/buyer"><span><ShieldCheck /></span><div><h2>Shop as a buyer</h2><p>Discover products, save favourites and track protected orders.</p></div><ArrowRight /></Link><Link to="/signup/seller"><span><Store /></span><div><h2>Grow as a seller</h2><p>Open a storefront and manage commerce in one place.</p></div><ArrowRight /></Link><Link to="/signup/supplier"><span><Truck /></span><div><h2>Join as a supplier</h2><p>Respond to qualified business demand and supply requests.</p></div><ArrowRight /></Link></section><p>Already registered? <Link to="/login">Sign in</Link></p></main></>;
}

export function AuthCallbackPage() {
  const { authUser, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && authUser) navigate('/account', { replace: true });
  }, [authUser, loading, navigate]);
  return <main id="main-content" className="callback-page"><Brand /><span className="spinner" /><h1>Securing your session</h1><p>Please wait while we finish signing you in.</p>{!loading && !authUser && <Link className="button button--primary" to="/login">Return to sign in</Link>}</main>;
}
