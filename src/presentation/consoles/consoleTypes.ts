export interface ConsolePanel {
  readonly element: HTMLElement;
  /** Appelé chaque frame de rendu tant que le poste est actif. */
  update(realDeltaSeconds: number): void;
  /** Appelé une fois quand la taille du conteneur change (redimensionnement fenêtre). */
  resize(): void;
  dispose(): void;
}
