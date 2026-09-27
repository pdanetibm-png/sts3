# Attendu — PDC (défense rapprochée)

**État : implémenté, à valider** — voir `CONCEPTION_PDC.md`. Étape 5 de la feuille de route (`ARCHITECTURE_SIMULATION.md` §7).

## Ce que veut le joueur

- **Munitions** : une PDC dispose d'un nombre limité de munitions (projectiles à haute vélocité).
- **Probabilité d'interception** : elle dépend de :
  - **la vitesse d'arrivée du missile** ;
  - **la qualité du ciblage** ;
  - **la saturation** (plusieurs missiles à la fois).

## Décisions déjà prises

- **Les caractéristiques de chaque PDC viennent du catalogue de matériel** (fiches différentes, capacités différentes). Aucune constante de jeu.
- **La PDC vise d'après la connaissance du vaisseau** (sa piste du missile), jamais d'après la position réelle. Une piste fausse doit se traduire par des tirs manqués.
- **Munitions finies** : elles sont décomptées, sauvegardées et affichées.
- **L'IA doit pouvoir s'en servir aussi**, dans les deux camps.

## Intégration à l'écran Tactique

- Les munitions restantes par PDC sont affichées.
- La commande de la PDC est accessible depuis cet écran.
- Les engagements en cours sont affichés (quelle piste est prise à partie), ainsi que leur résultat quand il est connu du joueur.

## Contraintes du projet

- Simulation déterministe : tirages aléatoires sur le générateur seedé de la simulation, rejeu exact, sauvegarde.
- Chaque loi ajoutée reçoit ses tests (au minimum : la probabilité baisse quand la vitesse d'arrivée augmente, quand la piste est moins précise et quand les missiles sont plus nombreux).
- Le déroulement exporté doit permettre d'analyser les engagements PDC après coup.
