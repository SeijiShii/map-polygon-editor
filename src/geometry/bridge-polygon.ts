/**
 * Pure geometry functions for bridging two polygons.
 *
 * Given two polygon outer rings that share one or more contiguous edge
 * segments, and a user-drawn polyline connecting a vertex on ring A to
 * a vertex on ring B, computes the closed ring that fills the gap.
 */

// ============================================================
// Types
// ============================================================

export interface SharedVertex {
  aIdx: number;
  bIdx: number;
}

export interface SharedRun {
  /** Indices on ring A (in ring-order, ascending mod N_A). */
  aIndices: number[];
  /** Corresponding indices on ring B (may be ascending or descending). */
  bIndices: number[];
}

// ============================================================
// Public API
// ============================================================

/**
 * Computes a closed GeoJSON ring that bridges two polygon rings.
 *
 * @returns The closed ring `[lng,lat][]` or `null` when the rings share
 *          no vertices (bridge cannot be closed).
 */
export function computeBridgePolygon(
  ringA: number[][],
  ringB: number[][],
  aVertexIndex: number,
  bVertexIndex: number,
  bridgeLine: number[][],
  epsilon: number,
): number[][] | null {
  // Strip closing vertex if present (we work with non-closed rings internally)
  const rA = stripClosing(ringA);
  const rB = stripClosing(ringB);

  const shared = findSharedVertices(rA, rB, epsilon);
  if (shared.length === 0) return null;

  const runs = buildSharedRuns(shared, rA.length, rB.length);
  if (runs.length === 0) return null;

  const run = selectBestRun(runs, rA, rB, bridgeLine);

  // Determine which end of the shared run connects to A-side walk and B-side walk.
  // Walk A boundary: aVertexIndex → run's A-end (the end closest to aVertexIndex)
  // Walk B boundary: bVertexIndex → run's B-end (the end closest to bVertexIndex)
  const ring = assembleRing(rA, rB, aVertexIndex, bVertexIndex, bridgeLine, run);

  // Normalize to CCW
  if (signedArea(ring) < 0) {
    ring.reverse();
  }

  // Close the ring
  ring.push([...ring[0]!]);

  return ring;
}

// ============================================================
// Shared vertex detection
// ============================================================

export function findSharedVertices(
  ringA: number[][],
  ringB: number[][],
  epsilon: number,
): SharedVertex[] {
  const result: SharedVertex[] = [];
  for (let i = 0; i < ringA.length; i++) {
    for (let j = 0; j < ringB.length; j++) {
      if (
        Math.abs(ringA[i]![0]! - ringB[j]![0]!) < epsilon &&
        Math.abs(ringA[i]![1]! - ringB[j]![1]!) < epsilon
      ) {
        result.push({ aIdx: i, bIdx: j });
      }
    }
  }
  return result;
}

// ============================================================
// Shared run construction
// ============================================================

/**
 * Groups shared vertices into contiguous "runs" — sequences of vertices
 * that are consecutive on ring A and also consecutive on ring B.
 *
 * Adjacent polygons sharing an edge will have vertices going in opposite
 * directions on the two rings (A is CCW, B is CCW, so the shared edge
 * is traversed in opposite directions). We handle both same-direction
 * and opposite-direction runs.
 */
export function buildSharedRuns(
  shared: SharedVertex[],
  lenA: number,
  lenB: number,
): SharedRun[] {
  if (shared.length === 0) return [];

  // Build a map: aIdx → bIdx for quick lookup
  const aToB = new Map<number, number>();
  for (const s of shared) {
    aToB.set(s.aIdx, s.bIdx);
  }

  // Walk ring A in order, collecting contiguous runs
  // Sort shared vertices by aIdx
  const sortedByA = [...shared].sort((a, b) => a.aIdx - b.aIdx);

  const runs: SharedRun[] = [];
  let currentRun: SharedRun | null = null;

  for (const sv of sortedByA) {
    if (currentRun === null) {
      currentRun = { aIndices: [sv.aIdx], bIndices: [sv.bIdx] };
      continue;
    }

    const prevAIdx = currentRun.aIndices[currentRun.aIndices.length - 1]!;
    const prevBIdx = currentRun.bIndices[currentRun.bIndices.length - 1]!;

    const aConsecutive =
      sv.aIdx === (prevAIdx + 1) % lenA || sv.aIdx === prevAIdx + 1;

    // B can go in either direction (opposite or same)
    const bForward = sv.bIdx === (prevBIdx + 1) % lenB;
    const bBackward =
      sv.bIdx === (prevBIdx - 1 + lenB) % lenB;

    if (aConsecutive && (bForward || bBackward)) {
      currentRun.aIndices.push(sv.aIdx);
      currentRun.bIndices.push(sv.bIdx);
    } else {
      runs.push(currentRun);
      currentRun = { aIndices: [sv.aIdx], bIndices: [sv.bIdx] };
    }
  }

  if (currentRun) {
    runs.push(currentRun);
  }

  // Check if first and last runs should be merged (wrap-around on ring A)
  if (runs.length >= 2) {
    const first = runs[0]!;
    const last = runs[runs.length - 1]!;
    const lastAEnd = last.aIndices[last.aIndices.length - 1]!;
    const firstAStart = first.aIndices[0]!;

    if ((lastAEnd + 1) % lenA === firstAStart) {
      const lastBEnd = last.bIndices[last.bIndices.length - 1]!;
      const firstBStart = first.bIndices[0]!;
      const bForward = firstBStart === (lastBEnd + 1) % lenB;
      const bBackward = firstBStart === (lastBEnd - 1 + lenB) % lenB;

      if (bForward || bBackward) {
        // Merge: last + first
        last.aIndices.push(...first.aIndices);
        last.bIndices.push(...first.bIndices);
        runs.shift();
      }
    }
  }

  return runs;
}

// ============================================================
// Run selection
// ============================================================

/**
 * Selects the shared run whose midpoint is closest to the bridge line's
 * midpoint. This heuristic picks the most relevant shared edge when
 * multiple exist.
 */
export function selectBestRun(
  runs: SharedRun[],
  ringA: number[][],
  ringB: number[][],
  bridgeLine: number[][],
): SharedRun {
  if (runs.length === 1) return runs[0]!;

  // Compute bridge midpoint
  const mid = bridgeLine.length > 0
    ? midpoint(bridgeLine)
    : [0, 0];

  let bestRun = runs[0]!;
  let bestDist = Infinity;

  for (const run of runs) {
    // Use ring A coordinates for the run's midpoint
    const runCoords = run.aIndices.map((i) => ringA[i]!);
    const runMid = midpoint(runCoords);
    const d = dist2(mid, runMid);
    if (d < bestDist) {
      bestDist = d;
      bestRun = run;
    }
  }

  return bestRun;
}

// ============================================================
// Ring assembly
// ============================================================

function assembleRing(
  ringA: number[][],
  ringB: number[][],
  aStart: number,
  bStart: number,
  bridgeLine: number[][],
  run: SharedRun,
): number[][] {
  const nA = ringA.length;
  const nB = ringB.length;

  // Shared run endpoints on each ring
  const runAFirst = run.aIndices[0]!;
  const runALast = run.aIndices[run.aIndices.length - 1]!;
  const runBFirst = run.bIndices[0]!;
  const runBLast = run.bIndices[run.bIndices.length - 1]!;

  // We need to determine which end of the shared run connects to A's walk
  // and which end connects to B's walk.
  //
  // Walk A: from aStart → one end of the shared run (on ring A)
  // Walk B: from bStart → other end of the shared run (on ring B)
  //
  // Try both orientations and pick the one with shorter total boundary walk.
  const option1 = tryAssemble(
    ringA, ringB, aStart, bStart, bridgeLine,
    runAFirst, runALast, runBFirst, runBLast, run,
    nA, nB,
  );

  const option2 = tryAssemble(
    ringA, ringB, aStart, bStart, bridgeLine,
    runALast, runAFirst, runBLast, runBFirst, run,
    nA, nB,
  );

  // Pick option with fewer total intermediate vertices
  const len1 = option1.length;
  const len2 = option2.length;

  return len1 <= len2 ? option1 : option2;
}

function tryAssemble(
  ringA: number[][],
  ringB: number[][],
  aStart: number,
  bStart: number,
  bridgeLine: number[][],
  aRunEnd: number, // A walk target
  aRunOtherEnd: number, // Other end (connects to B side)
  bRunEnd: number, // B side corresponding to aRunOtherEnd
  bRunOtherEnd: number, // B walk target (corresponds to aRunEnd)
  run: SharedRun,
  nA: number,
  nB: number,
): number[][] {
  // Walk A boundary: aStart → aRunEnd (exclusive of aRunEnd itself,
  // but we need the shared vertices)
  const walkA = walkBoundary(ringA, aStart, aRunEnd, nA);

  // Walk B boundary: bStart → bRunOtherEnd
  const walkB = walkBoundary(ringB, bStart, bRunOtherEnd, nB);

  // Shared edge path: from aRunEnd → aRunOtherEnd (using ring A coordinates)
  // This is the shared edge segment between the two polygons
  const sharedPath = walkBoundary(ringA, aRunEnd, aRunOtherEnd, nA);

  // Assemble: bridge line + walk B (reversed, since we walk B from bStart
  // toward shared, but we need it from shared toward bStart for the ring)
  // Actually, let's think about the ring direction:
  //
  // Ring: aStart → (bridge) → bStart → (walk B) → bRunOtherEnd/shared →
  //       (shared edge) → aRunEnd → (walk A reversed) → aStart
  //
  // The ring is:
  // 1. bridgeLine (aStart → bStart)
  // 2. walkB (bStart → bRunOtherEnd) — includes intermediate vertices
  // 3. vertex at bRunOtherEnd (= aRunEnd on ring A)
  // 4. sharedPath (aRunEnd → aRunOtherEnd) — shared edge vertices
  // 5. vertex at aRunOtherEnd
  // 6. walkA reversed (aRunEnd ← aStart) — we walked aStart→aRunEnd,
  //    but we need aRunOtherEnd → aStart, so we use a reverse walk

  // Let's reconsider. The correct assembly is:
  // aStart --(bridge)--> bStart --(B boundary)--> bRunOtherEnd
  //   which corresponds to aRunEnd on A
  // aRunEnd --(shared on A)--> aRunOtherEnd
  //   which corresponds to bRunEnd on B... but this doesn't connect back.
  //
  // Simpler approach: just collect vertices in order.

  const result: number[][] = [];

  // 1. Bridge line points (includes aStart vertex and bStart vertex)
  for (const p of bridgeLine) {
    result.push(p);
  }

  // 2. Walk B boundary from bStart to bRunOtherEnd (intermediate vertices only)
  for (const p of walkB) {
    result.push(p);
  }

  // 3. bRunOtherEnd vertex (= the shared vertex, use ring B coordinate)
  result.push(ringB[bRunOtherEnd]!);

  // 4. Shared edge intermediate vertices (between aRunEnd and aRunOtherEnd on A)
  for (const p of sharedPath) {
    result.push(p);
  }

  // 5. aRunOtherEnd vertex
  result.push(ringA[aRunOtherEnd]!);

  // 6. Walk A from aRunOtherEnd back to aStart (intermediate only)
  const walkABack = walkBoundary(ringA, aRunOtherEnd, aStart, nA);
  for (const p of walkABack) {
    result.push(p);
  }

  return result;
}

// ============================================================
// Boundary walking
// ============================================================

/**
 * Walks the shorter path around a ring from index `from` to index `to`,
 * returning only the intermediate vertices (excludes `from` and `to`).
 */
export function walkBoundary(
  ring: number[][],
  from: number,
  to: number,
  ringLen: number,
): number[][] {
  if (from === to) return [];

  // Forward walk (increasing index)
  const fwd: number[][] = [];
  {
    let i = (from + 1) % ringLen;
    while (i !== to) {
      fwd.push(ring[i]!);
      i = (i + 1) % ringLen;
    }
  }

  // Backward walk (decreasing index)
  const bwd: number[][] = [];
  {
    let i = (from - 1 + ringLen) % ringLen;
    while (i !== to) {
      bwd.push(ring[i]!);
      i = (i - 1 + ringLen) % ringLen;
    }
  }

  return fwd.length <= bwd.length ? fwd : bwd;
}

// ============================================================
// Geometry helpers
// ============================================================

function stripClosing(ring: number[][]): number[][] {
  if (ring.length < 2) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring.slice(0, -1);
  }
  return ring;
}

function signedArea(ring: number[][]): number {
  let area = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = ring[i]!;
    const b = ring[j]!;
    area += a[0]! * b[1]!;
    area -= b[0]! * a[1]!;
  }
  return area / 2;
}

function midpoint(coords: number[][]): number[] {
  let sx = 0;
  let sy = 0;
  for (const c of coords) {
    sx += c[0]!;
    sy += c[1]!;
  }
  return [sx / coords.length, sy / coords.length];
}

function dist2(a: number[], b: number[]): number {
  const dx = a[0]! - b[0]!;
  const dy = a[1]! - b[1]!;
  return dx * dx + dy * dy;
}
