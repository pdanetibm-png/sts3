import { el } from "./dom";

/**
 * Aide initiale (section 8.7, HELP-01) : courte, refermable, ré-ouvrable via le bouton
 * « Aide (?) » du bandeau temps. N'affiche que les principes transversaux (inertie, pistes,
 * accélération temporelle, changement de poste) — l'aide contextuelle propre à chaque poste
 * (les `.help-text` déjà présents dans chaque console) reste inchangée, complémentaire.
 */
export class HelpOverlay {
  readonly element: HTMLElement;
  private visible = false;

  constructor() {
    this.element = el("div", "help-overlay hidden");
    this.element.addEventListener("click", (event) => {
      if (event.target === this.element) this.hide();
    });

    const panel = el("div", "help-panel");
    panel.appendChild(el("h2", undefined, "Aide"));

    panel.appendChild(
      helpItem(
        "Inertie",
        "Sans poussée, votre vitesse ne change pas. Tourner ne change pas votre trajectoire ; seule une poussée la modifie.",
      ),
    );
    panel.appendChild(
      helpItem(
        "Pistes",
        "Une piste passe de « récent » (mesure de moins de 5 s) à « extrapolé », puis « perdu » (plus de 30 s sans observation, ou incertitude au-delà du seuil de jeu) — l'historique reste conservé, « perdu » ne veut ni détruit ni parti.",
      ),
    );
    panel.appendChild(
      helpItem(
        "Accélération temporelle",
        "×1 / ×10 / ×100 changent le nombre de pas simulés par seconde réelle, jamais la physique elle-même. Le jeu revient automatiquement à ×1 sur une nouvelle détection connue ou une alerte critique (réserves basses/critiques, exposition dangereuse), sans changer de poste.",
      ),
    );
    panel.appendChild(
      helpItem(
        "Couleurs",
        "Rouge : contact présumé hostile (toute piste de capteur) — orangé s'il est extrapolé, gris s'il est perdu. Vert : allié, connu en permanence par liaison de données (gris une fois hors de combat). Jamais de piste sur un allié.",
      ),
    );
    panel.appendChild(
      helpItem(
        "Modes de pilotage",
        "Au poste Pilotage, sur la piste choisie : Interception (rendez-vous, freinage anticipé), Évasion (dos à la piste), Perpendiculaire (à 90° de la route d'une menace, pour la faire rater), Égaliser vitesse. Le mode oriente le vaisseau ; la poussée reste la vôtre. Orienter à la main repasse en Manuel.",
      ),
    );
    panel.appendChild(
      helpItem(
        "Trajectoires",
        "Vue Pilotage : route passée, route prévue si la consigne actuelle est maintenue (graduée en temps), route estimée de la piste et approche au plus près — distance et délai, calculés sur vos estimations, jamais sur la position réelle.",
      ),
    );
    panel.appendChild(
      helpItem(
        "Leurres",
        "Au poste Tactique, « Larguer » lâche un leurre qui reprend votre vecteur de poussée : il continue d'accélérer comme vous le faisiez. Prenez votre vecteur hors de l'axe de la menace, puis coupez vos moteurs (et votre radar) pour que l'ennemi le suive à votre place. Rien ne le trompe par principe : il ne voit que ce que ses capteurs mesurent. Vos leurres vous sont connus par liaison de données (violet).",
      ),
    );
    panel.appendChild(
      helpItem(
        "PDC",
        "Les tourelles de défense rapprochée tirent vers le point où votre piste prévoit le missile — jamais vers sa position réelle. Une piste précise (radar en Suivi sur le missile) et un missile lent donnent les meilleures chances. Auto : elles prennent à partie les missiles probables qui approchent. Vous ne savez jamais qu'un missile est détruit : seulement que sa piste n'est plus mesurée.",
      ),
    );
    panel.appendChild(
      helpItem("Changement de poste", "Vos ordres (poussée, capteurs, mode de pilotage) persistent — changer de console ne les interrompt jamais."),
    );
    panel.appendChild(
      el(
        "p",
        "help-text",
        "Seuils provisoires affichés ici comme le prévoit la section 5.3 : piste récente < 5 s, perdue > 30 s ; propergol/batterie bas à 20 %, critiques à 5 %.",
      ),
    );

    const closeButton = el("button", "btn", "Fermer");
    closeButton.addEventListener("click", () => this.hide());
    panel.appendChild(closeButton);

    this.element.appendChild(panel);
  }

  show(): void {
    this.visible = true;
    this.element.classList.remove("hidden");
  }

  hide(): void {
    this.visible = false;
    this.element.classList.add("hidden");
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  get isVisible(): boolean {
    return this.visible;
  }
}

function helpItem(title: string, body: string): HTMLElement {
  const wrapper = el("div", "help-item");
  wrapper.appendChild(el("h3", undefined, title));
  wrapper.appendChild(el("p", undefined, body));
  return wrapper;
}
