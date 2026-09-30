/** Line diff (LCS) for comparing two artifact versions. */

export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = before.split('\n');
  const b = after.split('\n');
  // Common prefix/suffix first: edits are usually local.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > MAX_CELLS) return null;

  const n = midA.length;
  const m = midB.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = a.slice(0, start).map(text => ({ type: 'same' as const, text }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) { out.push({ type: 'same', text: midA[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ type: 'del', text: midA[i++] });
    else out.push({ type: 'add', text: midB[j++] });
  }
  while (i < n) out.push({ type: 'del', text: midA[i++] });
  while (j < m) out.push({ type: 'add', text: midB[j++] });
  return out.concat(a.slice(endA).map(text => ({ type: 'same' as const, text })));
}
