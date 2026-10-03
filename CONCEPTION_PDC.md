# Conception — PDC (défense rapprochée)

Répond à [ATTENDU_PDC.md](ATTENDU_PDC.md), étape 5 de la feuille de route ([ARCHITECTURE_SIMULATION.md](ARCHITECTURE_SIMULATION.md) §7). Les décisions de l'attendu sont reprises telles quelles ; les choix nouveaux sont signalés **[à valider]**.

Statut : **implémenté, proposition à valider.**

---

## 1. Principe

Une PDC est une **tourelle à tir rapide** du catalogue. Elle tire des obus à haute vitesse vers le point où **la piste du vaisseau** prévoit que le missile sera. Les obus volent vraiment, et c'est leur passage près du vrai missile qui décide de l'interception.

La probabilité d'interception n'est donc **pas une formule de jeu**. Elle résulte de la physique et de la connaissance :

- **vitesse d'arrivée** : plus le missile arrive vite, moins il passe de temps dans l'enveloppe, et plus une erreur de vitesse de la piste déplace le point visé ;
- **qualité du ciblage** : la tourelle vise la piste, jamais la vérité ; une piste décalée de 50 m fait passer toute la rafale à 50 m ;
- **saturation** : une tourelle ne vise qu'une cible à la fois, et changer de cible coûte un temps de pointage.

## 2. Conduite de tir (connaissance seule)

- **Solution de tir** : à partir de la position et de la vitesse estimées de la piste, on calcule le point de rencontre entre un obus tiré à la vitesse de bouche et la cible supposée en mouvement uniforme : `|r + v·t| = v_bouche·t`. Sans solution (la cible fuit plus vite que l'obus), on ne tire pas.
- **Enveloppe** : la distance du point de rencontre doit être inférieure à la portée de la fiche (autodestruction des obus).
- **Choix des cibles, mode Auto** : pistes « missile probable » non perdues, avec position et vitesse, qui se rapprochent et sont dans l'enveloppe. La plus pressante passe en premier (temps d'arrivée estimé). Chaque tourelle garde sa cible tant qu'elle reste valable ; sinon elle prend la plus pressante qu'aucune autre tourelle du bord ne traite déjà, ou à défaut la plus pressante.
- **Mode Manuel** : toutes les tourelles visent la piste désignée, quelle que soit sa classification. Comme pour les missiles, la qualité de piste informe sans bloquer.
- **Mode Arrêt** : aucun tir.
- **Pointage** : toute nouvelle cible, y compris la première, coûte le temps de pointage de la fiche avant le premier obus.
- **Cadence et munitions** : les obus partent à la cadence de la fiche, regroupés en une rafale par pas de simulation, jusqu'à épuisement du magasin de la tourelle.

## 3. Vol des obus et interception (vérité, résolution physique)

Le cahier autorise le résolveur d'engagement à lire la vérité pour un résultat physique ; la visée, elle, ne la lit jamais.

- Une rafale est un paquet de `n` obus qui part du vaisseau, à la vitesse du vaisseau plus la vitesse de bouche, vers le point visé. Elle vole en ligne droite et s'autodétruit à portée maximale.
- À chaque pas, on calcule le **passage au plus près** entre la rafale et chaque missile ou leurre adverse (mouvement relatif continu sur le pas, comme la collision des missiles). Au passage, on résout une seule fois :
  - dispersion : écart-type `σ = dispersion angulaire × distance parcourue depuis la bouche` ;
  - surface présentée `A` de la cible, selon l'angle (face ou profil, fiche du missile ou du leurre) ;
  - pour un obus : `p = 1 − exp(−A/(2πσ²) · exp(−d²/(2σ²)))`, où `d` est la distance de passage au centre de la rafale ;
  - pour la rafale : `P = 1 − (1 − p)ⁿ`, tirée sur le générateur à graine du monde.
- **Un obus qui touche détruit** le missile ou le leurre (même règle d'impact unique que pour les vaisseaux).
- Aucun tir fratricide ; les obus n'endommagent pas les vaisseaux (dommages localisés hors périmètre).

## 4. Ce que sait le joueur

- **Ses tourelles** : mode, cible, munitions, état (pointage, feu, vide). Tout est affiché au poste Tactique, avec une ligne entre le vaisseau et chaque piste prise à partie.
- **Le résultat, seulement par ses capteurs.** Un missile abattu cesse d'être mesuré : sa piste vieillit puis se perd. L'engagement indique « toujours mesurée après la rafale » ou « plus mesurée depuis la rafale », jamais « détruit » par règle.
- **Ses missiles abattus** par la PDC ennemie : liaison perdue.

## 5. Catalogue

Nouvelle section `components.pdcs` (optionnelle) et champ `pdcs: [{ id, component }]` dans les assemblages.

| Fiche | Vitesse de bouche | Cadence | Dispersion | Portée | Magasin | Pointage |
|---|---|---|---|---|---|---|
| **PDC 25 mm** | 1 500 m/s | 60 coups/s | 1 mrad | 5 km | 3 000 coups (50 s de feu) | 1 s |

- **[à valider]** 2 tourelles par corvette (dorsale et ventrale), couverture complète, sans secteur masqué.
- **Surface présentée** (nouveaux champs `presentedAreaFrontM2`, `presentedAreaSideM2`) :
  - missile chimique 0,13 / 1,6 m² ;
  - torpille Epstein 0,12 / 1,2 m² ;
  - leurre à réflecteurs 0,8 / 1,0 m² ;
  - leurre léger 0,1 / 0,3 m².

  Un objet sans ces champs ne peut pas être touché.

## 6. Commande et IA

- **[à valider]** Mode **Auto par défaut** pour les deux camps. Le cahier MVP interdisait le tir automatique des missiles du joueur ; une défense rapprochée qui attend un ordre pendant les quelques secondes d'une interception ne servirait à rien. Le joueur peut passer en Manuel ou en Arrêt.
- L'IA laisse ses tourelles en Auto : même code, sa propre connaissance.
- Le mode et la piste désignée sont des consignes ordinaires : enregistrés, rejoués, sauvegardés, refusés en pause (TIM-05).

## 7. Déterminisme, sauvegarde, analyse

- **Sauvegarde** (schéma 5, puis 6 avec la rotation des gisements) : munitions, cibles, temps de pointage, rafales en vol, mode.
- **Rejeu** : les tirages d'interception passent par le générateur du monde.
- **Analyse** (vérité interne, déroulement exporté au format 3, débrief en mode test). Pour chaque engagement :
  - la tourelle, la piste et **ce qu'elle suivait réellement** ;
  - l'**erreur de piste au tir** (écart entre la piste et le vrai missile) ;
  - les obus tirés et le meilleur passage (distance, dispersion, probabilité) ;
  - le résultat.

## 8. Ce que montrent les essais

**Banc réel** (catalogue, radar de bord en Suivi sur le missile, missile en dérive tiré de face, 12 graines) :

| Vitesse d'arrivée | Erreur de piste au premier tir | Missiles abattus |
|---|---|---|
| 1 km/s | ≈ 1 m | 11 / 12 |
| 3 km/s | ≈ 5 m | 3 / 12 |
| 6 km/s | ≈ 6–12 m | 1 / 12 |
| 9 km/s | ≈ 20 m, souvent aucune piste exploitable à temps | 1 / 12 |

Sans radar en Suivi sur le missile : 1 / 12 à 1 km/s, 0 au-delà.

- **La limite, c'est la chaîne de pistage du bord**, pas la tourelle. À vitesse égale, faire varier la vitesse de bouche (1 500 ou 2 200 m/s) ou la dispersion (1 à 4 mrad) ne change presque rien au-delà de 3 km/s.
- **À 9 km/s**, le radar en balayage large ne voit un missile de face qu'à environ 30 km. L'estimation de sa vitesse demande 2 s de mesures, puis le pointage 1 s : il ne reste plus de temps pour tirer.
- **Rejeu de la partie du 27/09 avec les tourelles** : contre le missile-1 (9,4 km/s), les deux tourelles tirent 312 obus sur une bonne piste (4 m d'erreur). Probabilité cumulée ≈ 17 %, missile non abattu. En face, les tourelles ennemies tirent 284 obus sur une piste « missile probable » qui suivait en réalité le vaisseau du joueur, à 39 km d'erreur : piste fausse, tirs perdus.

**Correction apportée au moteur.** Missiles et leurres bougeaient après la détection, donc les capteurs les voyaient avec un pas de retard (v × 1/60 s, soit 150 m à 9 km/s). Tous les corps bougent désormais avant les mesures. Cette correction a aussi changé un résultat des leurres (voir CONCEPTION_LEURRES.md §4).

**Tests** (`tests/pdc.test.ts`, `tests/pdc.catalog.test.ts`) :
- lois : solution de tir, probabilité d'une rafale, surface présentée ;
- conduite de tir : Auto, pointage, Arrêt, Manuel, pas de tir sur un vaisseau, visée sur la piste et non sur la vérité, répartition des cibles, magasin vide ;
- tendances exigées par l'attendu, sur plusieurs graines : la probabilité baisse avec la vitesse d'arrivée, avec l'imprécision de la piste et avec le nombre de missiles ;
- un leurre léger attire les obus ; reprise d'une sauvegarde avec des rafales en vol ; mode rejoué ; catalogue et validation.

## 9. Hors périmètre et limites

- **Pistes de missiles proches** (corrigé le 03/10) : la marge d'association recomptait le retard de la régression sur toute sa fenêtre (60 G sur 60 s dans la démo : des centaines de km), déjà inclus dans l'incertitude de position. Deux missiles distants de quelques centaines de mètres se partageaient une piste, et la tourelle visait entre les deux. Désormais, la marge se limite à l'incertitude et à la manœuvre possible depuis la dernière mesure. Surtout, les mesures d'un même balayage sont rattachées ensemble : une piste n'en reçoit qu'une (un objet ne renvoie qu'un écho par balayage), et le rattachement le plus vraisemblable passe en premier. Une piste très incertaine n'attire plus toutes les mesures de sa direction. Vérifié sur la démo : chaque tourelle de l'IA prend son missile. Limite : deux objets que le capteur ne sépare pas en angle (même distance, écart latéral sous le bruit de gisement) peuvent encore échanger leurs pistes.

- **Pas de radar de conduite de tir dédié.** La tourelle vise la piste du bord. Pour mieux viser, le joueur peut mettre son radar en Suivi sur le missile : c'est un vrai choix tactique. Les essais montrent que c'est la limite principale au-delà de 3 km/s. **Piste proposée [à décider]** : un radar de conduite de tir par tourelle, décrit au catalogue comme un capteur. Il aurait une portée courte, un faisceau fin et une revisite rapide, pointé automatiquement sur la cible de la tourelle. Il alimenterait la connaissance du bord comme les autres capteurs, et ses émissions seraient audibles par l'écoute ennemie.
- Les obus ne sont ni détectables ni dangereux pour les vaisseaux. Les tourelles ne consomment pas d'électricité, et la fiche ne donne pas la masse d'un obus : le magasin ne pèse pas dans la masse du vaisseau (missiles et leurres, eux, y sont comptés).
- La visée suppose un mouvement uniforme de la cible : un missile encore en poussée s'écarte du point visé.
