import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, Shield, ShieldCheck } from 'lucide-react';
import { loginAdmin, setupPrimaryAdmin, type AdminLoginResponse } from '@/src/services/api/adminApi';
import { ApiRequestError } from '@/src/services/api/client';

interface AdminLoginCardProps {
  setupRequired: boolean;
  authMode: 'named_accounts' | 'legacy_passcode_fallback' | 'setup_required';
  externalError: string | null;
  statusMessage: string | null;
  onAuthenticated: (session: {
    expiresAt: number;
    authMode: 'named_accounts' | 'legacy_passcode_fallback' | 'setup_required';
    account: Extract<AdminLoginResponse, { authenticated: true }>['account'];
    mfaMigrationRecommended: boolean;
  }) => void;
}

export function AdminLoginCard({
  setupRequired,
  authMode,
  externalError,
  statusMessage,
  onAuthenticated,
}: AdminLoginCardProps) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [useLegacyMode, setUseLegacyMode] = useState(false);

  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  const [localError, setLocalError] = useState<string | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setLockoutSeconds((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockoutSeconds]);

  const errorMessage = localError || externalError;
  const isLockedOut = lockoutSeconds > 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || isLockedOut) return;
    setLocalError(null);

    if (setupRequired) {
      if (username.trim().length < 3) {
        setLocalError('Enter your email or username (minimum 3 characters).');
        return;
      }
      if (displayName.trim().length < 2) {
        setLocalError('Enter your full name or display name.');
        return;
      }
      if (password.length < 10) {
        setLocalError(
          'Password must be at least 10 characters and include uppercase, lowercase, number, and symbol.'
        );
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match.');
        return;
      }

      setSubmitting(true);
      try {
        const res = await setupPrimaryAdmin({
          username: username.trim(),
          displayName: displayName.trim(),
          password,
        });
        setPassword('');
        setConfirmPassword('');
        onAuthenticated({
          expiresAt: res.expiresAt,
          authMode: res.authMode,
          account: res.account,
          mfaMigrationRecommended: res.mfaMigrationRecommended,
        });
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 429 && err.retryAfterSeconds) {
          setLockoutSeconds(err.retryAfterSeconds);
        }
        setLocalError(err instanceof Error ? err.message : 'Invalid sign-in details. Please try again.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (challengeToken) {
      if (!/^\d{6}$/.test(mfaCode.trim())) {
        setLocalError('Enter the 6-digit code from your authenticator app.');
        return;
      }

      setSubmitting(true);
      try {
        const res = await loginAdmin({
          challengeToken,
          mfaCode: mfaCode.trim(),
        });
        if (res.authenticated) {
          setChallengeToken(null);
          setMfaCode('');
          setPassword('');
          onAuthenticated({
            expiresAt: res.expiresAt,
            authMode: res.authMode,
            account: res.account,
            mfaMigrationRecommended: res.mfaMigrationRecommended,
          });
        }
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 429 && err.retryAfterSeconds) {
          setLockoutSeconds(err.retryAfterSeconds);
          setChallengeToken(null);
        }
        setLocalError('Invalid sign-in details. Please try again.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!password || (!useLegacyMode && authMode === 'named_accounts' && !username.trim())) {
      setLocalError('Enter your email/username and password.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await loginAdmin({
        username: useLegacyMode ? '' : username.trim(),
        password,
      });

      if (!res.authenticated && res.mfaRequired) {
        setChallengeToken(res.challengeToken);
        setPassword('');
        return;
      }

      if (res.authenticated) {
        setPassword('');
        onAuthenticated({
          expiresAt: res.expiresAt,
          authMode: res.authMode,
          account: res.account,
          mfaMigrationRecommended: res.mfaMigrationRecommended,
        });
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 429 && err.retryAfterSeconds) {
        setLockoutSeconds(err.retryAfterSeconds);
      }
      setLocalError('Invalid sign-in details. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen pt-28 pb-20 bg-[#0C153B] flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="max-w-md w-full rounded-xl border border-[#c4d835]/35 bg-[#121D52]/95 p-6 sm:p-8 space-y-5 shadow-[0_24px_70px_rgba(4,8,24,0.65)]"
      >
        <div className="flex items-center gap-3 pb-4 border-b border-white/10">
          {challengeToken ? (
            <ShieldCheck className="w-5 h-5 text-[#c4d835] shrink-0" aria-hidden="true" />
          ) : (
            <Shield className="w-5 h-5 text-[#c4d835] shrink-0" aria-hidden="true" />
          )}
          <div>
            <h1 className="font-display text-2xl font-bold uppercase text-white">
              {setupRequired
                ? 'Primary Admin Account Setup'
                : challengeToken
                ? 'Two-Factor Verification'
                : 'THE GRID Admin Desk'}
            </h1>
            <p className="text-xs text-slate-300">
              {setupRequired
                ? 'Create a named administrator account with a strong password.'
                : challengeToken
                ? 'Enter the 6-digit verification code from your authenticator app.'
                : 'Authorized administrators only. Sessions use secure HTTP-only cookies.'}
            </p>
          </div>
        </div>

        {statusMessage && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-[#c4d835]/35 bg-[#0B1338] px-3.5 py-2.5 text-xs text-[#c4d835]"
          >
            {statusMessage}
          </div>
        )}

        {setupRequired ? (
          <>
            <div>
              <label htmlFor="admin-username" className="block text-xs font-semibold text-slate-200 mb-1.5">
                Administrator email or username <span className="text-[#c4d835]">*</span>
              </label>
              <input
                id="admin-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin@thegrid.pk"
                className="w-full min-h-[46px] px-3.5 py-2.5 text-sm text-white bg-[#0B1338] border border-white/20 rounded-lg focus:outline-none focus:border-[#c4d835] focus-visible:ring-2 focus-visible:ring-[#c4d835]"
              />
            </div>

            <div>
              <label htmlFor="admin-display" className="block text-xs font-semibold text-slate-200 mb-1.5">
                Full Name / Display Name <span className="text-[#c4d835]">*</span>
              </label>
              <input
                id="admin-display"
                type="text"
                autoComplete="name"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Daniyal Hayyat"
                className="w-full min-h-[46px] px-3.5 py-2.5 text-sm text-white bg-[#0B1338] border border-white/20 rounded-lg focus:outline-none focus:border-[#c4d835] focus-visible:ring-2 focus-visible:ring-[#c4d835]"
              />
            </div>

            <div>
              <label htmlFor="admin-pass" className="block text-xs font-semibold text-slate-200 mb-1.5">
                Password <span className="text-[#c4d835]">*</span>
              </label>
              <div className="relative">
                <input
                  id="admin-pass"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby="admin-pass-rules"
                  className="w-full min-h-[46px] px-3.5 py-2.5 pr-12 text-sm text-white bg-[#0B1338] border border-white/20 rounded-lg focus:outline-none focus:border-[#c4d835] focus-visible:ring-2 focus-visible:ring-[#c4d835]"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-white p-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p id="admin-pass-rules" className="mt-1.5 text-[11px] text-slate-300 leading-relaxed">
                Minimum 10 characters with uppercase, lowercase, number, and symbol.
              </p>
            </div>

            <div>
              <label
                htmlFor="admin-pass-confirm"
                className="block text-xs font-semibold text-slate-200 mb-1.5"
              >
                Confirm Password <span className="text-[#c4d835]">*</span>
              </label>
              <input
                id="admin-pass-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full min-h-[46px] px-3.5 py-2.5 text-sm text-white bg-[#0B1338] border border-white/20 rounded-lg focus:outline-none focus:border-[#c4d835] focus-visible:ring-2 focus-visible:ring-[#c4d835]"
              />
            </div>
          </>
        ) : challengeToken ? (
          <div className="space-y-3">
            <div>
              <label htmlFor="admin-mfa" className="block text-xs font-semibold text-slate-200 mb-1.5">
                6-Digit Authenticator Code
              </label>
              <input
                id="admin-mfa"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="000000"
                className="w-full min-h-[48px] px-3.5 py-2.5 font-mono-tabular tracking-[0.28em] text-center text-lg text-white bg-[#0B1338] border border-white/20 rounded-lg focus:outline-none focus:border-[#c4d835] focus-visible:ring-2 focus-visible:ring-[#c4d835]"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setChallengeToken(null);
                setMfaCode('');
                setLocalError(null);
              }}
              className="text-xs text-slate-300 hover:text-white underline underline-offset-4 cursor-pointer"
            >
              Back to credentials sign-in
            </button>
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="admin-username" className="block text-xs font-semibold text-slate-200 mb-1.5">
                Administrator email or username <span className="text-[#c4d835]">*</span>
              </label>
              <input
                id="admin-username"
                type="text"
                autoComplete="username"
                required={!useLegacyMode}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin@thegrid.pk"
                className="w-full min-h-[46px] px-3.5 py-2.5 text-sm text-white bg-[#0B1338] border border-white/20 rounded-lg focus:outline-none focus:border-[#c4d835] focus-visible:ring-2 focus-visible:ring-[#c4d835]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="admin-pass" className="block text-xs font-semibold text-slate-200">
                  Password <span className="text-[#c4d835]">*</span>
                </label>
                <span className="text-[11px] text-slate-400">Forgot password? Contact super admin</span>
              </div>
              <div className="relative">
                <input
                  id="admin-pass"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full min-h-[46px] px-3.5 py-2.5 pr-12 text-sm text-white bg-[#0B1338] border border-white/20 rounded-lg focus:outline-none focus:border-[#c4d835] focus-visible:ring-2 focus-visible:ring-[#c4d835]"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-white p-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {authMode === 'legacy_passcode_fallback' && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setUseLegacyMode((prev) => !prev);
                    setLocalError(null);
                  }}
                  className="text-xs text-[#c4d835] hover:text-white underline underline-offset-4 cursor-pointer"
                >
                  {useLegacyMode ? 'Use named administrator account' : 'Use legacy access code'}
                </button>
                {useLegacyMode && (
                  <p className="mt-1.5 text-[11px] text-amber-300 leading-relaxed">
                    Legacy access will be retired. Use your administrator account where available.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {isLockedOut && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-lg border border-amber-400/40 bg-amber-950/40 px-3.5 py-2.5 text-xs text-amber-200 flex items-center gap-2"
          >
            <KeyRound className="w-4 h-4 shrink-0 text-amber-300" aria-hidden="true" />
            <span>
              Sign-in temporarily paused for <strong className="font-mono-tabular">{lockoutSeconds}s</strong> due to repeated failed attempts.
            </span>
          </div>
        )}

        {errorMessage && !isLockedOut && (
          <p role="alert" aria-live="polite" className="text-xs font-medium text-rose-300">
            {errorMessage}
          </p>
        )}

        <div className="space-y-3 pt-1">
          <button
            type="submit"
            disabled={submitting || isLockedOut}
            className="w-full min-h-[48px] px-5 py-3 text-sm font-bold uppercase tracking-wide text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {isLockedOut
              ? `Locked (${lockoutSeconds}s)`
              : submitting
              ? 'Signing in...'
              : setupRequired
              ? 'Create Primary Admin Account'
              : challengeToken
              ? 'Verify Code & Sign In'
              : 'Sign In'}
          </button>

          <div className="text-center pt-2">
            <a
              href="/"
              className="text-xs text-slate-300 hover:text-[#c4d835] transition-colors underline underline-offset-4"
            >
              &larr; Back to website
            </a>
          </div>
        </div>
      </form>
    </div>
  );
}
