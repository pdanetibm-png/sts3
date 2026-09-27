# Conception — modèle de détection

Complète les §5.1 et §5.2 du cahier des charges. On reste dans leur cadre : un modèle simple et configurable, sans bandes ni fréquences, avec un signal reçu qui dépend de la signature, de la distance, de la sensibilité, du champ et du temps d'observation. Ce qui change : les lois physiques de base sont respectées (atténuation avec la distance, directivité), pour que les portées se déduisent les unes des autres de façon cohérente.

> **Révision en cours.** Les lois de ce document (directivité du jet, chaleur résiduelle, écoute avec faisceaux, probabilité et bruit fonction du signal) restent valables. En revanche, l'« échelle compressée » et les valeurs chiffrées ci-dessous sont **abandonnées** au profit d'un moteur physique à l'échelle réelle, avec capacités issues d'un catalogue de matériel. Le radar et l'IR y prennent en compte le temps d'observation par direction. Voir [ARCHITECTURE_SIMULATION.md](ARCHITECTURE_SIMULATION.md). Ce document sera réécrit à l'étape 2 de cette feuille de route.

Statut : **remplacé en partie** (voir l'encadré ci-dessus).

**Échelle.** Futur proche, type The Expanse. Les **lois physiques** (1/d², 1/d⁴, directivité) et les **rapports réels** sont respectés :
- le jet est environ 100 fois plus lumineux que la coque ;
- l'écoute entend un radar à environ 2 fois la portée de ce radar ;
- un missile renvoie de 0,05 à 0,5 m² contre des centaines de m² pour un vaisseau.

En revanche, l'**échelle absolue est compressée** pour tenir dans le théâtre du duel (~20 km). Des capteurs réels, même d'aujourd'hui, verraient un vaisseau à des centaines ou des milliers de km, et la détection ne serait plus un enjeu à cette échelle. Passer à des distances réalistes, avec des engagements de plusieurs heures, reste une évolution possible, mais c'est un autre jeu.

---

## 1. Principe général

Chaque tentative de détection suit la même chaîne :

1. **Émission** : ce que la cible rayonne ou renvoie *dans la direction de l'observateur*, qui dépend de l'angle de vue.
2. **Propagation** : l'affaiblissement avec la distance, en **1/d²** pour un trajet simple, en **1/d⁴** pour un aller-retour radar.
3. **Réception** : on compare le signal reçu à la **sensibilité** du capteur, un paramètre du matériel. Leur rapport donne le **SNR**.
4. **Détection probable** : la probabilité de détection dépend du SNR (§5). Elle vaut 50 % à la portée « nominale ».
5. **Mesure bruitée** : le gisement (et la distance pour le radar) est bruité d'autant plus que le SNR est faible.

La vérité (position, orientation, poussée) ne sert qu'au simulateur de capteur. Seule l'observation bruitée entre dans la connaissance, comme aujourd'hui (DET-01, DET-02).

---

## 2. Infrarouge passif

### Ce que la cible émet vers l'observateur (intensité, en W/sr)

```
I = I_coque + I_résiduel(t) + I_jet_max × poussée × g(θ)
```

- **Coque** (`I_coque`) : chaleur de l'équipement et du réacteur. Constante et identique dans toutes les directions.
- **Jet** (`I_jet_max × poussée`) : présent seulement quand le moteur pousse (poussée de 0 à 1), sans retard.
- **Directivité du jet** `g(θ)` : θ est l'angle entre l'axe d'éjection (vers l'arrière du vaisseau) et la direction de l'observateur.
  - vu de l'arrière (θ = 0) : g = 1 ;
  - vu de côté (θ = 90°) : g ≈ 0,6 (la colonne chaude est vue de profil) ;
  - vu de face (θ = 180°) : g = 0,05 (le jet est masqué par la coque).

  Formule : `g(θ) = 0,05 + 0,95 × ((1 + cos θ) / 2)^0,75`.
- **Chaleur résiduelle** (`I_résiduel`, identique dans toutes les directions) : la tuyère et la coque chauffent avec la poussée. Elle tend vers `f_rés × I_jet_max × poussée` avec une constante de temps τ, et redescend avec la même constante quand la poussée baisse. C'est ce qui assure DET-05 (couper les moteurs ne rend pas invisible d'un coup).

### Ce que le capteur reçoit

```
E = I / d²      (éclairement, W/m²)
SNR = E / S_IR  (S_IR : sensibilité du capteur, W/m²)
```

L'IR ne mesure qu'un gisement, jamais de distance (DET-01). Il couvre toute la sphère, avec un cycle fixe.

---

## 3. Radar actif

### Ce qui revient au radar

```
SNR = (d_ref / d)⁴ × σ(θ) / σ_ref
```

- `d_ref` est la portée de référence du radar, à 50 % de détection, contre une cible de surface radar `σ_ref = 100 m²`. C'est un paramètre du matériel ; il dépend de sa puissance et de son antenne.
- **Surface radar selon l'angle** : `σ(θ) = σ_face + (σ_profil − σ_face) × sin²θ`. θ est l'angle entre l'axe long de la cible et la ligne de visée : une cible vue de face renvoie peu, vue de profil beaucoup.
- Conséquence de la loi en puissance 4 : **la portée varie comme la racine quatrième de la surface radar**. Diviser la surface par 10 000 ne divise la portée que par 10.

### Balayage

Inchangé : couverture large ou secteur. Un secteur étroit accélère le cycle, sans gain de portée (§5.2 du cahier : « améliore la cadence et/ou la précision »). Seules les cibles dans le secteur sont évaluées.

---

## 4. Écoute radar passive

L'émission d'un radar est un **aller simple** : elle s'affaiblit en **1/d²**, alors que l'écho que ce radar attend s'affaiblit en 1/d⁴. D'où la règle tactique : **on entend un radar bien plus loin qu'il ne nous voit**.

```
SNR = (P_radar × G / d²) / S_écoute
```

- `G` est le **gain d'antenne vu par l'écouteur** :
  - `G_principal` si l'écouteur est dans le faisceau (dans le secteur balayé, ou toujours en balayage large, puisque le faisceau passe partout à chaque cycle) ;
  - `G_secondaire`, beaucoup plus faible, sinon (lobes secondaires).
- Correction d'une incohérence actuelle : un radar en secteur tourné ailleurs n'est plus entendu au loin, seulement par ses lobes secondaires, à courte distance.
- L'écoute donne un gisement vers l'émetteur, jamais sa distance (§5.1).

---

## 5. Probabilité de détection et qualité de mesure

- **Probabilité par balayage** : `P = SNR⁴ / (1 + SNR⁴)`. Elle vaut 50 % à SNR = 1, 94 % à SNR = 2 et 6 % à SNR = 0,5. Chaque cycle achevé tire sa chance. Le tirage passe par le générateur à graine du monde, donc le jeu reste déterministe : sauvegarde, reprise et rejeu restent exacts.
  - Conséquence : un contact à la limite apparaît et disparaît, au lieu d'un tout ou rien au mètre près (§5.2 : « chaque cycle peut produire une observation ou aucun résultat »).
- **Bruit de mesure** : `σ_gisement = σ_nominal / √SNR`, borné entre σ_nominal / 4 et σ_nominal × 2. Même règle pour le bruit de distance radar. Un contact faible est flou, un contact fort est net.

---

## 6. Les missiles deviennent des cibles

- Les missiles sont évalués par les capteurs comme les vaisseaux, avec leur propre signature (coque IR, jet, surface radar). Leur axe est celui de leur poussée, ou de leur vitesse une fois en dérive.
- **Missiles amis** (camp bleu, ou camp rouge pour l'adversaire) : connus par la liaison de données, comme les vaisseaux amis. Ils ne créent jamais de piste.
- Les missiles ne sont jamais observateurs : ils n'ont pas de capteur (§6 : « la liaison ne transforme pas le missile en capteur »).

---

## 7. Classification estimée (connaissance, jamais la vérité)

Une piste reçoit une classe estimée, avec sa confiance et sa source :

- **Radar** : la surface radar apparente se déduit du SNR et de la distance mesurée, avec une marge d'erreur de ±50 %. Si elle est inférieure à 5 m², la piste est un « missile probable » ; si elle dépasse 20 m², un « vaisseau probable ».
- **Mouvement** (étape ultérieure) : une accélération estimée supérieure à 3 G (au-delà de ce qu'un vaisseau habité soutient) donnera un « missile probable ».
- **IR seul** : pas de classe fiable sans distance. La piste reste « inconnu ».

---

## 8. Valeurs proposées

| Élément | Paramètre | Vaisseau | Missile |
|---|---|---|---|
| IR coque | `I_coque` | 6 400 W/sr | 10 W/sr |
| IR jet à pleine poussée | `I_jet_max` | 600 kW/sr | 60 kW/sr |
| Chaleur résiduelle | `f_rés`, τ | 5 %, 20 s | 5 %, 10 s |
| Surface radar de face | `σ_face` | 60 m² | 0,05 m² |
| Surface radar de profil | `σ_profil` | 400 m² | 0,5 m² |

| Capteur | Paramètres |
|---|---|
| IR passif | sensibilité `S_IR` = 1×10⁻⁴ W/m², cycle 2 s, gisement ±0,05 rad |
| Radar actif | `d_ref` = 40 km (pour 100 m²), 20 kW, `G_principal` = 1 000, `G_secondaire` = 1, cycle 3 s (large), gisement ±0,02 rad, distance ±50 m |
| Écoute passive | sensibilité `S_écoute` ≈ 1,96×10⁻⁴ W/m² : entend ce radar dans son faisceau à 90 km, soit environ 2,8 km par les lobes secondaires ; cycle 1,5 s, gisement ±0,04 rad |

### Portées résultantes (50 % de détection par balayage)

| Situation | IR | Radar | Écoute |
|---|---|---|---|
| Vaisseau moteurs coupés depuis longtemps | **8 km** (tous angles) | face **35 km** · profil **57 km** | — |
| Vaisseau à 100 % de poussée, régime établi | arrière **80 km** · profil **63 km** · face **26 km** | idem | — |
| Vaisseau à 30 % | arrière **44 km** · profil **35 km** · face **16 km** | idem | — |
| Vaisseau juste après coupure (depuis 100 %) | **19 km**, puis 13 km à +20 s et 9 km à +60 s | idem | — |
| Missile en poussée | arrière **25 km** · profil **20 km** · **face 7 km** | face **6 km** · profil **11 km** | — |
| Missile en dérive, juste après extinction | **5 km**, puis environ 1 km à +30 s | face **6 km** · profil **11 km** | — |
| Radar adverse en balayage large | — | — | **90 km** |
| Radar adverse en secteur pointé sur toi | — | — | **90 km** |
| Radar adverse en secteur pointé ailleurs | — | — | **2,8 km** |

Pour mémoire, aujourd'hui :
- l'IR voit un vaisseau à 8 km moteurs coupés et à 80 km à pleine poussée, quel que soit l'angle ;
- le radar voit un vaisseau à 40 km quel que soit l'angle ;
- l'écoute entend un radar à 30 km dans toutes les directions ;
- les missiles sont invisibles.

---

## 9. Ce que ce modèle fait émerger (tactique)

- **Pousser, c'est se montrer**, surtout de dos : fuir moteurs allumés est visible de très loin. Foncer sur l'ennemi l'est beaucoup moins, puisque le jet est masqué.
- **Émettre, c'est se trahir** : un radar en balayage large s'entend à 90 km alors qu'il ne voit qu'à 35–57 km. Le secteur étroit est discret, sauf pour la cible visée, qui l'entend.
- **Un missile qui arrive de face est difficile à voir en IR** (7 km en poussée), mais le radar le voit à environ 6 km. Une fois éteint, il faut le radar.
- Une fois en dérive, un missile ne corrige plus sa route. Le détecter à temps permet de s'en écarter (futur mode « perpendiculaire » du Pilotage).
- **Profil ou face compte** : se présenter de face réduit à la fois l'écho radar et la visibilité du jet.

---

## 10. Hors périmètre (conforme au cahier)

- Pas de radiateurs, de thermique détaillée, de bandes ni de fréquences.
- Pas d'éblouissement de nos capteurs par notre propre jet.
- Pas de brouillage, de leurres ni de furtivité active.
- Pas de masquage d'un vaisseau par un autre.
- Pas de télescope visible (reporté par le §5.1).

---

## 11. Impacts techniques

- **Scénario** : nouveaux blocs de signature (IR coque, jet, résiduel ; surface radar face et profil) par vaisseau **et par missile**, et nouveaux paramètres de capteur (sensibilités, `d_ref`, gains d'antenne). La version du scénario passe à 0.3.0 et le validateur est mis à jour.
- **Sauvegardes** : la version de schéma change, donc les sauvegardes antérieures sont refusées proprement (comportement déjà prévu).
- **Rejeux** : les déroulements exportés avant ce changement ne se rejouent plus à l'identique, puisque le moteur change. C'est normal ; ceux exportés après restent exacts.
- **Association des pistes** : à faire en même temps. Avec des missiles détectables, plusieurs contacts proches deviennent la règle, et l'association par gisement seul ne suffit plus (correctif 1 déjà proposé : association par position quand elle est connue).
- **IA** : elle voit aussi les missiles ennemis. Elle doit ignorer les pistes « missile probable » pour ses propres tirs. Pas d'esquive pour l'IA dans cette étape.
- **Tests** : lois de portée (IR en carré de la distance, radar en puissance 4, écoute dans et hors faisceau), directivité du jet, chaleur résiduelle, probabilité et bruit selon le SNR, missiles détectables, aucune piste sur un missile ami, classification, et rejeu exact.

---

## 12. Décisions

1. **Portées** : celles du tableau §8. L'écoute est ramenée à 90 km (rapport réel d'environ 1,6 à 2,6 fois la portée radar).
2. **Missile vu de face** : peu visible en IR, le radar est le moyen de le voir. C'est la physique.
3. **Détection probabiliste** : oui (§5).
4. **Secteur radar** : il accélère le cycle, sans gain de portée. Le Suivi s'appuie sur cette cadence.
5. **Équipement** : le même pour tous les vaisseaux (§9.1 du cahier). Le catalogue permettra de varier plus tard.
