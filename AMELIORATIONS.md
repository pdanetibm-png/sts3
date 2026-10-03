# Actions d'amélioration

Liste tenue à jour des corrections et évolutions possibles du moteur, de la connaissance et de l'IA. Sources :

- bilan de réalisme de la simulation (03/10) ;
- analyse de la partie `scs-deroulement-20260923-t1090s` (03/10) : Kestrel et Hawk (intercepteurs) contre une corvette, victoire à 1090 s sur un seul impact, sans aucun tir ennemi.

Statut : **en cours de mise en place** (branche `ameliorations-postes-et-capteurs`). L'ordre conseillé est celui des numéros : A1 conditionne A2 et A3.

## État au 03/10

| Point | État |
|---|---|
| A1, A2 (piste trop incertaine, secteur radar de l'IA) | **Fait** : incertitude latérale distincte, position sans valeur abandonnée, secteur à la mesure de l'incertitude latérale |
| A6 (missiles à poussée gérée) | **Fait** : réserve terminale (30 % sur les missiles chimiques), croisière moteur coupé, rallumage à l'approche |
| Triangulation avec un allié, distance par manœuvre, incertitude en « cigare » | **Fait** : `knowledge/passiveRanging.ts`, gisements partagés par la liaison de données |
| Indicateur de discrétion (Détection), doctrine d'émission de l'IA | **Fait** : `sim/detectability.ts`, doctrine `radarBurstIntervalSeconds` |
| Tests d'interface, CI GitHub, icône, découpage du paquet, liste des pistes en Pilotage | **Fait** |
| D1–D4 (partie `t1714s` : pistes fragmentées, leurre qui vole une piste, ailier distancé, IA qui tire sur un missile) | **Fait** (voir section D) |
| Ordres à l'ailier, salves coordonnées | À faire |
| Bilan de partie automatique, banc d'essai sans affichage | À faire |
| Simulation dans un web worker | À faire (mesurer d'abord le coût d'un pas en 2 contre 2) |
| A3, A4, A5, B1–B3, C1–C5 | À faire |

---

## Synthèse

| N° | Action | Domaine | Impact | Effort |
|---|---|---|---|---|
| A1 | Une piste dont la position n'a plus de sens repasse au gisement seul | Connaissance | Fort | Faible |
| A2 | Secteur radar de l'IA à la mesure de l'incertitude de la piste | IA | Fort | Faible |
| A3 | Classification par la cinématique (accélération, vitesse d'approche) | Connaissance | Fort | Moyen |
| A4 | Menace « cinématique » pour la défense terminale et la PDC | IA / PDC | Fort | Faible |
| A5 | Forme d'impact fidèle à la coque | Moteur | Fort | Moyen |
| A6 | Missiles à poussée gérée (réserve pour la phase terminale) | Moteur | Fort | Moyen |
| B1 | Recaler le catalogue « classique × 2 » | Catalogue | Moyen | Faible |
| B2 | Mesure Doppler (vitesse radiale) par le radar | Capteurs | Moyen | Moyen |
| B3 | Écoute : lobe principal une fois par balayage seulement | Capteurs | Moyen | Faible |
| C1 | Terme gyroscopique de la rotation | Moteur | Faible | Faible |
| C2 | Le réacteur ne consomme pas de propergol | Moteur | Faible | Faible |
| C3 | Gravité, orbites, Soleil | Périmètre | À décider | Fort |
| C4 | Retard de la lumière, liaison de données imparfaite | Périmètre | À décider | Moyen |
| C5 | Probabilité de détection, seuils G par axe, autonomie de secours | Réglages | Faible | Faible |

---

## D. Partie `scs-deroulement-20260923-t1714s` (03/10 au soir)

Kestrel et Hawk contre la corvette ; abandon à 1 714 s. Distance par triangulation tenue pendant toute l'approche radar éteint (erreur de 5 à 14 km à 3 000 km), IA silencieuse jusqu'à portée, quatre missiles tirés et ratés (365 m à 5,9 km), croisement à 8 km, puis poursuite d'un leurre.

- **D1. Un missile vu en IR seul créait une piste par image** (6 pistes pour le missile-4 : sauts de 4 à 10° entre deux images IR). **Fait** : une détection isolée reste une piste candidate, invisible des postes et de l'IA, sans annonce ni retour à ×1, jusqu'à une deuxième mesure (logique « M sur N ») ; une piste au gisement seul qui tourne vite accepte une variation de sa vitesse angulaire (`successionScore`). Au rejeu : 2 nouvelles pistes au lieu de 6 ; celle qui reste est le croisement (108° en 10 s).
- **D2. Le leurre ennemi a pris la piste suivie par l'interception, sans avertissement.** **Fait** : `findTwinTrack` signale une piste qui apparaît dans la même direction (< 2°) et à une distance voisine (< 20 %) d'une autre — journal (« Dédoublement »), ligne « Jumelle » dans la fiche, avertissement dans le mode de pilotage. Au rejeu : alerte à 1 557 s. Limite : l'alerte ne dit pas laquelle des deux est le leurre (comparer la luminosité IR d'une mesure à l'autre reste à faire).
- **D3. L'ailier ne rattrapait pas un chef plus rapide** : il poussait à `approachThrottle` (50 %). **Fait** : en retard au-delà de `wingmanMaxLeadMeters`, il pousse à `wingmanCatchUpThrottle` (doctrine, défaut 100 %). Au rejeu : le Hawk arrive à 114 km de l'ennemi et tire ses deux missiles.
- **D4. L'IA tirait sur une piste non classée** (le Hawk, au rejeu, sur un missile ennemi). **Fait** : l'IA ne tire que sur un « vaisseau probable » ; une piste inconnue lui sert seulement à s'orienter.

## A. Priorité haute : décide de l'issue des combats

### A1. Une piste dont la position n'a plus de sens repasse au gisement seul

- **Constat** : une piste garde sa position estimée même quand son incertitude dépasse largement la distance. L'extrapolation la déclare perdue (`LOST_RELATIVE_POSITION_UNCERTAINTY`), mais la mesure de gisement suivante la remet « récente » sans toucher à la position. Or la fenêtre d'association par gisement s'élargit de `atan(3 · incertitude / distance)` : la piste avale alors toute mesure IR d'un cône immense.
- **Preuve (partie du 03/10)** : à 1070 s, la piste ennemie piste-1 (le Kestrel) est à 119 km estimés pour 286 km d'incertitude (rapport 2,4), toujours « récente ». Sa fenêtre fait environ 80°. Les mesures IR des missiles 2 et 3 (tirés par le Kestrel, dans sa direction) y sont rattachées : aucun missile n'a jamais eu sa propre piste.
- **Proposition** : au-delà du seuil, abandonner position et vitesse (piste au gisement seul, vitesse angulaire conservée). La fenêtre redevient celle des gisements (de l'ordre du degré entre deux images IR), au lieu de dizaines de degrés, et un missile qui s'écarte de son lanceur obtient sa piste. Effet induit : l'IA n'a plus de « position connue » fausse et pointe son radar sur le gisement, qui est juste (voir A2).
- **Fichiers** : `src/knowledge/fusion.ts` (`extrapolateTrack`, `reconcilePositionWithBearing`, `associationGate`).
- **Tests** : une piste dont l'incertitude dépasse le seuil perd sa position ; un missile qui part du lanceur dans la même direction ouvre sa propre piste IR.

### A2. Secteur radar de l'IA à la mesure de l'incertitude de la piste

- **Constat** : quand l'IA concentre son radar sur sa meilleure piste, le demi-angle est fixe (`doctrine.sectorHalfAngleRad`, 0,05 rad). Le mode Suivi, lui, adapte le secteur à l'incertitude (`updateFollowedSector`).
- **Preuve** : de 995 à 1090 s, le radar ennemi balaie 2,9° autour d'estimations fausses de 130 à 300 km. Il ne retrouve jamais les intercepteurs. Le missile-3 reste entre 9° et 28° de l'axe pendant tout son vol.
- **Proposition** : mettre le radar de l'IA en Suivi sur sa meilleure piste, ou appliquer la même règle de largeur. Le secteur de doctrine devient un minimum, pas une valeur fixe.
- **Fichiers** : `src/sim/combatAI.ts:93`, `src/sim/detection.ts` (`updateFollowedSector`).
- **Tests** : piste très incertaine ⇒ secteur large ; piste précise ⇒ secteur de doctrine.

### A3. Classification par la cinématique

- **Constat** : la classification ne repose que sur la surface radar, avec des seuils écrits dans le code (5 m² et 20 m²), contre la règle « aucune constante de jeu dans le moteur » (ARCHITECTURE_SIMULATION.md §2). Une piste IR seule n'est jamais classée.
- **Preuve** : l'ennemi classe le leurre léger du Kestrel « missile probable » (0,55 m²) alors qu'il n'accélère qu'à 0,73 G. Il déclenche toute sa parade (manœuvre de travers, leurre, silence radar), qui le perd. À l'inverse, les vrais missiles ne sont jamais classés.
- **Proposition** : combiner surface radar, accélération estimée (le modèle accéléré de `fitMotion` la donne déjà), vitesse d'approche et intensité IR rapportée à la distance quand elle est connue. Sortir les seuils dans les hypothèses du scénario.
- **Fichiers** : `src/knowledge/fusion.ts:357` (`classifyFromCrossSection`), `src/sim/types.ts` (`EstimationAssumptions`).
- **Tests** : petit écho lent ⇒ pas « missile probable » ; contact à plus de 10 G ⇒ « missile probable » ; seuils lus dans le scénario.

### A4. Menace « cinématique » pour la défense terminale et la PDC

- **Constat** : la défense terminale de l'IA (`findThreat`) et la PDC en Auto n'agissent que sur une piste « missile probable ». Un missile mal classé, ou rattaché à une piste de vaisseau, passe sans réaction.
- **Preuve** : les deux tourelles de la corvette sont restées sans cible jusqu'à l'impact ; le radar n'est jamais passé en défense terminale.
- **Proposition** : traiter aussi comme menace toute piste qui arrive vite (temps d'arrivée estimé sous le seuil de doctrine), quelle que soit sa classe. La PDC garde sa condition de position et de vitesse estimées.
- **Fichiers** : `src/sim/combatAI.ts` (`findThreat`), `src/sim/pdcSystem.ts` (`candidates`).
- **Limite physique à garder en tête** : à 8 km/s d'arrivée, une PDC de 25 mm (1 500 m/s, 5 km) n'a qu'environ 3 s de tir utile. Elle a peu de chances d'arrêter le missile, même bien guidée.

### A5. Forme d'impact fidèle à la coque

- **Constat** : un vaisseau est une sphère de `collisionRadiusMeters` (25 m pour la corvette de 40 m × 10 m). Cela fait environ 1 960 m² de section, contre environ 400 m² de profil et 80 m² de face. Quand l'erreur de visée dépasse la taille du vaisseau, un missile touche 5 à 25 fois trop souvent.
- **Preuve** : le missile vainqueur passe à 13 m du centre. C'est un impact avec la sphère, mais pas forcément avec la coque réelle (5 m de rayon).
- **Proposition** : cylindre ou ellipsoïde orienté par l'attitude, aux dimensions de la coque du catalogue. Le test continu dans le repère de la cible reste valable.
- **Fichiers** : `src/sim/collision.ts`, `src/sim/missileSystem.ts:96`, fiches de coque du catalogue (longueur, diamètre).

### A6. Missiles à poussée gérée

- **Constat** : un missile pousse à fond du lancement à l'épuisement (environ 15 s pour le missile avancé, de 25 à 75 G), puis dérive sans plus pouvoir corriger.
- **Preuve** : les quatre missiles de la partie sont en dérive bien avant l'arrivée. Trois ratent la cible, de 660 m, 1,25 km et 7,8 km.
- **Proposition** : une réserve de delta-v pour la phase terminale (part fixée par la fiche ou la doctrine), avec allumage sur le temps restant estimé. Variante simple : pousser seulement tant que la vitesse à gagner dépasse un seuil.
- **Fichiers** : `src/sim/missileSystem.ts:60`, `src/sim/missile.ts` (`guidanceThrustDirection`, `missileReachMeters`), fiches de missile.

---

## B. Priorité moyenne : réalisme physique

### B1. Recaler le catalogue « classique × 2 »

- Le missile chimique avancé a une impulsion spécifique de 560 s, au-delà de toute chimie connue : le couple oxygène-hydrogène plafonne vers 465 s.
- Le moteur nucléaire thermique de 3 MN pour 12 t a un rapport poussée/poids d'environ 25, contre 1,5 à 5 pour NERVA et les projets récents.
- Le libellé « Batterie 1 MWh » correspond à 1 kWh (déjà signalé dans CONCEPTION_MAGASIN.md §4).
- **[à décider]** Recaler les valeurs (cela change l'équilibre du jeu), ou renommer la famille.

### B2. Mesure Doppler par le radar

- Un vrai radar mesure directement la vitesse radiale. Ici, la vitesse ne sort que de la régression sur les positions, et les pistes convergent plus lentement que dans la réalité.
- **Proposition** : ajouter à l'observation radar une vitesse radiale bruitée et l'utiliser dans `fitMotion`.
- **Fichiers** : `src/sim/sensors.ts` (`evaluateSensor`), `src/knowledge/fusion.ts`, `src/knowledge/types.ts`.

### B3. Écoute : lobe principal une fois par balayage seulement

- Dès que l'écoute est dans le secteur balayé par un radar, elle reçoit le gain du lobe principal à chaque cycle (1,5 s). En réalité, le faisceau ne passe sur elle qu'une fois par balayage (10 s en recherche sur tout le ciel). La portée reste juste, mais les gisements arrivent environ 7 fois trop souvent.
- **Proposition** : ne compter le lobe principal que si le faisceau est passé sur l'écouteur pendant le cycle, le reste du temps les lobes secondaires.
- **Fichiers** : `src/sim/sensors.ts:147`.

---

## C. Priorité basse ou à décider

### C1. Terme gyroscopique de la rotation

L'intégration angulaire calcule `couple / inertie` sans le terme `ω × Iω` : ni précession, ni instabilité de l'axe intermédiaire. C'est négligeable avec le maintien d'attitude, mais faux pour un vaisseau neutralisé qui tourne librement. Fichier : `src/sim/integrator.ts:22`.

### C2. Le réacteur ne consomme pas de propergol

Le générateur puise dans la réserve de propergol (0,05 kg/s à pleine puissance). Un réacteur à fission ne consomme presque rien en masse. L'effet est négligeable (360 kg au plus en 2 h), mais le modèle est faux. Fichier : `src/sim/power.ts:67`.

### C3. Gravité, orbites, Soleil **[à décider]**

Le moteur simule un espace vide et plat : ni gravité, ni corps célestes, ni éclairage solaire (reflet, éblouissement des capteurs IR, angle d'exclusion). Aucun document ne dit si c'est voulu. C'est à trancher avant d'écrire des scénarios près d'une planète.

### C4. Retard de la lumière, liaison de données imparfaite **[à décider]**

Le délai est négligeable à l'échelle de la démo (20 ms aller-retour à 3 000 km). Il devient sensible au-delà de 100 000 km environ. La liaison de données (alliés, guidage des missiles) est instantanée, sans portée limite ni brouillage.

### C5. Réglages

- Probabilité de détection `snr⁴ / (1 + snr⁴)` : une courbe ad hoc, pas un modèle de fluctuation de cible (Swerling).
- Même seuil G pour tous les axes de l'équipage.
- 180 s d'autonomie de secours du support vie (valeur de jeu).

---

## Déjà documenté ailleurs

Non repris ici : radiateurs et masquage (CONCEPTION_DETECTION.md §10) ; radar de conduite de tir, recul et masse des obus PDC (CONCEPTION_PDC.md §9) ; leurres électromagnétiques et cohérence d'intensité IR (CONCEPTION_LEURRES.md §10) ; budget de l'adversaire au magasin (CONCEPTION_MAGASIN.md §4).
