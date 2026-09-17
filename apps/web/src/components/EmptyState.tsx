"use client";

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white/70 p-8">
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--ink-soft)]">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
