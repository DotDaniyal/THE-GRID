import { useState, type FormEvent } from 'react';
import { Shield } from 'lucide-react';

interface AdminLoginCardProps {
  setupRequired: boolean;
  externalError: string | null;
  onAuthenticate: (passcode: string) => Promise<void>;
}

export function AdminLoginCard({
  setupRequired,
  externalError,
  onAuthenticate,
}: AdminLoginCardProps) {
  const [passcodeInput, setPasscodeInput] = useState('');
  const [confirmPasscodeInput, setConfirmPasscodeInput] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const errorMessage = localError || externalError;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (setupRequired) {
      if (passcodeInput.trim().length < 8) {
        setLocalError('Passcode must be at least 8 characters.');
        return;
      }
      if (passcodeInput !== confirmPasscodeInput) {
        setLocalError('Passcodes do not match.');
        return;
      }
    }

    setSubmitting(true);
    try {
      await onAuthenticate(passcodeInput);
      setPasscodeInput('');
      setConfirmPasscodeInput('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen pt-28 pb-20 bg-[#0C153B] flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="max-w-md w-full rounded-xl border border-[#c4d835]/35 bg-[#121D52]/95 p-6 sm:p-8 space-y-5 shadow-[0_24px_70px_rgba(4,8,24,0.65)]"
      >
        <div className="flex items-center gap-3 pb-4 border-b border-white/10">
          <Shield className="w-5 h-5 text-[#c4d835]" />
          <div>
            <h1 className="font-display text-2xl font-bold uppercase text-white">
              {setupRequired ? 'First-Run Admin Setup' : 'THE GRID Admin Desk'}
            </h1>
            <p className="text-xs text-slate-300">
              {setupRequired
                ? 'Create an admin passcode to lock booking management.'
                : 'Authorized administrators only.'}
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="admin-pass" className="block text-xs font-semibold text-slate-200 mb-1.5">
            {setupRequired ? 'Create Admin Passcode (min. 8 characters)' : 'Admin Passcode'}
          </label>
          <input
            id="admin-pass"
            type="password"
            required
            value={passcodeInput}
            onChange={(e) => setPasscodeInput(e.target.value)}
            className="w-full min-h-[46px] px-3.5 py-2.5 text-sm text-white bg-[#0B1338] border border-white/20 rounded-lg focus:outline-none focus:border-[#c4d835]"
          />
        </div>

        {setupRequired && (
          <div>
            <label
              htmlFor="admin-pass-confirm"
              className="block text-xs font-semibold text-slate-200 mb-1.5"
            >
              Confirm Passcode
            </label>
            <input
              id="admin-pass-confirm"
              type="password"
              required
              value={confirmPasscodeInput}
              onChange={(e) => setConfirmPasscodeInput(e.target.value)}
              className="w-full min-h-[46px] px-3.5 py-2.5 text-sm text-white bg-[#0B1338] border border-white/20 rounded-lg focus:outline-none focus:border-[#c4d835]"
            />
          </div>
        )}

        {errorMessage && (
          <p role="alert" className="text-xs font-medium text-rose-300">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-[48px] px-5 py-3 text-sm font-bold uppercase tracking-wide text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded-lg transition-colors cursor-pointer"
        >
          {submitting
            ? 'Authenticating...'
            : setupRequired
            ? 'Save Passcode & Open Desk'
            : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
