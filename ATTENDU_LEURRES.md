# Attendu — Leurres

**État : implémenté, à valider** — voir `CONCEPTION_LEURRES.md`. Étape 5 de la feuille de route (`ARCHITECTURE_SIMULATION.md` §7).

## Ce que veut le joueur

- Un leurre est un **faux vaisseau** : un objet lancé comme un missile, mais **sans charge**.
- Son rôle est de **se faire passer pour le vaisseau qui l'a lancé** aux yeux de l'ennemi.
- **La tactique visée** :
  1. prendre un vecteur ;
  2. larguer le leurre ;
  3. couper ses moteurs et se laisser dériver un moment ;
  4. le leurre prend alors sa place aux yeux de l'ennemi.

## Décisions déjà prises

- **Au largage, le leurre reprend le vecteur de poussée actuel du vaisseau.** Un seul bouton « Larguer », pas de trajectoire à programmer.
- **Ses capacités viennent du catalogue de matériel**, comme les moteurs ou les radars : des modèles différents doivent donner des leurres plus ou moins crédibles. Aucune constante de jeu.
- **L'ennemi n'est jamais trompé par règle.** Il suit le leurre avec ses vrais capteurs et sa propre fusion de pistes. Le leurre ne fonctionne que si ce que perçoit l'ennemi le rend crédible.
- **Mes propres leurres me sont connus** par liaison de données, comme les alliés : jamais une piste, ni une cible possible.
- **L'IA doit pouvoir s'en servir aussi**, dans les deux camps.

## Intégration à l'écran Tactique

- Le magasin de leurres (stock restant) apparaît à côté du magasin de missiles.
- Une commande de largage.
- Les leurres en vol sont listés et affichés dans la sphère, dans une couleur distincte des missiles.

## Contraintes du projet

- Simulation déterministe : les largages doivent être rejoués exactement (journal d'entrées) et sauvegardés.
- Chaque loi ajoutée reçoit ses tests.
- Le déroulement exporté doit permettre d'analyser après coup si le leurre a trompé l'ennemi.
