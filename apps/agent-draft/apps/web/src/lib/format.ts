export function usd(n: number | null | undefined, digits = 4): string {
  if (n === null || n === undefined) return 'unknown';
  if (n === 0) return '$0';
  return n < 0.01 ? `$${n.toFixed(digits)}` : `$${n.toFixed(2)}`;
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

export const CLI_LABELS: Record<string, string> = {
  claude_code: 'Claude Code (subscription)',
  codex: 'Codex CLI (subscription)',
  gemini_cli: 'Gemini CLI (subscription)',
};
