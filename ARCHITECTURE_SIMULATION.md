# Au-delà du MVP — moteur physique et catalogue de matériel

Le MVP du cahier des charges est terminé : duel, cinq postes, détection imparfaite, sauvegarde et rejeu. Ce document décrit la suite, c'est-à-dire ce que le jeu doit vraiment être. **Là où il contredit le cahier des charges (duel seul, exclusion des contre-mesures et de la PDC, échelle de quelques dizaines de km), c'est lui qui fait foi.**

Statut : **proposition à valider**.

---

## 1. Vision

- **Le moteur de simulation n'applique que des lois physiques**, en unités réelles (mètres, secondes, kilogrammes, watts). Il n'a aucune préférence d'échelle ni de technologie.
- **Les capacités viennent du catalogue de matériel** : moteurs, réacteurs, radars, capteurs IR, écoute, missiles, puis leurres, PDC et anti-missiles. Une fusée chimique, un moteur nucléaire thermique ou un moteur « Epstein » ne sont que des fiches différentes. Le jeu consiste justement à confronter des matériels aux capacités très différentes.
- **La connaissance reste séparée de la vérité** : on ne voit que ce que ses capteurs mesurent (inchangé).
- **Le déterminisme est conservé** : graine, pas fixe, rejeu exact.
- **Priorité à 1 contre 1 et 2 contre 2**, avec toutes les options tactiques. Les grandes batailles (30 contre 30) viendront quand ces petits engagements fonctionneront bien.

## 2. Principe : aucune constante de jeu dans le moteur

Tout nombre du moteur est soit une loi physique, soit une valeur du catalogue, soit une **hypothèse publique déclarée** (par exemple « manœuvre ennemie supposée ≤ 3 G »), elle aussi en données. Ce qui doit donc disparaître du code :

| Aujourd'hui dans le code | Devient |
|---|---|
| Distance d'engagement de l'IA (8 km), seuil de freinage | Enveloppe de tir calculée à partir des missiles embarqués, plus une doctrine en données |
| Fenêtre d'estimation des pistes (12 s), croissance d'incertitude (15 m/s) | Dérivées du bruit des capteurs et de l'hypothèse de manœuvre maximale de la cible |
| Portée nominale et seuil des capteurs | Équation radar, sensibilité IR, sensibilité d'écoute (§4) |
| Signatures abstraites (« chaleur 50 ») | Bilan thermique réel et puissance du jet (§4) |
| Seuil équipage 5 G | Caractéristique des sièges anti-G et de l'équipage, dans le catalogue |
| Théâtre à 5 fois la séparation initiale | Paramètre du scénario, avec cette règle par défaut |

## 3. Catalogue de matériel

### Composants (fichiers JSON éditables à la main)

Chaque composant a un identifiant, un nom, une masse, une consommation électrique, et ses paramètres physiques propres :

- **Coque** : masse à vide, dimensions (longueur, diamètre), d'où l'inertie et le rayon de collision. Surface et émissivité, pour la chaleur. Surface radar de face et de profil. Nombre d'équipiers.
- **Moteur principal** : poussée max, impulsion spécifique, poussée minimale, fraction de la puissance du jet rayonnée en IR.
- **Propulseurs d'attitude (RCS)** : poussée, impulsion spécifique, positions de montage.
- **Réservoir** : capacité en propergol.
- **Réacteur** : puissance électrique, rendement (le reste est de la chaleur à évacuer).
- **Batterie** : capacité, débits.
- **Radar** : puissance moyenne, surface d'antenne, longueur d'onde, pertes et bruit. On en déduit la largeur du faisceau, le temps passé sur chaque direction et la portée (équation radar).
- **Capteur IR** : diamètre d'optique, bande spectrale, sensibilité pour un temps d'intégration de référence, champ de vue instantané.
- **Écoute (ESM)** : sensibilité, précision de gisement.
- **Équipage et sièges** : tolérance aux G (seuil, vitesse d'accumulation, récupération).
- **Armement** : lanceurs (magasin), munitions.
- **Plus tard** : PDC (cadence, vitesse de bouche, dispersion, portée), leurres IR (intensité, durée), leurres EM (faux échos), autodirecteurs.

### Assemblages

- **Un vaisseau** = une coque + des composants montés (positions et orientations des propulseurs) + ses chargements (propergol, munitions).
- **Un missile ou une torpille** = un petit véhicule assemblé de la même façon (coque, moteur, réservoir, guidage, charge). Un **anti-missile** est simplement un autre assemblage.
- **Un scénario** fait référence aux assemblages par leur identifiant, avec pour chaque vaisseau son camp, sa position et sa vitesse initiales. Il ne recopie plus tout le matériel comme aujourd'hui.

### Familles de départ

- **« Classique × 2 »** (réalisme, technologies actuelles doublées) : moteur nucléaire thermique (~900 s d'impulsion spécifique, ~1 G, quelques km/s de delta-v pour la mission) et missiles chimiques améliorés (20–30 G, 6–8 km/s de delta-v, ~30 s de poussée).
- **« Epstein »** (fiction assumée, type The Expanse) : 3–10 G tenus pendant des heures, torpilles à ~40 G.

Les fiches précises seront calculées et documentées lors de l'étape 1.

## 4. Lois physiques par domaine

- **Dynamique** : solide rigide, équation de la fusée, allocation des propulseurs. Déjà en place, rien à changer.
- **Chaleur et IR** :
  - la chaleur perdue du réacteur (et du moteur) chauffe la coque, avec une inertie thermique ;
  - la coque rayonne selon sa température et sa surface, et la part qui tombe dans la bande du capteur donne l'intensité IR ;
  - le jet rayonne une fraction de sa puissance, surtout vers l'arrière (directivité déjà définie dans CONCEPTION_DETECTION.md).
- **Radar** : équation radar. La portée dépend de la puissance, de l'antenne et du **temps passé sur chaque direction**. Balayer tout le ciel donne une portée courte ; un secteur étroit donne une portée longue. La surface radar dépend de l'angle de vue.
- **IR (détection)** : même logique. Chercher partout vite rend peu sensible ; fixer une zone longtemps, beaucoup plus.
- **Écoute** : aller simple en 1/d², avec le gain d'antenne de l'émetteur (dans son faisceau ou hors faisceau).
- **Probabilité et bruit** : probabilité de détection et précision (gisement, distance) fonction du rapport signal sur bruit. La précision radar dépend de la largeur du faisceau.
- **Engagement** : collision continue entre deux pas (déjà en place). Plus tard, une charge à rayon d'effet pour les anti-missiles et la PDC.
- **Équipage** : exposition G cumulée (déjà en place), paramétrée par les sièges.

**Conséquence attendue du réalisme, à vérifier avec les fiches** : à quelques milliers de km, un vaisseau dont le réacteur tourne est très probablement vu en IR (« pas de furtivité dans l'espace »). L'incertitude porte alors surtout sur :
- la **distance** (l'IR ne donne qu'un gisement) ;
- la **classification** (vaisseau, missile ou leurre) ;
- le **moment**, c'est-à-dire le temps qu'il faut pour chercher et pour préciser une piste.

C'est là qu'interviennent les leurres, la gestion des émissions et la triangulation entre alliés.

## 5. Connaissance

- **Association des pistes par position** quand une distance est connue, et par gisement sinon. Plusieurs contacts proches ne fusionnent plus.
- **Classification** à partir de grandeurs mesurées uniquement : surface radar apparente, accélération estimée, intensité IR rapportée à la distance.
- **Liaison de données entre alliés** : positions des amis (déjà en place). Plus tard, partage des gisements pour **trianguler** une distance sans radar.

## 6. Temps, échelle et performance

- **Pas fixe par défaut** (1/60 s), pour le déterminisme et l'équivalence entre vitesses (TIM-01).
- **Accélération étendue** (par exemple ×1 / ×10 / ×100, voire plus). Retour automatique à ×1 sur un événement connu (déjà en place).
- **Fenêtre masquée ou couverte : la simulation continue** (demande du joueur, 27/09 ; remplace TIM-04, qui imposait une pause automatique). Une sauvegarde automatique est faite à la mise en arrière-plan. Le retour automatique à ×1 sur un événement connu s'applique aussi en arrière-plan. Un gel complet de la page par le navigateur n'est pas rattrapé. La pause après un décrochage de plus de 2 s ne s'applique que page visible.
- **Simulation dans un web worker**, séparée de l'affichage. Plus tard, propagation analytique des corps en roue libre si les grandes batailles l'exigent.
- **Affichage recentré sur le vaisseau**, pour rester précis à des centaines de milliers de km.

## 7. Feuille de route

| Étape | Contenu |
|---|---|
| **1. Catalogue** | Modèle de données (composants, assemblages, scénarios par référence), unités réelles, fiches « Classique × 2 » et « Epstein », migration du scénario actuel, nouvelle version de sauvegarde |
| **2. Détection physique** | Chaleur et IR, équation radar avec temps d'observation, écoute avec faisceaux, missiles détectables, classification, association par position. CONCEPTION_DETECTION.md réécrit en conséquence |
| **3. Échelle et temps** | Scénario à des milliers de km, accélération étendue, web worker, affichage recentré, IA dérivée du matériel (enveloppe de tir), horizons de prévision |
| **4. Pilotage** | Vue trajectoires (passé, futur prévu, point d'approche au plus près), modes interception, évasion, perpendiculaire, égalisation de vitesse |
| **5. Contre-mesures et défense** | Leurres IR et EM, PDC, anti-missiles, autodirecteurs éventuels. Attendus : `ATTENDU_LEURRES.md`, `ATTENDU_PDC.md` |
| **6. 2 contre 2 et banc d'essai** | Réglages, scénarios comparatifs (par exemple Classique contre Epstein), outils d'analyse des parties (le déroulement exporté existe déjà) |
| Plus tard | Grandes batailles (IA de flotte, performance) |

## 8. Impacts sur l'existant

- **Sauvegardes et déroulements** : nouvelle version de schéma. Les anciens fichiers sont refusés proprement ; c'est déjà prévu.
- **Cahier des charges MVP** : conservé comme historique. Ce document le remplace pour la suite.
- **Tests** : les tests du duel sont réécrits sur les nouvelles fiches. Chaque loi physique reçoit son test de portée ou de comportement.

## 9. Points à valider

1. **Scénario de démo** : en « Classique × 2 » par défaut, avec un scénario « Epstein » à côté ? Ou le choix de la famille de matériel au briefing, par camp ?
2. **Catalogue en fichiers JSON** que tu édites à la main. Un éditeur dans le jeu viendrait plus tard.
3. **Ordre de la feuille de route**, en particulier la détection physique (étape 2) avant l'échelle (étape 3).
