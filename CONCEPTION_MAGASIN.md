# Conception — magasin de vaisseau

Demande du 03/10 : « un magasin de vaisseau dans le menu de partie. On peut choisir une classe de vaisseau, voir ses stats et le modifier avec des éléments du magasin. » Décisions prises à cette occasion : **prix et budget**, et **deux classes ajoutées** à côté de la corvette. Les autres choix sont signalés **[à valider]**.

Statut : **implémenté, proposition à valider.**

## 1. Principe

- Le magasin s'ouvre depuis le briefing (bouton « Magasin : changer de vaisseau… » sur la carte du vaisseau du joueur).
- On choisit une **classe** (une coque et son assemblage de base), puis ses **modules** : moteur principal, réservoir, réacteur, un capteur de chaque type (ou aucun), type et nombre de missiles et de leurres, une tourelle par emplacement (ou rien).
- Tout se ramène à un **assemblage ordinaire du catalogue**. Le moteur de simulation reçoit un vaisseau résolu comme les autres ; la sauvegarde et le rejeu l'embarquent tel quel. Aucune règle de jeu nouvelle dans le moteur.
- La configuration validée est retenue dans le navigateur pour les parties suivantes. Si le catalogue ou le budget change et qu'elle n'est plus valable, on repart du vaisseau du scénario.

## 2. Données (catalogue v6)

- **Prix** (`price`, en crédits) sur chaque module vendu : coques, moteurs, réservoirs, réacteurs, capteurs, tourelles ; à l'unité pour les missiles et les leurres. Un module sans prix n'est pas en vente.
- **Masse des modules** (`massKg`). La masse à vide d'un vaisseau est désormais celle de sa coque **plus** celle de ses modules (munitions à part, comme avant). Les coques ont été recalées pour que les assemblages existants gardent exactement leur masse : la corvette fait toujours 150 t.
- **Classes** (`shipClasses`) : nom, description, assemblage de base, et limites — missiles et leurres en soute, emplacements de tourelle, plus gros réservoir logeable.
- **Budget** du scénario (`budgetCredits`, 160 000 Cr dans la démo). Sans budget ni classes, pas de magasin.

### Classes de départ [à valider]

| Classe | Masse (base) | Base | Soute | Tourelles | Réservoir max | Prix de base |
|---|---|---|---|---|---|---|
| Intercepteur | 60 t | NTR 1,5 MN, 60 t de propergol, réacteur 250 kWe, radar 8 kW | 2 missiles, 2 leurres | 1 | 60 t | 53 800 Cr |
| Corvette | 150 t | la corvette « classique × 2 » de la démo | 6 missiles, 4 leurres | 2 | 150 t | 103 600 Cr |
| Frégate | 400 t | NTR 6 MN, 300 t de propergol, réacteur 1 MWe | 12 missiles, 6 leurres | 4 (2 montées) | 300 t | 159 600 Cr |

Les nouvelles coques (intercepteur 28 m × 6 m, frégate 70 m × 16 m) ont leurs propres inertie, rayon de collision, surface radar, surface rayonnante et propulseurs d'attitude (30 kN et 150 kN).

### Modules ajoutés [à valider]

- Moteurs : chimique 4 MN (Isp 450 s, bon marché mais très lumineux en IR), NTR 1,5 MN, NTR 6 MN, Epstein 3 MN (fiction).
- Réservoirs 60 t et 300 t ; réacteurs 250 kWe et 1 MWe.
- Télescope IR 60 cm ; écoute avancée ; radars 8 kW (1,5 m²) et 60 kW (6 m²).
- Missile chimique léger (4 km/s) ; tourelles 20 mm (cadence) et 40 mm (portée).
- La batterie reste celle de la classe : ce n'est pas un module du magasin.

## 3. Écran

- **Budget** en tête : budget, coût, reste (ou dépassement), jauge.
- **Classes** : prix de base, description, masse, accélération, emport.
- **Modules** : une liste par emplacement, avec prix et caractéristiques du module choisi. Un réservoir trop grand pour la coque est grisé.
- **Caractéristiques**, recalculées à chaque choix avec les lois de la simulation, et comparées à la configuration d'entrée (vert : mieux, rouge : moins bien) :
  - propulsion : masse, poussée, accélération (plein et à vide, avec la limite de l'équipage), delta-v, durée de poussée ;
  - énergie : réacteur, demande tous capteurs allumés, marge ;
  - détection : portées à 50 % contre **le vaisseau adverse du scénario** (radar en secteur et ciel entier, missile de face, IR, écoute) ;
  - discrétion : à quelle distance les capteurs adverses vous voient (IR moteurs coupés, IR en poussée, radar de face) ;
  - armement : missiles, delta-v, portée d'engagement de la doctrine, leurres, tourelles ;
  - facture détaillée.
- **Valider** est refusé tant qu'un problème subsiste (budget, limite de classe, module inconnu ou pas en vente), avec la liste des problèmes.

## 4. Hors périmètre et limites

- **Seul le vaisseau du joueur** passe au magasin. Les alliés reprennent son vaisseau ; les ennemis gardent celui du scénario. **[à valider]** Donner un budget à l'adversaire, ou des configurations ennemies par scénario.
- **La vue en coupe** s'adapte à l'équipement (soutes, tourelles, capteurs, type de moteur), pas à la taille de la coque : un intercepteur ou une frégate s'y dessinent comme la corvette.
- **Pas d'économie entre les parties** : le budget est rendu à chaque mission.
- **La doctrine** reste celle de la classe : elle ne s'achète pas.
- Le libellé « Batterie 1 MWh » du catalogue ne correspond pas à sa capacité (3,6 × 10⁶ W·s, soit 1 kWh). Ce n'est pas corrigé ici : changer la capacité changerait le jeu.

## 5. Tests

`tests/shipyard.test.ts` : chaque classe livrée est valide, dans le budget et donne un scénario valide ; la corvette d'origine est exactement le vaisseau de la démo ; masse coque plus modules ; prix et dépassement de budget ; limites de classe (soute, emplacements, réservoir, type de capteur, moteur principal) ; module sans prix ; configuration stockée illisible ; effets attendus sur les caractéristiques (delta-v, accélération, radar) ; partie lancée avec un vaisseau sur mesure, sauvegarde restituée à l'identique ; classe invalide refusée par le catalogue.
