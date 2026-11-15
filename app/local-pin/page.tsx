import Link from 'next/link';
import { Lock } from 'lucide-react';

export default async function LocalPinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const invalid = params.invalid === '1';
  const disabled = params.disabled === '1';
  const limited = params.limited === '1';

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900/90 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-white">Local Quick Unlock</h1>
            <p className="text-xs text-slate-400">CORTEX Harness · Loopback PIN Auth</p>
          </div>
        </div>

        {invalid && (
          <div className="text-xs rounded-lg border border-red-500/30 bg-red-950/40 text-red-300 px-3 py-2">
            Invalid local PIN. Repeated failures trigger a 15-minute lockout.
          </div>
        )}
        {disabled && (
          <div className="text-xs rounded-lg border border-amber-500/30 bg-amber-950/40 text-amber-300 px-3 py-2">
            Local PIN unlock is disabled. Set AUTH_LOCAL_PIN (min 6 chars) and configure an owner account.
          </div>
        )}
        {limited && (
          <div className="text-xs rounded-lg border border-red-500/30 bg-red-950/40 text-red-300 px-3 py-2">
            Too many wrong attempts. PIN unlock is locked for 15 minutes; use password login instead.
          </div>
        )}

        <form method="POST" action="/api/auth/pin" className="space-y-4">
          <div>
            <label htmlFor="pin" className="block text-xs font-medium text-slate-300 mb-1.5">
              Local PIN (6+ characters)
            </label>
            <input
              id="pin"
              name="pin"
              type="password"
              minLength={6}
              required
              autoComplete="one-time-code"
              placeholder="Enter local PIN"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-800 bg-slate-950 text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors"
          >
            Unlock Workspace
          </button>
        </form>

        <div className="pt-2 border-t border-slate-800 text-center">
          <Link href="/" className="text-xs text-slate-400 hover:text-slate-200">
            Return to CORTEX Harness
          </Link>
        </div>
      </div>
    </main>
  );
}
