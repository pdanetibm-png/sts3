export type ConsoleId = "coupe" | "pilotage" | "detection" | "tactique" | "ingenierie" | "vie" | "carte-maitre";

export interface AppState {
  activeConsole: ConsoleId;
  masterMapUnlocked: boolean;
}

type Listener = () => void;

/** État UI minimal (poste actif) — distinct de la vérité simulation (section 3.1). */
export class AppStateStore {
  private state: AppState = { activeConsole: "coupe", masterMapUnlocked: true };
  private listeners: Listener[] = [];

  get(): AppState {
    return this.state;
  }

  setActiveConsole(console: ConsoleId): void {
    this.state = { ...this.state, activeConsole: console };
    this.emit();
  }

  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
