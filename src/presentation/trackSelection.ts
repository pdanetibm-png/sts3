/**
 * Piste sélectionnée, commune à tous les postes : la choisir en Détection la présélectionne en
 * Tactique et en Pilotage. État d'interface seulement — une sélection n'est jamais un ordre ;
 * chaque poste décide lui-même si un clic local doit aussi changer une consigne.
 */
export class TrackSelection {
  private selectedId: string | null = null;

  get current(): string | null {
    return this.selectedId;
  }

  set(localId: string | null): void {
    this.selectedId = localId;
  }
}
