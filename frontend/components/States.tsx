// Shared loading / empty / error states, so every page handles them the same way.

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`kg-skeleton ${className}`} aria-hidden="true" />;
}

export function LoadingBlock({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-5 ${i % 3 === 2 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line px-5 py-8 text-center">
      <p className="font-serif text-lg text-ink">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-[15px] text-dust">{children}</div>}
    </div>
  );
}

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-md border border-rust/30 bg-rust-soft px-5 py-5">
      <p className="font-medium text-rust">{title}</p>
      <p className="mt-1 text-[15px] text-ink">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded border border-rust/40 bg-paper px-3 py-1.5 text-sm font-medium text-rust hover:bg-sand"
        >
          Try again
        </button>
      )}
    </div>
  );
}
