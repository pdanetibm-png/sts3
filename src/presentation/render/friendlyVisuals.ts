import type * as THREE from "three";
import type { FriendlyContact } from "../../knowledge/types";
import { ShipVisual } from "./shipMesh";

export const FRIENDLY_COLOR = 0x6fe08a;
const FRIENDLY_DOWN_COLOR = 0x59616b;

/** Maillages des vaisseaux alliés (liaison de données), en vert — gris une fois hors de combat. */
export class FriendlyVisuals {
  private readonly visuals = new Map<string, { visual: ShipVisual; neutralized: boolean }>();

  constructor(private readonly scene: THREE.Scene) {}

  update(friendlies: readonly FriendlyContact[], scale: number): void {
    const seen = new Set<string>();
    for (const friend of friendlies) {
      seen.add(friend.id);
      let entry = this.visuals.get(friend.id);
      if (!entry || entry.neutralized !== friend.neutralized) {
        entry?.visual.dispose();
        const visual = new ShipVisual(friend.neutralized ? FRIENDLY_DOWN_COLOR : FRIENDLY_COLOR);
        visual.addTo(this.scene);
        entry = { visual, neutralized: friend.neutralized };
        this.visuals.set(friend.id, entry);
      }
      entry.visual.update(friend.positionWorld, friend.attitudeWorld, friend.velocityWorld);
      entry.visual.setScale(scale);
    }
    for (const [id, entry] of this.visuals) {
      if (!seen.has(id)) {
        entry.visual.dispose();
        this.visuals.delete(id);
      }
    }
  }
}
