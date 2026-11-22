import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, ShieldCheck, UserPlus } from 'lucide-react';
import {
  createAdminAccount,
  disableAdminMfa,
  enrollAdminMfa,
  fetchAdminAccounts,
  verifyAdminMfa,
} from '@/src/services/api/adminApi';
import type { AdminAccountSummary } from '@/src/types/booking';

interface AdminSecurityPanelProps {
  currentAccount: AdminAccountSummary;
  authMode: 'named_accounts' | 'legacy_passcode_fallback' | 'setup_required';
  onAccountUpdated: () => Promise<void>;
}

export function AdminSecurityPanel({
  currentAccount,
  authMode,
  onAccountUpdated,
}: AdminSecurityPanelProps) {
  const [accounts, setAccounts] = useState<AdminAccountSummary[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  // Create named admin form
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'ADMIN' | 'SUPER_ADMIN'>('ADMIN');
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<string | null>(null);

  // MFA enrollment/disable state
  const [mfaEnrollment, setMfaEnrollment] = useState<{
    secret: string;
    otpAuthUri: string;
  } | null>(null);
  const [mfaCodeInput, setMfaCodeInput] = useState('');
  const [disablePasswordInput, setDisablePasswordInput] = useState('');
  const [mfaFeedback, setMfaFeedback] = useState<string | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);

  const loadAccounts = async () => {
    setLoadingAccounts(true);
    setAccountsError(null);
    try {
      const list = await fetchAdminAccounts();
      setAccounts(list);
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : 'Unable to load admin accounts.');
    } finally {
      setLoadingAccounts(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
  }, []);

  const handleCreateAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (creatingAccount) return;
    setCreateFeedback(null);
    setCreatingAccount(true);

    try {
      const created = await createAdminAccount({
        username: newUsername.trim(),
        displayName: newDisplayName.trim(),
        password: newPassword,
        role: newRole,
      });
      setAccounts((prev) => [...prev, created]);
      setNewUsername('');
      setNewDisplayName('');
      setNewPassword('');
      setCreateFeedback(
        `Named administrator account "${created.username}" created. Sign in with this named account and enable MFA.`
      );
      await onAccountUpdated();
    } catch (err) {
      setCreateFeedback(err instanceof Error ? err.message : 'Unable to create administrator.');
    } finally {
      setCreatingAccount(false);
    }
  };

  const handleStartMfaEnroll = async () => {
    setMfaBusy(true);
    setMfaFeedback(null);
    try {
      const data = await enrollAdminMfa();
      setMfaEnrollment(data);
    } catch (err) {
      setMfaFeedback(err instanceof Error ? err.message : 'Unable to start MFA enrollment.');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleVerifyMfa = async (e: FormEvent) => {
    e.preventDefault();
    if (mfaBusy) return;
    setMfaBusy(true);
    setMfaFeedback(null);
    try {
      await verifyAdminMfa(mfaCodeInput.trim());
      setMfaEnrollment(null);
      setMfaCodeInput('');
      setMfaFeedback('Two-factor authentication is now enabled for your account.');
      await onAccountUpdated();
      await loadAccounts();
    } catch (err) {
      setMfaFeedback(err instanceof Error ? err.message : 'Invalid authenticator code.');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleDisableMfa = async (e: FormEvent) => {
    e.preventDefault();
    if (mfaBusy) return;
    setMfaBusy(true);
    setMfaFeedback(null);
    try {
      await disableAdminMfa(disablePasswordInput);
      setDisablePasswordInput('');
      setMfaFeedback('Two-factor authentication has been disabled.');
      await onAccountUpdated();
      await loadAccounts();
    } catch (err) {
      setMfaFeedback(err instanceof Error ? err.message : 'Unable to disable MFA.');
    } finally {
      setMfaBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {(authMode === 'legacy_passcode_fallback' || !currentAccount.mfaEnabled) && (
        <div
          role="status"
          className="rounded-xl border border-[#c4d835]/40 bg-[#192869] p-5 space-y-1.5"
        >
          <div className="text-sm font-bold text-[#c4d835]">
            {authMode === 'legacy_passcode_fallback'
              ? 'Migration Action Recommended: Replace Shared Passcode'
              : 'Security Recommendation: Enable Two-Factor Authentication (MFA)'}
          </div>
          <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
            {authMode === 'legacy_passcode_fallback'
              ? 'You signed in using the legacy shared passcode fallback. Create a named administrator account below, sign out, and sign back in with your personal credentials and MFA to retire shared passcodes.'
              : 'Protect your named administrator account with a 6-digit TOTP authenticator app below.'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* TOTP MFA Configuration */}
        <section className="rounded-xl border border-white/12 bg-[#121D52]/85 p-6 space-y-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-white/10">
            <ShieldCheck className="w-5 h-5 text-[#c4d835]" aria-hidden="true" />
            <div>
              <h2 className="font-display text-xl font-bold uppercase text-white">
                Two-Factor Authentication (TOTP MFA)
              </h2>
              <p className="text-xs text-slate-300">
                Signed in as <span className="text-white font-semibold">{currentAccount.username}</span>{' '}
                · MFA Status:{' '}
                <span className={currentAccount.mfaEnabled ? 'text-[#c4d835] font-semibold' : 'text-amber-300 font-semibold'}>
                  {currentAccount.mfaEnabled ? 'Enabled' : 'Not Enabled'}
                </span>
              </p>
            </div>
          </div>

          {currentAccount.role === 'LEGACY_SHARED' ? (
            <p className="text-xs text-slate-300 leading-relaxed">
              MFA requires an individual named administrator account. Create a named administrator
              account on the right, sign in as that user, and enable TOTP MFA there.
            </p>
          ) : currentAccount.mfaEnabled ? (
            <form onSubmit={handleDisableMfa} className="space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                Your account requires a 6-digit authenticator code at every sign-in. Confirm your
                current password only if you need to rotate or disable MFA.
              </p>
              <div>
                <label htmlFor="mfa-disable-pass" className="block text-xs font-semibold text-slate-200 mb-1">
                  Current Password
                </label>
                <input
                  id="mfa-disable-pass"
                  type="password"
                  required
                  value={disablePasswordInput}
                  onChange={(e) => setDisablePasswordInput(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 text-sm text-white bg-[#0B1338] border border-white/20 rounded-md focus:outline-none focus:border-[#c4d835]"
                />
              </div>
              <button
                type="submit"
                disabled={mfaBusy}
                className="px-4 py-2 min-h-[40px] text-xs font-semibold text-rose-200 bg-rose-950/60 hover:bg-rose-900/70 border border-rose-400/35 rounded-md cursor-pointer disabled:opacity-50"
              >
                Disable MFA
              </button>
            </form>
          ) : mfaEnrollment ? (
            <form onSubmit={handleVerifyMfa} className="space-y-4">
              <div className="rounded-lg border border-white/10 bg-[#0B1338] p-4 space-y-2 text-xs">
                <div className="font-semibold text-[#c4d835]">
                  1. Add Setup Key to Authenticator App
                </div>
                <p className="text-slate-300">
                  Enter this Base32 key into Google Authenticator, 1Password, or Microsoft Authenticator:
                </p>
                <div className="p-2.5 rounded bg-[#070A14] border border-white/10 font-mono-tabular text-sm font-bold text-white select-all break-all">
                  {mfaEnrollment.secret}
                </div>
              </div>

              <div>
                <label htmlFor="mfa-verify-code" className="block text-xs font-semibold text-slate-200 mb-1.5">
                  2. Enter 6-Digit Code to Activate
                </label>
                <input
                  id="mfa-verify-code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={mfaCodeInput}
                  onChange={(e) => setMfaCodeInput(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="123456"
                  className="w-full min-h-[44px] px-3.5 py-2 font-mono-tabular tracking-[0.22em] text-base text-white bg-[#0B1338] border border-white/20 rounded-md focus:outline-none focus:border-[#c4d835]"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={mfaBusy}
                  className="px-4 py-2 min-h-[40px] text-xs font-bold text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded-md cursor-pointer disabled:opacity-50"
                >
                  Verify &amp; Enable MFA
                </button>
                <button
                  type="button"
                  onClick={() => setMfaEnrollment(null)}
                  className="px-3 py-2 min-h-[40px] text-xs text-slate-300 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                Generate a time-based one-time passcode (TOTP) secret to require 2FA codes alongside
                your password on every admin login.
              </p>
              <button
                type="button"
                disabled={mfaBusy}
                onClick={() => void handleStartMfaEnroll()}
                className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[42px] text-xs font-bold text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded-md cursor-pointer disabled:opacity-50"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Set Up Authenticator MFA</span>
              </button>
            </div>
          )}

          {mfaFeedback && (
            <p role="status" className="text-xs text-[#c4d835]">
              {mfaFeedback}
            </p>
          )}
        </section>

        {/* Named Administrator Accounts */}
        <section className="rounded-xl border border-white/12 bg-[#121D52]/85 p-6 space-y-5">
          <div className="flex items-center gap-2.5 pb-3 border-b border-white/10">
            <UserPlus className="w-5 h-5 text-[#c4d835]" aria-hidden="true" />
            <div>
              <h2 className="font-display text-xl font-bold uppercase text-white">
                Named Administrator Accounts
              </h2>
              <p className="text-xs text-slate-300">
                Assign individual accounts instead of sharing a single venue passcode.
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateAccount} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="new-admin-user" className="block text-xs font-semibold text-slate-200 mb-1">
                  Username / Email
                </label>
                <input
                  id="new-admin-user"
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="manager@thegrid.pk"
                  className="w-full min-h-[42px] px-3 py-2 text-xs text-white bg-[#0B1338] border border-white/20 rounded-md focus:outline-none focus:border-[#c4d835]"
                />
              </div>
              <div>
                <label htmlFor="new-admin-name" className="block text-xs font-semibold text-slate-200 mb-1">
                  Display Name
                </label>
                <input
                  id="new-admin-name"
                  type="text"
                  required
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="Court Manager"
                  className="w-full min-h-[42px] px-3 py-2 text-xs text-white bg-[#0B1338] border border-white/20 rounded-md focus:outline-none focus:border-[#c4d835]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="new-admin-pass" className="block text-xs font-semibold text-slate-200 mb-1">
                  Strong Password (10+ chars, upper, lower, digit, symbol)
                </label>
                <input
                  id="new-admin-pass"
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 text-xs text-white bg-[#0B1338] border border-white/20 rounded-md focus:outline-none focus:border-[#c4d835]"
                />
              </div>
              <div>
                <label htmlFor="new-admin-role" className="block text-xs font-semibold text-slate-200 mb-1">
                  Role
                </label>
                <select
                  id="new-admin-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'ADMIN' | 'SUPER_ADMIN')}
                  className="w-full min-h-[42px] px-3 py-2 text-xs text-white bg-[#0B1338] border border-white/20 rounded-md focus:outline-none focus:border-[#c4d835]"
                >
                  <option value="ADMIN" className="bg-[#0B1338] text-white">ADMIN</option>
                  <option value="SUPER_ADMIN" className="bg-[#0B1338] text-white">SUPER_ADMIN</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={creatingAccount}
              className="px-4 py-2.5 min-h-[42px] text-xs font-bold uppercase tracking-wide text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded-md cursor-pointer disabled:opacity-50"
            >
              {creatingAccount ? 'Creating Account...' : 'Create Named Admin'}
            </button>

            {createFeedback && (
              <p role="status" className="text-xs text-[#c4d835]">
                {createFeedback}
              </p>
            )}
          </form>

          <div className="pt-3 border-t border-white/10 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Configured Administrator Directory
            </div>
            {loadingAccounts ? (
              <p className="text-xs text-slate-400">Loading administrator accounts...</p>
            ) : accountsError ? (
              <p role="alert" className="text-xs text-rose-300">{accountsError}</p>
            ) : accounts.length === 0 ? (
              <p className="text-xs text-slate-300">
                No named administrator accounts yet. Create the first named account above to replace shared passcodes.
              </p>
            ) : (
              <ul className="space-y-2 text-xs">
                {accounts.map((acc) => (
                  <li
                    key={acc.id}
                    className="rounded-lg border border-white/10 bg-[#0B1338]/85 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <span className="font-semibold text-white">{acc.displayName}</span>{' '}
                      <span className="text-slate-400">({acc.username})</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="text-slate-300">{acc.role}</span>
                      <span aria-hidden="true" className="text-slate-500">·</span>
                      <span className={acc.mfaEnabled ? 'text-[#c4d835] font-semibold' : 'text-amber-300'}>
                        {acc.mfaEnabled ? 'MFA Enabled' : 'MFA Pending'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
