import { Vector3 } from "three";
import type { EstimationAssumptions } from "../sim/types";
import type { Track } from "./types";

/**
 * Distance passive (ARCHITECTURE_SIMULATION.md §5, CONCEPTION_DETECTION.md §13) : retrouver la
 * position et la vitesse d'un contact à partir de gisements seuls, mesurés depuis des positions
 * différentes. Un seul calcul couvre deux situations :
 * - triangulation : des gisements d'alliés, reçus par la liaison de données, recoupent les nôtres ;
 * - manœuvre : nos propres gisements, pris pendant que nous nous déplaçons de côté (méthode des
 *   sous-marins, « TMA »).
 *
 * Modèle : cible à vitesse constante sur la fenêtre, p(t) = p + v·(t − maintenant). Chaque gisement
 * b mesuré depuis o impose que la cible soit sur ce rayon : (I − b·bᵀ)·(p(t) − o) = 0. Moindres
 * carrés pondérés (estimateur « pseudo-linéaire »), deux passes pour pondérer chaque mesure par
 * distance × précision du capteur. Ne lit que des mesures : jamais la vérité.
 */

export const DEFAULT_PASSIVE_RANGING_MAX_RELATIVE_UNCERTAINTY = 0.25;
/**
 * Manœuvre de la cible tolérée pendant la fenêtre (G). C'est l'hypothèse de la méthode réelle :
 * cap et vitesse à peu près constants pendant la mesure. Supposer qu'elle peut accélérer autant
 * que nous rendrait notre propre manœuvre indiscernable de la sienne. Une vraie manœuvre se voit
 * à l'écart des mesures au modèle, et la solution est alors rejetée.
 */
export const DEFAULT_PASSIVE_RANGING_MANEUVER_G = 0.1;
const STANDARD_GRAVITY_MPS2 = 9.80665;
/** En dessous, la géométrie ne peut pas contraindre six inconnues avec une marge de bruit. */
const MIN_FIXES = 4;
/** Écart des mesures au modèle (en écarts-types) au-delà duquel la solution est rejetée (association douteuse, manœuvre). */
const MAX_NORMALIZED_RESIDUAL = 3;
/** Information a priori très faible sur la position : évite une matrice singulière sans rien imposer. */
const POSITION_PRIOR_SIGMA_METERS = 1e9;

export type PassiveRangingMethod = "triangulation" | "manoeuvre";

export interface PassiveRangeSolution {
  position: Vector3;
  /** Absente si les mesures ne la contraignent pas mieux que la vitesse maximale supposée. */
  velocity?: Vector3;
  rangeUncertaintyMeters: number;
  crossRangeUncertaintyMeters: number;
  velocityUncertaintyMps: number;
  method: PassiveRangingMethod;
  normalizedResidual: number;
}

interface Fix {
  tau: number;
  observer: Vector3;
  bearing: Vector3;
  sigmaRad: number;
  remote: boolean;
}

/** Gisements datés de la fenêtre, les nôtres et ceux des alliés, avec la position d'où ils ont été pris. */
function collectFixes(track: Track, simTime: number, windowSeconds: number): Fix[] {
  const fixes: Fix[] = [];
  const start = simTime - windowSeconds;
  for (const fix of track.passiveFixes ?? []) {
    if (!fix.observerPositionWorld || fix.simTime < start) continue;
    fixes.push({ tau: fix.simTime - simTime, observer: fix.observerPositionWorld, bearing: fix.bearingWorld, sigmaRad: fix.uncertaintyRad, remote: false });
  }
  for (const fix of track.remoteBearingFixes ?? []) {
    if (fix.simTime < start) continue;
    fixes.push({ tau: fix.simTime - simTime, observer: fix.observerPositionWorld, bearing: fix.bearingWorld, sigmaRad: fix.uncertaintyRad, remote: true });
  }
  return fixes;
}

/** Projecteur orthogonal au gisement b (3×3, ligne par ligne). */
function perpendicularProjector(b: Vector3): number[][] {
  const v = [b.x, b.y, b.z];
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) - v[i] * v[j]));
}

/** Inverse d'une matrice carrée (Gauss-Jordan, pivot partiel) ; null si quasi singulière. */
export function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const a = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    const scale = Math.max(...a[col].slice(0, n).map(Math.abs), 1e-300);
    if (Math.abs(a[pivot][col]) < 1e-14 * scale) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const p = a[col][col];
    for (let j = 0; j < 2 * n; j++) a[col][j] /= p;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row.slice(n));
}

interface LeastSquares {
  x: number[];
  covariance: number[][];
  chiSquare: number;
}

/**
 * Une passe de moindres carrés. `ranges[i]` : distance supposée de la cible au moment de la mesure i
 * (pondération) ; `maneuver` : accélération non modélisée supposée (m/s²), qui rend les mesures
 * anciennes moins sûres.
 */
function solveOnce(fixes: Fix[], ranges: number[], maneuver: number, velocityPriorSigma: number, positionPrior: Vector3): LeastSquares | null {
  const normal = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  const rhs = new Array<number>(6).fill(0);
  const weights: number[] = [];
  fixes.forEach((fix, i) => {
    const lateralSigma = ranges[i] * fix.sigmaRad;
    const modelSigma = 0.5 * maneuver * fix.tau * fix.tau;
    const w = 1 / Math.max(lateralSigma * lateralSigma + modelSigma * modelSigma, 1);
    weights.push(w);
    const P = perpendicularProjector(fix.bearing);
    const o = [fix.observer.x, fix.observer.y, fix.observer.z];
    for (let r = 0; r < 3; r++) {
      const po = P[r][0] * o[0] + P[r][1] * o[1] + P[r][2] * o[2];
      rhs[r] += w * po;
      rhs[r + 3] += w * fix.tau * po;
      for (let c = 0; c < 3; c++) {
        normal[r][c] += w * P[r][c];
        normal[r][c + 3] += w * fix.tau * P[r][c];
        normal[r + 3][c] += w * fix.tau * P[r][c];
        normal[r + 3][c + 3] += w * fix.tau * fix.tau * P[r][c];
      }
    }
  });
  const positionPriorWeight = 1 / (POSITION_PRIOR_SIGMA_METERS * POSITION_PRIOR_SIGMA_METERS);
  const prior = [positionPrior.x, positionPrior.y, positionPrior.z];
  const velocityPriorWeight = 1 / (velocityPriorSigma * velocityPriorSigma);
  for (let i = 0; i < 3; i++) {
    normal[i][i] += positionPriorWeight;
    rhs[i] += positionPriorWeight * prior[i];
    normal[i + 3][i + 3] += velocityPriorWeight;
  }

  const covariance = invertMatrix(normal);
  if (!covariance) return null;
  const x = covariance.map((row) => row.reduce((sum, value, j) => sum + value * rhs[j], 0));

  let chiSquare = 0;
  fixes.forEach((fix, i) => {
    const target = new Vector3(x[0] + x[3] * fix.tau, x[1] + x[4] * fix.tau, x[2] + x[5] * fix.tau);
    const offset = target.sub(fix.observer);
    const lateral = offset.addScaledVector(fix.bearing, -offset.dot(fix.bearing));
    chiSquare += weights[i] * lateral.lengthSq();
  });
  return { x, covariance, chiSquare };
}

/** Plus grande valeur propre d'une matrice 2×2 symétrique. */
function largestEigenvalue2(a: number, b: number, d: number): number {
  const mean = (a + d) / 2;
  return mean + Math.sqrt(Math.max(0, ((a - d) / 2) ** 2 + b * b));
}

function quadratic(m: number[][], u: Vector3, v: Vector3): number {
  const a = [u.x, u.y, u.z];
  const b = [v.x, v.y, v.z];
  let sum = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) sum += a[i] * m[i][j] * b[j];
  return sum;
}

/**
 * Position et vitesse estimées à `simTime` d'après les gisements de la piste (les nôtres et ceux
 * des alliés), ou `null` si la géométrie ne donne pas une distance assez sûre : observateurs
 * alignés avec la cible, pas de déplacement latéral, trop peu de mesures, mesures incohérentes.
 */
export function solvePassiveRange(track: Track, ownPositionWorld: Vector3, simTime: number, assumptions: EstimationAssumptions): PassiveRangeSolution | null {
  const fixes = collectFixes(track, simTime, assumptions.velocityWindowSeconds);
  if (fixes.length < MIN_FIXES) return null;

  const maneuver = (assumptions.passiveRangingManeuverG ?? DEFAULT_PASSIVE_RANGING_MANEUVER_G) * STANDARD_GRAVITY_MPS2;
  const velocityPriorSigma = Math.max(assumptions.unknownSpeedMps, 1);
  const latest = fixes.reduce((a, b) => (a.tau >= b.tau ? a : b));
  const guessRange = track.positionEstimateWorld ? track.positionEstimateWorld.distanceTo(ownPositionWorld) : 1e6;
  const positionPrior = latest.observer.clone().addScaledVector(latest.bearing, guessRange);

  // Première passe : poids selon la seule précision angulaire ; seconde : selon la distance trouvée.
  const first = solveOnce(fixes, fixes.map(() => guessRange), maneuver, velocityPriorSigma, positionPrior);
  if (!first) return null;
  const ranges = fixes.map((fix) => {
    const target = new Vector3(first.x[0] + first.x[3] * fix.tau, first.x[1] + first.x[4] * fix.tau, first.x[2] + first.x[5] * fix.tau);
    return Math.max(1, target.distanceTo(fix.observer));
  });
  const solution = solveOnce(fixes, ranges, maneuver, velocityPriorSigma, positionPrior);
  if (!solution) return null;

  const position = new Vector3(solution.x[0], solution.x[1], solution.x[2]);
  const velocity = new Vector3(solution.x[3], solution.x[4], solution.x[5]);
  // La cible doit être devant chaque observateur, sur chaque rayon mesuré.
  for (const fix of fixes) {
    if (position.clone().addScaledVector(velocity, fix.tau).sub(fix.observer).dot(fix.bearing) <= 0) return null;
  }
  const lineOfSight = position.clone().sub(ownPositionWorld);
  const range = lineOfSight.length();
  if (range < 1) return null;
  lineOfSight.divideScalar(range);

  const degreesOfFreedom = Math.max(1, 2 * fixes.length - 6);
  const normalizedResidual = Math.sqrt(solution.chiSquare / degreesOfFreedom);
  if (normalizedResidual > MAX_NORMALIZED_RESIDUAL) return null;

  // Incertitudes : covariance des moindres carrés, élargie si les mesures s'écartent du modèle.
  const inflation = Math.max(1, normalizedResidual) ** 2;
  const positionCovariance = [0, 1, 2].map((i) => [0, 1, 2].map((j) => solution.covariance[i][j] * inflation));
  const rangeVariance = quadratic(positionCovariance, lineOfSight, lineOfSight);
  const reference = Math.abs(lineOfSight.x) > 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const e1 = new Vector3().crossVectors(lineOfSight, reference).normalize();
  const e2 = new Vector3().crossVectors(lineOfSight, e1).normalize();
  const lateralVariance = largestEigenvalue2(quadratic(positionCovariance, e1, e1), quadratic(positionCovariance, e1, e2), quadratic(positionCovariance, e2, e2));
  const rangeUncertaintyMeters = Math.sqrt(Math.max(0, rangeVariance));
  const crossRangeUncertaintyMeters = Math.sqrt(Math.max(0, lateralVariance));
  const maxRelative = assumptions.passiveRangingMaxRelativeUncertainty ?? DEFAULT_PASSIVE_RANGING_MAX_RELATIVE_UNCERTAINTY;
  if (!(rangeUncertaintyMeters <= maxRelative * range)) return null;

  const velocityUncertaintyMps = Math.sqrt(Math.max(0, (solution.covariance[3][3] + solution.covariance[4][4] + solution.covariance[5][5]) * inflation));
  return {
    position,
    velocity: velocityUncertaintyMps < 0.5 * velocityPriorSigma ? velocity : undefined,
    rangeUncertaintyMeters,
    crossRangeUncertaintyMeters,
    velocityUncertaintyMps,
    method: fixes.some((f) => f.remote) ? "triangulation" : "manoeuvre",
    normalizedResidual,
  };
}
