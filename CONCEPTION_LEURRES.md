# Conception — leurres

Répond à [ATTENDU_LEURRES.md](ATTENDU_LEURRES.md), étape 5 de la feuille de route ([ARCHITECTURE_SIMULATION.md](ARCHITECTURE_SIMULATION.md) §7). Les décisions de l'attendu sont reprises telles quelles ; les choix nouveaux sont signalés **[à valider]**.

Statut : **implémenté, proposition à valider.**

---

## 1. Principe

Un leurre est un **petit véhicule du catalogue**, assemblé comme un missile (cellule, moteur, réservoir), mais **sans charge ni guidage**. Il ne sait faire qu'une chose : **continuer la poussée que le vaisseau avait au moment du largage**. Il montre ainsi aux capteurs ennemis ce qu'aurait montré le vaisseau s'il avait gardé son vecteur, pendant que le vrai vaisseau coupe ses moteurs et dérive.

Aucune règle ne trompe l'ennemi. Le leurre est une cible physique de plus ; l'ennemi le voit avec ses vrais capteurs, et c'est sa propre fusion de pistes qui le prend, ou non, pour le vaisseau.

## 2. Largage

- **Un seul bouton « Larguer ».** Au largage, le leurre part de la position et de la vitesse du vaisseau, sans impulsion de séparation (même convention que les missiles).
- **Il reprend le vecteur de poussée du vaisseau** (décision de l'attendu) :
  - direction : l'axe du moteur principal à cet instant, figée dans le repère monde ;
  - intensité : l'**accélération** réelle du vaisseau, soit poussée principale effective / masse du vaisseau.
- Il **maintient cette accélération** : sa poussée suit sa masse, qui baisse, dans la limite de sa poussée maximale. À l'épuisement du propergol, il dérive, comme un vaisseau qui coupe.
- **Vaisseau sans poussée au largage** : le leurre dérive avec lui et ne sert à rien. Le poste Tactique l'annonce et demande un second appui pour confirmer.
- **[à valider] Option « Couper la poussée au largage »**, cochée par défaut au poste Tactique. Elle enchaîne les étapes 2 et 3 de la tactique visée sans changer de poste. C'est une consigne ordinaire de poussée, enregistrée comme les autres.
- Le stock décroît d'une unité. Aucun réapprovisionnement.

## 3. Ce que voient les capteurs ennemis

Toutes les lois existent déjà ; le leurre n'est qu'une source de plus.

### Infrarouge

```
I = I_coque + (I_jet_moteur + I_générateur) × g(θ)
```

- **Coque** : même bilan thermique que les vaisseaux et missiles (Stefan-Boltzmann, capacité thermique).
- **Jet du moteur** : `plumePeakIntensity(poussée, Isp, fraction rayonnée)`, même directivité `g(θ)` que les vaisseaux, vers l'arrière de l'axe de poussée.
- **Générateur de panache IR** (optionnel, dans la fiche) : charge pyrotechnique qui complète le jet du leurre pour atteindre l'intensité qu'aurait eue le jet du vaisseau à la même poussée. Il est borné par sa puissance rayonnée maximale et consomme `puissance / énergie rayonnée par kg`. Il ne fonctionne que pendant la poussée. Charge épuisée : il reste le jet propre du leurre.

### Radar

La surface radar de face et de profil vient de la fiche, avec le même modèle angulaire que les vaisseaux. Une grappe de réflecteurs trièdres donne un écho de vaisseau pour une masse de missile : `σ = 4π·a⁴ / (3·λ²)`, soit environ 290 m² pour une arête de 0,5 m en bande X (λ = 3 cm).

### Écoute

Un leurre n'émet rien. Les leurres électromagnétiques restent hors périmètre (§10).

### Ordres de grandeur (corvette « classique × 2 »)

| Source | Intensité IR (W/sr, vue de l'arrière) |
|---|---|
| Jet de la corvette, pleine poussée / mi-poussée | 2,1×10⁵ / 1,05×10⁵ |
| Coque, moteurs coupés, régime de croisière (240 K) | 5,4×10³ |
| Coque après une longue poussée à fond (≈ 390 K, refroidissement en heures) | 3,7×10⁴ |
| Leurre à réflecteurs : jet propre à 0,5 G, sans générateur | 1,2×10⁴ |
| Leurre à réflecteurs : jet + générateur | celle du jet de la corvette |
| Leurre léger, 0,5 G | 2,6×10³ |

## 4. Pourquoi il trompe, ou pas

La crédibilité se joue dans la connaissance de l'ennemi (`knowledge/fusion.ts`), telle qu'elle est :

- **Taille de l'écho radar.** Deux échos trop différents ne sont jamais associés à la même piste (étalement d'aspect supposé × bruit). Un écho de moins de 5 m² est classé « missile probable », et l'IA ne le prend pas pour cible. Un leurre à petit écho **crée donc une nouvelle piste de missile** au lieu de reprendre celle du vaisseau.
- **Mouvement.** La piste prédit la suite du mouvement mesuré. Le leurre prolonge ce mouvement ; le vaisseau qui coupe s'en écarte. Quand les deux sources se séparent, l'association garde la mesure la plus proche de la prédiction.
- **Classification.** Un leurre à réflecteurs est « vaisseau probable », exactement comme le vaisseau. L'ennemi voit deux contacts plausibles et ne sait pas lequel est le vrai.

Ce qui trahit le leurre ou le vaisseau :

- **Poussée insuffisante.** Un leurre qui ne peut pas tenir l'accélération du vaisseau s'écarte de la prédiction (par exemple le leurre à réflecteurs, 1,3 G au plus, contre une corvette Epstein à 3 G).
- **Propergol épuisé** : le leurre dérive, puis sa piste vieillit comme celle d'un vaisseau silencieux.
- **Le vaisseau continue d'émettre** au radar : l'écoute ennemie le retrouve (couper son radar fait partie de la tactique).
- **Le vaisseau reste visible en IR** moteurs coupés : sa coque ne s'éteint pas (DET-05). Ce n'est pas un défaut du leurre : l'ennemi voit deux sources, et le leurre lui laisse le doute.
- **À grande distance, en IR seul**, leurre et vaisseau restent dans la même piste tant que leur écart angulaire est inférieur à la marge d'association.

### Ce que montrent les essais (échelle des tests, ennemi qui suit le vaisseau au radar)

Dans tous les cas, l'IA vise la piste « vaisseau » la plus proche. Largué en poussant vers elle, le leurre la précède : c'est lui qu'elle vise.

- **Largué en poussant droit vers l'ennemi**, le leurre reprend la piste du vaisseau et attire le premier missile. Mais le vaisseau dérive **sur la même ligne**, juste derrière : un missile qui frôle le leurre (2 m) peut toucher le vaisseau (25 m). C'est ce qui arrive sur les graines essayées, et **c'est pire que sans leurre** (touché à t = 60 s au lieu de 75 s).
- **Largué en biais** (vecteur à 30° de l'axe de la menace), le leurre reprend la piste et attire les deux premiers missiles, qui passent loin du vaisseau. Le troisième, tiré sur le vaisseau, touche. Le vaisseau tient 4 s de plus.
- **Largué en travers**, il reste un second contact « vaisseau probable ». Il reprend parfois la piste, mais l'ennemi continue aussi de suivre le vaisseau, qui reste le plus proche.
- **Le leurre léger ne change rien** par rapport à l'absence de leurre : jamais de reprise, aucun tir attiré.

Conséquences tactiques :

- prendre son vecteur **hors de l'axe de la menace** avant de larguer ;
- changer de route ensuite si possible ;
- un leurre achète du temps et des missiles ennemis, pas l'invulnérabilité.

Ces résultats sont sensibles à la géométrie : la correction d'un décalage d'un pas dans la détection (voir CONCEPTION_PDC.md) a suffi à faire passer le premier missile d'« il détruit le leurre » à « il frôle le leurre et touche le vaisseau ».

## 5. Mes leurres

- **Connus par liaison de données** (décision de l'attendu), comme les alliés : les capteurs ignorent les objets de son camp. Un leurre ami n'est donc jamais une piste ni une cible. Le poste Tactique lit sa télémétrie : état, propergol, charge IR.
- **Un missile peut percuter un leurre du camp adverse.** Même collision continue que pour les vaisseaux, avec le rayon de la fiche ; missile et leurre sont détruits, une seule fois. Pour le tireur, c'est un impact comme un autre, puisqu'il ne sait pas ce qu'il a touché. La partie continue, faute de neutralisation.
- **Jamais de tir fratricide** : un missile ne touche pas un leurre de son camp.
- **Frontière du théâtre** : retrait unique, comme les missiles.
- **Événements connus du joueur** (camp bleu seulement) : largage, fin de poussée, perte à la limite du théâtre, « liaison perdue (impact probable) ».

## 6. Catalogue

Nouvelle section `components.decoys` (optionnelle) et champ `decoys: { decoy, count }` dans les assemblages, sur le modèle des missiles.

| Fiche | Masse | Moteur | Écho radar (face / profil) | Générateur IR | Durée à 0,5 G |
|---|---|---|---|---|---|
| **Leurre à réflecteurs** (crédible) | 150 kg de cellule + 200 kg de propergol + 100 kg de charge IR | 6 kN, Isp 300 s | 150 / 250 m² | 1,5 MW, 2 MJ/kg | ≈ 5 à 6 min (≈ 3 min à 1 G) |
| **Leurre léger** (peu crédible) | 40 kg de cellule + 80 kg de propergol | 1,5 kN, Isp 280 s | 0,5 / 1,5 m² | aucun | ≈ 10 min |

- **[à valider]** Les deux corvettes emportent **3 leurres à réflecteurs**. Le leurre léger est au catalogue pour les comparaisons ; il suffit de changer de fiche dans l'assemblage.
- La corvette Epstein reçoit la même fiche. Elle ne peut pas l'imiter au-delà de 1,3 G, ni pour le panache : un leurre Epstein reste à définir.
- Les leurres en soute pèsent dans la masse du vaisseau, comme les missiles (PHY-06) ; l'accélération imitée est celle du vaisseau juste avant le largage, leurre encore à bord.

## 7. IA

Doctrine en données (champs optionnels ; sans eux, l'IA ne largue jamais) :

| Champ | Rôle | Valeur standard |
|---|---|---|
| `decoyThreatSeconds` | Temps d'arrivée estimé d'une menace en deçà duquel on largue | 60 s |
| `decoyVectorSeconds` | Durée de la manœuvre « prendre un vecteur », retournement compris, si l'on ne poussait pas | 20 s |
| `decoyDriftSeconds` | Dérive moteurs coupés et radar éteint après le largage | 180 s |
| `decoyCooldownSeconds` | Délai minimal entre deux largages | 120 s |

- **Menace** : une piste « missile probable » de sa propre connaissance, avec position et vitesse estimées, qui se rapproche, et dont le temps d'arrivée estimé est sous `decoyThreatSeconds`. Aucune donnée cachée (DBG-02).
- **Séquence** :
  1. si le vaisseau pousse : larguer tout de suite ;
  2. sinon, prendre un vecteur perpendiculaire à la ligne de visée de la menace pendant `decoyVectorSeconds`, puis larguer en poussant. La poussée est maximale, bornée par le seuil G de l'équipage (donnée de la fiche équipage, pas une constante). La manœuvre est abandonnée si le vaisseau ne parvient jamais à pousser ;
  3. dans les deux cas, dériver ensuite `decoyDriftSeconds`, moteurs coupés et radar éteint.
- Les deux camps utilisent la même logique.
- Une piste ennemie alimentée par un leurre à réflecteurs est « vaisseau probable » : l'IA peut tirer dessus. C'est l'effet recherché.

## 8. Déterminisme, sauvegarde, analyse

- **Journal d'entrées** : nouvelle entrée `{ step, kind: "decoy", ownerId }`, rejouée avant les consignes du même intervalle, dans l'ordre d'enregistrement.
- **Sauvegarde** : schéma 4. Elle contient les leurres en vol, les stocks, le compteur d'identifiants et la phase de l'IA. Les sauvegardes antérieures sont refusées proprement.
- **Analyse après coup** (vérité interne, jamais montrée en partie réaliste) :
  - pour chaque observateur et chaque piste : la **source réelle** de chaque mesure (compteurs, dates) et les **changements de source majoritaire** sur les 10 dernières mesures ;
  - pour chaque missile : la source réelle de sa piste au moment du tir.
- **Rapport par leurre**, dans le déroulement exporté (format 2) et dans le débrief en mode test :
  - les pistes ennemies qu'il a alimentées ;
  - les pistes qu'il a **reprises au vaisseau** (source majoritaire passée du vaisseau au leurre) ;
  - les missiles ennemis tirés sur ces pistes, et celui qui l'a détruit ;
  - un verdict lisible.

## 9. Interface — poste Tactique

- **Magasin de leurres** à côté du magasin de missiles : tubes, stock restant.
- **Groupe « Leurres »** : option « Couper la poussée au largage », bouton **Larguer**, retour d'état. Refusé en pause (TIM-05).
- **Liste « Missiles et leurres lancés »** : pour chaque leurre, état, propergol, charge IR, accélération imitée. Un seul écran pour les deux, car un troisième écran écraserait la colonne à 1280 × 720.
- **Sphère** : leurres propres en violet (ni blanc comme les missiles, ni vert comme les alliés), avec leur trajectoire.
- Ailleurs : carte maître (leurres des deux camps), stock au briefing et en ingénierie, une entrée dans l'aide.

## 10. Hors périmètre et limites connues

- **Leurres électromagnétiques** (faux échos, brouillage) : étape ultérieure.
- **Cohérence d'intensité IR** : l'ennemi ne compare pas encore la brillance d'une piste d'une mesure à l'autre. Quand il le fera, un leurre sans générateur deviendra moins crédible, et le générateur prendra tout son sens.
- **Pistes au gisement seul** (corrigé) : la vitesse angulaire de la ligne de visée est désormais estimée et extrapolée. En 2 contre 2, un vaisseau n'est plus suivi que par une à trois pistes au lieu de dizaines. Reste une fragmentation sur les missiles rapides vus de près en IR seul (mesure toutes les 10 s, rotation trop brusque) : sans distance, c'est inévitable.
- **Réaction de l'IA** : elle ne réagit qu'à une menace dont elle connaît la position **et** la vitesse. Un missile vu de face renvoie un petit écho. À l'échelle des tests, l'ennemi ne le détecte qu'à 2 km, moins de 2 s avant l'impact, sans vitesse estimée : il ne réagit pas. De plus, la fusion découpe en plusieurs pistes un contact plus rapide que la vitesse supposée des inconnus (`unknownSpeedMps`). À l'échelle réelle, le radar en secteur voit un missile de face à quelques centaines de km ; c'est à vérifier en partie.
- **Collision** (corrigé) : le test d'impact se fait dans le repère de la cible, déplacement pendant le pas compris.
- **Surface radar** indépendante de la longueur d'onde : cohérent tant que tous les radars du catalogue sont en bande X.

## 11. Tests

| Fichier | Contenu |
|---|---|
| `tests/decoy.physics.test.ts` | Largage (stock, position, vitesse, vecteur repris, refus) ; accélération imitée tenue et bornée ; débit `F / (Isp·g₀)` ; épuisement puis dérive ; largage sans poussée ; générateur IR (imitation du jet, borne, consommation, charge épuisée) ; leurre léger ; frontière du théâtre |
| `tests/decoy.detection.test.ts` | Leurre à réflecteurs « vaisseau probable », léger « missile probable » ; aucune piste sur un leurre ami ; missile contre leurre (destruction mutuelle unique) ; pas de tir fratricide |
| `tests/decoy.ai.test.ts` | Largage sur menace en poussée, puis dérive moteurs coupés et radar éteint ; vecteur perpendiculaire puis largage ; délai minimal ; pas de tactique sans stock ou sans doctrine ; une piste de vaisseau n'est pas une menace |
| `tests/decoy.credibility.test.ts` | Tactique complète face à l'IA : le leurre à réflecteurs reprend la piste et attire les tirs, le léger non ; en travers, contact « vaisseau probable » distinct |
| `tests/decoy.save.test.ts` | Reprise identique à l'exécution continue (leurre en vol, IA en pleine tactique) ; largage rejoué exactement ; refus du schéma antérieur |
| `tests/decoy.catalog.test.ts` | Fiches de démo ; catalogue sans leurres toujours valide ; références et fiches invalides refusées |
