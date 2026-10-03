export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function formatSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Distance lisible à toutes les échelles du jeu : mètres de près, kilomètres au-delà de 10 km. */
export function formatDistance(meters: number): string {
  return meters < 10000 ? `${meters.toFixed(0)} m` : `${(meters / 1000).toFixed(meters < 100000 ? 1 : 0)} km`;
}

export function formatSpeed(mps: number): string {
  return mps < 10000 ? `${mps.toFixed(0)} m/s` : `${(mps / 1000).toFixed(1)} km/s`;
}
