/**
 * Minimal line diff used by the **pre-save XML diff** (docs/IMPLEMENTATION_PLAN.md
 * §2.6): before a theme web resource is overwritten, the user must be able to
 * see exactly what changes — including anything the UI can't edit but the
 * round trip preserves.
 *
 * Pure and dependency-free; a classic LCS diff is more than enough for files
 * of a few dozen lines.
 */

export type DiffKind = 'context' | 'added' | 'removed';

export interface DiffLine {
    kind: DiffKind;
    text: string;
}

function splitLines(text: string): string[] {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\s+$/, '');
    return normalized === '' ? [] : normalized.split('\n');
}

/** Longest-common-subsequence line diff between two XML documents. */
export function diffLines(before: string, after: string): DiffLine[] {
    const left = splitLines(before);
    const right = splitLines(after);

    // lengths[i][j] = LCS length of left[i..] and right[j..]
    const lengths: number[][] = Array.from({ length: left.length + 1 }, () => Array.from({ length: right.length + 1 }, () => 0));
    for (let i = left.length - 1; i >= 0; i -= 1) {
        for (let j = right.length - 1; j >= 0; j -= 1) {
            lengths[i][j] = left[i] === right[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
        }
    }

    const result: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
        if (left[i] === right[j]) {
            result.push({ kind: 'context', text: left[i] });
            i += 1;
            j += 1;
        } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
            result.push({ kind: 'removed', text: left[i] });
            i += 1;
        } else {
            result.push({ kind: 'added', text: right[j] });
            j += 1;
        }
    }
    while (i < left.length) {
        result.push({ kind: 'removed', text: left[i] });
        i += 1;
    }
    while (j < right.length) {
        result.push({ kind: 'added', text: right[j] });
        j += 1;
    }

    return result;
}

/** True when the two documents are identical once line endings are normalised. */
export function hasChanges(diff: DiffLine[]): boolean {
    return diff.some((line) => line.kind !== 'context');
}
