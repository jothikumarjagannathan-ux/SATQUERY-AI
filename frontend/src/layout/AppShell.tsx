import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';

const NAV_SECTIONS: { label: string; items: { to: string; label: string; icon: string }[] }[] = [
  {
    label: 'Mission',
    items: [
      { to: '/', label: 'Dashboard', icon: '◈' },
      { to: '/new-analysis', label: 'New Analysis', icon: '✦' },
      { to: '/upload-analysis', label: 'Upload & Analyze', icon: '⇪' },
      { to: '/missions', label: 'Mission History', icon: '☰' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/region-intelligence', label: 'Region Intelligence', icon: '⬡' },
      { to: '/knowledge-graph', label: 'Knowledge Graph', icon: '◎' },
      { to: '/correlation', label: 'Cross-Domain Correlation', icon: '∿' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/models', label: 'Model Registry', icon: '▤' },
      { to: '/benchmark', label: 'Benchmark / Evaluation', icon: '▦' },
      { to: '/settings', label: 'Settings', icon: '⚙' },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-void text-ink-primary">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border-subtle bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-accent/40 bg-accent-soft text-accent">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none">
              <circle cx="12" cy="12" r="6.5" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div className="text-[13px] font-bold leading-none tracking-tight">SatQuery AI</div>
            <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.14em] text-ink-muted">
              Earth Observation Intelligence
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-5">
              <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
                        isActive
                          ? 'bg-accent-soft text-accent'
                          : 'text-ink-secondary hover:bg-white/5 hover:text-ink-primary',
                      )
                    }
                  >
                    <span className="w-4 text-center text-[13px] opacity-80">{item.icon}</span>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-border-subtle px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] text-ink-muted">
            <span className="h-1.5 w-1.5 animate-pulse-slow rounded-full bg-ok" />
            Prototype backend online
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}

export function TopBar({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border-subtle bg-surface/60 px-6 py-4 backdrop-blur">
      <div>
        <h1 className="text-lg font-bold text-ink-primary">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2.5">{actions}</div>}
    </header>
  );
}
