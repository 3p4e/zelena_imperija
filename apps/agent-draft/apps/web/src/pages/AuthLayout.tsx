import type { ReactNode } from 'react';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-lg">
        <div className="mb-5 flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="size-6" />
          <span className="text-lg font-semibold">ANVIL</span>
        </div>
        <h1 className="mb-4 text-sm font-medium text-zinc-300">{title}</h1>
        {children}
      </div>
    </div>
  );
}
