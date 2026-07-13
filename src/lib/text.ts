const STOP_WORDS = new Set([
  '一个',
  '不是',
  '以及',
  '通过',
  '进行',
  '需要',
  '能够',
  '如果',
  '来自',
  '之后',
  'the',
  'and',
  'for',
  'with',
  'that',
]);

export function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/[。！？!?；;\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 8);
}

export function pickTopTerms(text: string, limit = 8): string[] {
  const matches = text.match(/[A-Za-z][A-Za-z0-9-]{2,}|[\u4e00-\u9fa5]{2,8}/g) ?? [];
  const counts = new Map<string, number>();

  for (const raw of matches) {
    const term = raw.trim();
    if (term.length < 2 || STOP_WORDS.has(term)) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([term]) => term);
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function uniqueList(items: string[], limit = 8): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }

  return result;
}
