# SCS — Cahier des charges du MVP

Version 1.0 — 23 septembre 2026 — Document de préparation à l’implémentation.

Ce document décrit un jeu fictionnel solo de commandement spatial dans un navigateur. Il ne contient aucune implémentation. Il vise une petite partie complète, lisible et rejouable, avec une interface aboutie dès la première version. L’inspiration est celle d’une science-fiction spatiale crédible, notamment The Expanse ; l’univers, les noms et les assets seront originaux.

## 1. Statut des décisions

Les marqueurs suivants s’appliquent à toutes les exigences et valeurs du document :

- **[D] Décision utilisateur** : explicitement retenue dans le contexte transmis.
- **[P] Proposition par défaut** : recommandation exploitable pour commencer une future implémentation, sans prétendre à une validation utilisateur.
- **[A] Arbitrage ouvert** : choix restant à confirmer ; une recommandation permet néanmoins d’avancer.

Une exigence de statut P est vérifiable si ce défaut est adopté. Les critères ne transforment pas les propositions en décisions utilisateur. Tous les nombres de gameplay et budgets de performance sont des réglages provisoires ; ils ne représentent pas des performances physiques ou militaires validées.

| Sujet | Statut | Position retenue dans ce document |
| --- | --- | --- |
| Jeu solo navigateur et passage entre postes | D | Un vaisseau commandé successivement depuis plusieurs consoles |
| Vue intérieure | D | Coupe 2D isométrique avec compartiments cliquables ; pas d’intérieur 3D lourd |
| Espace et manœuvres | D | Espace physique 3D, inertie et attitude indépendantes |
| Temps | D | Trois vitesses, retour normal sur détection/alerte critique connue sans changement de poste ; ordres persistants |
| Détection | D | Observations, pertes, estimations incertaines et recherche au centre du jeu |
| Armement | D | Missiles seuls, stock fini, sans autodirecteur terminal |
| Liaison missiles | D | Instantanée, disponible quelle que soit la distance, sans révéler la cible |
| Modularité | D | Composants physiques décrits en données ; éditeur interactif non requis |
| Carte maître | D | Vérité visible dès le début du développement, exclusivement en mode test |
| Plateforme initiale | P | Ordinateur, souris et clavier ; mobile reporté |
| Zone locale sans gravité | P | Référentiel inertiel local ; pas de système solaire complet |
| Capteurs initiaux | D | IR passif, écoute radar passive et radar actif en balayage ; visible reporté |
| Pilotage assisté | D | Consignes traduites en commandes moteurs ; pas de commandes directes de chaque propulseur pour le joueur |
| Pause | D | Suspension de session sans possibilité de donner des ordres |
| Accélérations équipage | D | Jauge directionnelle, avertissement sans blocage ; exposition excessive prolongée entraînant incapacité et échec |
| Scénario initial | D | Duel symétrique : deux vaisseaux identiques, mêmes moyens et réserves, recherche et neutralisation réciproques |
| Technologie de réalisation | A | Application locale côté navigateur ; choix de bibliothèque après prototype technique |

## 2. Intention, boucle et périmètre

Le joueur doit comprendre pourquoi il change de poste : piloter pour choisir sa trajectoire et sa signature, détecter pour construire une connaissance imparfaite, armer sur cette connaissance et gérer les réserves qui rendent ces décisions possibles. Le jeu ne récompense pas une connaissance omnisciente du monde.

Boucle : lire l’objectif → manœuvrer → observer → qualifier une piste → choisir une recherche → retrouver ou perdre le contact → engager → constater les conséquences → terminer la mission. Le vaisseau poursuit ses ordres pendant les changements de console.

### 2.1 Inclus

- Un scénario local complet, un vaisseau joueur, un adversaire à comportements simples capable de chercher et engager, et un petit stock de missiles.
- Coupe intérieure, cinq postes, bandeau commun, fiche de contact partagée, aide contextuelle.
- Translation et rotation 3D, moteurs placés, propergol, masse variable, puissance disponible et énergie stockée.
- Recherche IR, écoute radar passive et balayage radar actif, mesures imparfaites, extrapolation et incertitude.
- Missiles utilisant le même socle dynamique que les vaisseaux et une neutralisation en un impact direct.
- Briefing, succès/échec, débrief, sauvegarde locale, reprise, redémarrage et journal reproductible.
- Mode test avec carte maître et diagnostics.

### 2.2 Exclus

Multijoueur, campagne, génération de système solaire, gravitation, navigation interplanétaire, relativité, délai de propagation, équipage simulé individuellement, physiologie détaillée, intérieur 3D, constructeur interactif, dommages localisés, réparation, économie, PDC, leurres, brouillage, contre-mesures, acquisition terminale autonome, IA tactique avancée et thermique détaillée. Les radiateurs ne font pas partie du MVP et ne doivent jamais être présentés comme supprimant magiquement la signature.

Le visible et les fonctions passives électromagnétiques au-delà de l’écoute radar restent des évolutions souhaitées. Aucune commande factice ne doit faire croire qu’ils fonctionnent dans le MVP.

## 3. Architecture conceptuelle et contrats de données

### 3.1 Trois couches étanches

1. **Vérité simulation** : positions et mouvements réels, ressources, émissions, collisions et résultats. Seuls les systèmes de simulation et le diagnostic autorisé y accèdent.
2. **Connaissance à bord** : observations accessibles à un observateur, pistes estimées et historique de ce qu’il sait. Une instance séparée existe pour le joueur et pour l’adversaire.
3. **Présentation** : vues de la connaissance autorisée et des états propres au vaisseau. Les consoles normales ne reçoivent pas d’entité cible réelle sérialisée en guise de piste.

L’estimateur reçoit des observations et des hypothèses publiques de mouvement ; il ne reçoit jamais la vitesse, la distance ou les manœuvres cachées de la cible. Le résolveur d’engagement peut lire la vérité pour calculer un résultat physique abstrait ; cette autorisation ne s’étend pas aux commandes de missile ni au retour d’information du joueur.

L’adversaire peut exécuter un calendrier de manœuvres prédéfini, indépendant du joueur. Toute réaction à un contact ou tout tir doit passer par sa propre connaissance. Un script n’a pas le droit de viser la position réelle cachée du joueur.

### 3.2 Objets conceptuels

| Objet | Données minimales | Contraintes |
| --- | --- | --- |
| Définition de scénario | Version, graine, états initiaux, objectifs, scripts, paramètres | Aucun réglage indispensable codé uniquement dans une console |
| Corps dynamique | Position, vitesse, attitude, vitesse angulaire, masse, centre de masse, inertie, affiliation vraie | Unités SI internes ; quaternion normalisé ou représentation équivalente |
| Structure | Masse sèche, volume/enveloppe, géométrie simplifiée | Masse strictement positive, aucune notion de « poids » hors gravité |
| Composant | ID, type, position et orientation locales, masse, état, attributs | Montage exprimé dans le référentiel du corps |
| Propulseur | Axe de force, poussée maximale, impulsion spécifique, modulation, alimentation | Principaux et RCS suivent le même contrat force/couple |
| Réservoir | Capacité, quantité, position, type de ressource | Aucun contenu négatif ; masse du contenu incluse |
| Énergie | Production disponible, puissance des consommateurs, batterie | Distinguer W de J et débit instantané de stock |
| Capteur | Mode, axe/secteur, cycle, portée de jeu, bruit, puissance | Produit des observations datées propres à l’observateur |
| Observation | Date de mesure, source, direction, mesures optionnelles, erreurs | Champs distance/vitesse absents si non mesurés |
| Piste | ID local, observations, estimation facultative, incertitude, ancienneté, état, classification estimée avec confiance/source | ID réel de cible réservé au diagnostic, pas à l’interface |
| Ordre persistant | Auteur, type, paramètres, date, état et motif d’arrêt | Validé au tick de simulation, indépendant du poste affiché |
| Missile | Corps, moteurs, réserves, propriétaire, piste assignée, ordre | Aucun capteur de poursuite terminale |
| Compartiment visuel | Polygone cliquable, label, console associée | Distinct du composant physique et de la fonction de poste |
| Événement | Temps simulation, catégorie, visibilité, charge utile | Séparer journal interne et journal connu du joueur |
| Sauvegarde | Versions, état complet, connaissances, ordres, RNG, échéances | Reprise sans nouveau tirage aléatoire ni mesure gratuite |

L’affiliation vraie appartient à la simulation ; la classification estimée appartient à la connaissance, avec source et confiance. Cette séparation prépare de futurs amis/civils sans ajouter de vaisseaux ni de système complexe d’identification au duel MVP. De manière générale, prévoir l’extensibilité des données ne demande pas d’implémenter les extensions.

Un composant peut être situé dans un compartiment sans être un poste de commande. Un poste peut commander plusieurs composants. La coupe ne doit pas dicter les calculs physiques.

### 3.3 Repères et conventions proposés

**[P]** Repère monde cartésien droit, coordonnées en mètres ; repère corps documenté avec axe longitudinal explicitement choisi. L’interface affiche les unités adaptées (m/s, km, secondes, pourcentage), sans mélanger coordonnées locales et mondiales. L’attitude transforme les forces locales en forces mondiales. Une commande de rotation ne transforme pas directement la vitesse de translation.

## 4. Dynamique, ressources et limites

### 4.1 Mouvement

**[D]** Sans force externe, la vitesse linéaire est conservée. Freiner demande une poussée opposée au mouvement ; tourner seul ne freine pas. Les commandes couvrent les trois translations et les trois rotations.

**[P]** La somme des forces fournit l’accélération linéaire ; le bras de levier de chaque moteur par rapport au centre de masse fournit son couple. Un moteur décentré peut produire translation et rotation. Une approximation d’inertie documentée suffit, mais doit répondre au placement et aux masses. Inclure les effets d’une inertie variable de manière cohérente, ou limiter explicitement les redistributions internes du MVP ; ne pas introduire de rotation spontanée lors d’une mise à jour de masse.

**[D]** Débit de propergol lié à la poussée et à l’impulsion spécifique, avec gravité standard utilisée uniquement comme constante de conversion. La quantité consommée diminue la masse totale. Les moteurs s’arrêtent exactement à l’épuisement, sans pousser avec des ressources négatives. Recalculer centre de masse et inertie quand les stocks ou missiles changent.

**[P]** Les missiles quittent le stock à leur lancement ; leur masse passe du porteur au nouveau corps. Vitesse initiale égale à celle du point de lancement, avec séparation abstraite configurable ; aucune impulsion fictive involontaire. Une éventuelle impulsion de séparation doit être explicitement modélisée ou déclarée négligée.

**[D]** Référence de départ pour les moteurs : propulsion de science-fiction inspirée de The Expanse. **[P]** Traduire cette intention en moteurs capables de poussées soutenues, avec inertie, freinage propulsif et consommation effectivement simulés. Aucune valeur numérique de poussée, masse, impulsion spécifique ou autonomie n’est présentée comme une spécification canonique vérifiée de cet univers. Ces paramètres restent des réglages de jeu à choisir ensemble ; le seuil équipage de 5 G n’est ni une accélération constante imposée ni la puissance maximale du moteur. Les deux vaisseaux du duel reçoivent la même configuration.

### 4.2 Pilotage assisté retenu

**[D]** Le pilotage est assisté ; le joueur ne commande pas chaque propulseur. **[P]** L’assistance maintient une attitude demandée par les RCS disponibles, sans modifier directement le quaternion. Le joueur règle la poussée principale, demande une attitude, active/coupe le maintien et peut commander des translations RCS. Un banc de diagnostic réservé au mode test permet de vérifier chaque moteur, sans ajouter de commandes individuelles au parcours joueur.

Une commande « orienter à contre-vitesse » propose une attitude ; le joueur autorise ensuite la poussée de freinage. Un assistant de freinage facultatif coupe la poussée près de la vitesse cible dans une tolérance affichée. Il ne promet pas une arrivée parfaite si les réserves ou l’autorité des moteurs sont insuffisantes. Pas de pilote automatique universel dans le MVP.

### 4.3 Ressources, puissance et énergie

**[D]** Ressources : propergol, stock de missiles, production électrique limitée et batterie. Le premier vaisseau dispose d’un réservoir de propergol commun aux moteurs principaux et aux RCS ; chaque missile possède sa propre réserve. Les données permettent des circuits multiples ultérieurs sans les implémenter maintenant.

**[D/P]** Le surplus de production recharge la batterie dans ses limites de puissance et capacité ; un déficit la décharge dans ses limites. Les priorités choisies à l’ingénierie déterminent les réductions ou arrêts si la fourniture reste insuffisante. Afficher bilan production/demande, charge/décharge réelle, état, alertes et autonomie estimée selon consommation courante (indéterminée si non calculable). La production est plafonnée par les caractéristiques du générateur et conditionnée au carburant disponible. Ordre initial proposé : support vie/commandes, propulsion auxiliaire/RCS, capteurs, services secondaires ; le joueur peut changer ces priorités. Les moteurs consomment propergol et puissance auxiliaire ; l’électricité ne se substitue pas au propergol.

**[D]** Le générateur produit l’électricité à partir du carburant tant qu’il en reste ; les batteries constituent principalement une réserve de secours, peu sollicitée dans le scénario initial. **[P]** Pour limiter le périmètre, le générateur prélève dans la réserve commune de carburant/propergol du vaisseau, avec un débit configurable lié à la puissance fournie ; cette unification est une abstraction de jeu, pas un modèle de réacteur réel. Dimensionner sa puissance pour couvrir la consommation nominale, avec recharge du surplus. La batterie couvre un déficit ou l’arrêt du générateur dans ses limites, sans produire de carburant. À épuisement, le générateur cesse de produire exactement à la limite de ressource ; les équipements électriques peuvent continuer sur batterie, mais les moteurs ne poussent plus sans propergol. La consommation du générateur diminue aussi la masse stockée. Aucun système détaillé de réacteur requis.

Le radar ne commence un cycle que si son budget prévu est disponible ; une perte d’alimentation en cours de cycle l’interrompt sans observation. Les équipements affichent « puissance insuffisante », « batterie vide », « réservoir vide » ou « indisponible » selon la cause réelle. Les réserves ne se rechargent pas hors simulation.

### 4.4 G et support vie

**[D]** Afficher clairement l’accélération subie, sa valeur en G et sa direction dans le repère du vaisseau. Une jauge/barre utilise des seuils configurables, des libellés et une indication de dépassement, jamais la couleur seule. La force propulsive (N), l’accélération (m/s² ou G) et la vitesse sont distinguées : les G ne sont pas liés à la vitesse absolue. Distinguer limites conventionnelles de confort/tolérance équipage et limites structurelles ; aucun modèle médical détaillé.

**[D]** L’assistance avertit mais laisse forcer la manœuvre. Aucun limiteur obligatoire ne bloque le dépassement. Les limites matérielles des moteurs, leur puissance disponible et leurs réserves restent effectives : une dérogation n’ajoute pas de poussée.

**[P]** Afficher valeur actuelle et prévision de la consigne, direction et marges équipage/structure séparées. Une commande dépassant un seuil porte un libellé persistant « Forcer la manœuvre » et demande une action explicite unique pour cette consigne ; pas de fenêtre répétée à chaque tick. **[D]** Le seuil initial de surcharge équipage est fixé à **5 G**, ajustable après essais. Il s’agit d’une convention de jeu, pas d’une limite physiologique validée. **[P]** Utiliser initialement ce même seuil dans toutes les directions, en affichant la direction réelle ; les coefficients directionnels et durées d’exposition restent réglables. Le dépassement avertit sans bloquer, puis alimente la charge d’exposition. Documenter l’approximation des accélérations de rotation au point équipage.

**[D]** Une exposition prolongée au-delà des capacités de l’équipage provoque dès le MVP une incapacité abstraite et l’échec de sa mission. L’avertissement laisse toujours forcer. La règle s’applique aussi à l’adversaire habité, jamais aux missiles sans équipage. Pas de simulation détaillée de perte de connaissance ou de décès.

**[P]** Modèle conseillé : une charge d’exposition normalisée augmente lorsque l’accélération directionnelle dépasse le seuil conventionnel de l’axe concerné ; son taux dépend du dépassement. Sous les seuils, elle récupère progressivement selon un taux configurable. À charge 100 %, incapacité irréversible pour la mission. Utiliser le maximum des ratios directionnels comme simplification initiale ; coefficients, seuils par axe, taux d’accumulation/récupération et traitement des inversions restent à régler. Afficher charge, tendance, direction dominante et délai estimé avant incapacité si la consigne persiste. Toute durée est simulée, indépendante de la vitesse temporelle.

L’exemple utilisateur « 15 G pendant 30 s » est illustratif : ni seuil physiologique réel validé, ni réglage accepté. Les seuils éventuels de ce document restent des conventions de jeu. **[A]** Les conséquences des limites structurelles restent ouvertes ; défaut proposé : avertissement distinct sans dommages structurels simulés. Elles ne se confondent pas avec l’incapacité équipage décidée.

**[P]** Support vie : état alimenté/non alimenté, réserve d’autonomie simplifiée et temps restant estimé. Une coupure consomme une autonomie d’urgence ; son épuisement provoque l’échec de mission. Valeur initiale proposée : 180 secondes simulées. Aucun système complet d’atmosphère, température ou métabolisme.

## 5. Détection et connaissance

### 5.1 Trois modes de capteurs confirmés

**[D]** IR passif, écoute radar passive et radar actif sont inclus. L’actif fonctionne par balayage au départ, sans verrouillage continu spécifique. L’utilisateur confie le choix des seuils et règles provisoires à l’implémentation : privilégier un modèle simple et configurable, sans simulation détaillée des bandes ou fréquences.

| Capteur | Statut | Information proposée | Coût/compromis proposé |
| --- | --- | --- | --- |
| IR passif | D | Direction incertaine et intensité/qualité ; pas de distance exacte | Chaleur, distance, seuil, champ et cadence déterminent une observation ; puissance faible |
| Écoute radar passive | D | Direction incertaine d’une émission reçue et qualité ; pas de distance exacte | Nécessite une émission adverse reçue au-dessus des capacités/seuils du composant |
| Radar actif en balayage | D | Direction et distance estimées ; mouvement estimé sur mesures successives | Puissance supérieure ; émissions susceptibles d’être perçues par l’écoute passive adverse |
| Télescope visible | Reporté | À terme, observation directionnelle et classification | Aucun classement exact par défaut |

**[D/P]** Chaque capteur est un composant de catalogue modulaire avec signature de référence, portée nominale, sensibilité/seuil, champ couvert, cadence, erreurs et consommation propres. Ajouter un radar de meilleures capacités ou portée doit se faire par données sans changer le moteur de simulation. La portée nominale est définie pour une signature et un mode de référence ; elle ne garantit pas la détection de tous les objets.

**[P]** Le signal reçu abstrait dépend de la signature chaleur/émission, de la distance, de la sensibilité, du champ et du temps d’observation. Un seuil configurable détermine une observation possible, avec bruit reproductible. Le radar actif émet lors de ses cycles ; l’écoute passive adverse évalue ces émissions selon ses propres caractéristiques, sans recevoir automatiquement la position de l’émetteur. Aucun modèle détaillé de capteur militaire n’est requis.

Un gisement est la direction vers un contact ; ce n’est pas son cap ni la direction de son mouvement. Une observation isolée ne fournit pas sa vitesse 3D. Même une mesure radar de distance reste estimée ; le mouvement se construit à partir d’observations successives.

### 5.2 Recherche, suivi et signature

**[P]** Tâches proposées : balayage large ou secteur concentré. Le « suivi » désigne le recentrage répété des balayages sur la zone estimée d’une piste, sans mode radar de verrouillage continu ni mesure gratuite. Le joueur choisit direction centrale et largeur de secteur ; un indicateur montre le cycle et le prochain résultat attendu. Un secteur étroit réduit la couverture et améliore la cadence et/ou la précision selon les caractéristiques publiques du composant ; ces gains et la durée du cycle sont affichés. Les réglages ne garantissent pas une acquisition.

La détection dépend de la signature, de la distance réelle utilisée uniquement par le simulateur de capteur, de la couverture, du temps d’intégration et d’un bruit reproductible. Chaque cycle achevé peut produire une observation ou aucun résultat. Une absence de résultat n’est pas une preuve de cible absente.

**[D/P]** Couper les moteurs réduit la composante liée à la propulsion, mais ne supprime pas la chaleur résiduelle. Une signature de base et une décroissance thermique simple sont proposées. Aucun calcul détaillé de radiateurs. Les valeurs sont des paramètres de lisibilité du scénario, pas un modèle validé de capteur réel.

### 5.3 Pistes et estimation

**[D]** La création et la mise à jour des contacts sont automatiques. Le joueur choisit les zones et priorités de recherche, pas chaque opération de fusion ou mise à jour. Les consignes de capteurs persistent lors des changements de poste.

**[P]** Une première mesure angulaire est représentée par une direction ou un cône, sans point 3D arbitrairement exact. Des mesures compatibles peuvent construire une zone de position ; la vitesse reste « inconnue » ou estimée avec une incertitude tant que les observations ne la contraignent pas. Une vitesse supposée doit être identifiée comme hypothèse.

Entre observations, une piste est extrapolée selon un modèle simple de mouvement constant. Son incertitude augmente avec le temps et une marge de manœuvre supposée publique. Les manœuvres réelles non observées ne corrigent ni le centre ni l’incertitude de la piste. Un changement caché de cible ne peut pas déclencher un signal UI.

États proposés :

- **Récent** : mesure valide datant de moins de 5 secondes simulées.
- **Extrapolé** : pas de mesure récente ; estimation et incertitude visibles.
- **Perdu** : plus de 30 secondes sans observation, ou incertitude supérieure au seuil de jeu configuré ; historique conservé.

Ces seuils provisoires sont affichés dans l’aide. « Perdu » ne signifie ni détruit ni parti. La réacquisition associe les observations aux pistes par compatibilité estimée ; en cas d’ambiguïté, créer une piste candidate et afficher le doute. L’identifiant réel de la cible ne sert pas à fusionner les pistes en mode réaliste.

### 5.4 Fiche partagée

Chaque poste affiche le même ID local, l’état, la dernière observation et sa source, l’ancienneté, les coordonnées estimées si disponibles, la vitesse estimée si disponible, les incertitudes et l’historique des mesures. Les champs inconnus disent « inconnu ». Une étiquette distingue observation, estimation et hypothèse. Le changement de poste ne recalcule pas gratuitement une mesure.

## 6. Missiles et résolution fictionnelle

**[D]** Un missile est un petit corps propulsé avec propergol, masse et paramètres propres. Son accélération configurée peut dépasser celle tolérée par un humain, sans impliquer une poussée absolue supérieure à celle du vaisseau. Aucun autodirecteur ni acquisition terminale autonome.

**[D]** La décision de tir appartient uniquement au joueur opérateur ; la qualité de piste informe sans verrouiller le lancement. Restent les contraintes physiques : stock, équipement opérationnel, alimentation et partie active. Une piste incertaine, directionnelle, extrapolée ou perdue ne bloque pas un tir pour sa qualité. Aucun tir automatique du vaisseau joueur.

**[P]** Afficher une estimation qualitative de réussite (« faible », « moyenne », « élevée », « indéterminée ») fondée uniquement sur la connaissance disponible, les réserves du missile et les hypothèses déclarées ; jamais une garantie. Si seule une direction est connue, le tir utilise une consigne directionnelle ou une distance hypothétique explicitement choisie/affichée, sans inventer une distance mesurée. Sans piste, un tir sur une direction explicitement désignée est possible avec réussite indéterminée. L’interface permet cette décision sans révéler de vérité cachée.

L’ordre de déplacement abstrait du missile utilise uniquement l’estimation fournie par le porteur. Une liaison instantanée met cette consigne à jour à partir des nouvelles estimations disponibles ; elle n’ajoute aucune observation. La spécification reste volontairement au niveau des comportements de jeu et ne prescrit pas d’algorithme opérationnel de guidage d’armes réelles.

**[D]** Après perte d’observation, le missile poursuit sur la dernière piste estimée/extrapolée et reçoit des corrections en cas de réacquisition, toujours sans connaissance réelle cachée ni autodirecteur. **[P]** Le modèle abstrait de poursuite et ses réglages seront affinés par essais. Aucun délai obligatoire d’abandon n’est décidé ; défaut proposé : poursuite jusqu’à ordre d’abandon, épuisement de propulsion ou sortie de la limite du théâtre. Une réserve vide laisse le missile dériver ; il ne s’immobilise pas. Une réacquisition peut corriger la consigne, mais ne restitue pas de propergol.

**[D]** Un impact direct neutralise le vaisseau en une fois. Un passage à côté ne produit aucun dégât. Le résolveur utilise le contact physique avec le volume de collision orienté de la cible ; pas de rayon de destruction abstrait, de fragments, d’explosion de proximité ou de dégâts partiels. Tester le déplacement entre deux pas en tenant compte du volume et de l’orientation pour éviter une traversée artificielle, surtout en temps accéléré. Il s’agit d’une règle de jeu, sans simulation de charge réelle ni affirmation d’effets nucléaires.

**[D]** Un missile ayant manqué sa cible reste simulé, y compris en dérive, jusqu’à un impact, la fin de partie ou la frontière fixe du théâtre. À la frontière, il est considéré comme détruit/explosé, définitivement perdu et retiré des calculs ; aucune réapparition ni aucun dégât de zone. Cette règle remplace la proposition antérieure de suppression après une durée de vie arbitraire.

**[D]** La taille limite de carte vaut **10 fois la distance initiale entre les deux vaisseaux**. Elle est calculée à l’initialisation puis reste fixe, indépendante du zoom, de la caméra et de la séparation ultérieure. **[P]** Convention géométrique proposée pour rendre « taille » non ambiguë : théâtre sphérique de diamètre 10 × la distance initiale, donc rayon 5 × cette distance, centré sur le milieu des deux positions initiales. Le facteur 10 est décidé ; l’interprétation en diamètre et le choix sphérique sont des propositions explicites. Une distance initiale nulle est refusée à la validation du scénario. Enregistrer centre, taille et convention géométrique dans la sauvegarde ; rendre la limite visible sur les cartes. Détecter le franchissement entre les pas et retirer le missile une seule fois. Le comportement d’un vaisseau habité à la frontière reste à préciser ; défaut proposé : avertissement sans destruction automatique, la règle de retrait concernant les missiles.

La sortie d’un missile adverse caché ne produit pas d’alerte gratuite. Le missile propre peut être marqué « perdu — limite du théâtre » par sa télémétrie. La fin immédiate sur neutralisation est une règle d’arbitrage globale décrite ci-dessous ; elle n’attend pas une confirmation capteur et ne fournit aucune information tactique avant la fin.

## 7. Temps, simulation et onglet navigateur

**[D]** Temps continu avec trois vitesses : normale, accélérée et très accélérée. **[P]** Multiplicateurs initiaux proposés : ×1, ×5 et ×10. Le rendu ne gouverne ni les forces, ni les capteurs, ni les échéances. Le changement de vitesse augmente le nombre de pas simulés, sans grossir arbitrairement le pas physique.

**[P]** Pas physique initial : 1/60 seconde simulée. Les événements discrets sont ordonnés par date, priorité documentée et ID stable. Fractionner un pas aux épuisements et échéances pertinents, ou employer une méthode équivalente qui n’ajoute pas de poussée ni ne saute un événement. Un grand déplacement doit conserver les tests de collision continus.

**[D]** Retour automatique au temps normal sur nouvelle détection ou alerte critique connue de l’équipage, sans changer le poste actif. Une condition cachée ne peut jamais provoquer une décélération perceptible. **[P]** Les alertes critiques comprennent réserve critique, exposition équipage dangereuse et menace observée ; leur classification précise reste configurable. Aucune reprise automatique de l’ancienne accélération après acquittement.

**[D]** La pause interrompt la session sans possibilité de donner des ordres. Aucune file de commandes en pause, aucun lancement, aucune modification de consigne ou de priorité. **[P]** Inspection des informations déjà connues et aide restent possibles. Les ordres préexistants sont conservés, figés et reprennent avec la simulation ; aucun cycle capteur ni charge d’exposition n’avance. Menu et fin de partie suspendent le temps.

**[P]** Onglet masqué : pause automatique et sauvegarde au prochain point cohérent si le navigateur le permet. Au retour : message « simulation suspendue », reprise explicite à ×1. Pas de rattrapage du temps réel écoulé, pas de progression hors ligne. Un arrêt forcé peut empêcher la dernière sauvegarde ; le dernier point confirmé reste disponible.

Si le navigateur ne tient pas la cadence, réduire l’accélération effective en l’affichant ; ne pas sauter des pas pour rester à l’heure murale. Après un retard supérieur à 2 secondes réelles proposé, suspendre avec message et proposer reprise à ×1. Les durées et délais de gameplay sont toujours exprimés en temps simulé.

## 8. Interface et interactions

### 8.1 Structure commune

**[D/P]** Coupe isométrique stylisée visible au démarrage. Compartiments cliquables nommés, poste courant identifiable, accès direct aux cinq consoles. L’interface est intégrée au premier parcours fonctionnel ; aucune phase MVP « uniquement logs » n’est considérée livrable.

```text
┌ Temps mission | Pause | ×1 ×5 ×10 | Objectif | Sauvegarde ┐
│ Alertes connues : gravité, origine, ancienneté, accès au poste │
├ Vue vaisseau | Pilotage | Détection | Tactique | Ingé. | Vie ─┤
│ Console active                         │ Fiche contact       │
│ commandes + représentation adaptée    │ partagée             │
│ état ordre / limites / motif blocage   │ mesures / estimation │
├ Journal connu récent                  │ Aide contextuelle    ┤
└ Repère, unités et légende explicites                           ┘
```

**[P]** Un clic depuis n’importe quel poste ouvre un autre poste ; la coupe reste accessible par un bouton permanent. Raccourcis proposés : touches 1–5 pour postes, Espace pour pause, Échap pour menu. Les raccourcis sont ignorés pendant une saisie et rappelés dans l’aide. Les commandes continues au clavier cessent au relâchement ou à la perte de focus ; les ordres persistants explicitement engagés restent actifs jusqu’à annulation.

Couleurs doublées de labels/icônes ; contraste lisible, tailles adaptées à une cible initiale de 1280 × 720. Aucun renseignement critique n’est seulement au survol. Les zones 3D affichent axes, échelle, orientation caméra et commandes de recentrage. La navigation combine les trois projections 2D et la vue 3D décrites ci-dessous. Les autres consoles peuvent employer les représentations adaptées à leur fonction, en conservant repères et incertitudes explicites.

### 8.2 Pilotage/navigation

**[D]** Le pilotage initial repose sur le choix d’une orientation (cap du vaisseau) et d’une poussée, avec assistance. La console est une carte instrumentale, sans vue à travers un pare-brise. Elle comporte trois projections orthogonales 2D (dessus, côté, face) et une vue 3D d’ensemble du même espace.

**[D]** Chaque vue représente le vaisseau orienté, une flèche distincte pour son vecteur vitesse, son trajet déjà parcouru en trait plein et sa trajectoire future prévue en pointillés selon la consigne de poussée actuelle. Moteurs coupés et sans autre force, la prévision prolonge le mouvement en ligne droite. Une destination choisie est un repère séparé, jamais une promesse d’arrivée automatique. Les réglages d’orientation et de poussée actualisent la prévision dans les quatre vues.

**[P]** Disposition initiale : quatre panneaux synchronisés, avec agrandissement possible de chacun. Axes monde, origine, échelle et instant de référence communs ; cadrage et légende rendent les correspondances lisibles. Un horizon de prévision configurable est affiché ; le calcul respecte l’assistance, les réserves et les limites matérielles connues du vaisseau. La prévision reste conditionnelle aux consignes maintenues, sans hypothèse de connaissance des manœuvres adverses. Le geste précis de choix de l’orientation reste à tester ; des contrôles par axes et un repère manipulable dans les projections sont proposés.

- **Commandes** : réglage poussée, coupure, attitude cible, maintien, translations RCS, orientation à contre-vitesse, annulation d’ordre.
- **Affichages** : vecteur vitesse distinct de l’axe du vaisseau, vitesse, attitude, accélération/G directionnels actuels et prévus, jauges équipage/structure, propergol, ordre actif et estimateur de freinage approximatif.
- **Retours** : moteurs réellement actifs, saturation RCS, avertissement de dépassement et action pour forcer, manque de propergol/puissance, temps de freinage « non disponible » si non calculable.
- **Aide** : « Tourner ne change pas votre trajectoire ; une poussée change votre vitesse. »

La navigation ne montre que le vaisseau propre et les pistes connues, avec incertitudes. Les distances à une cible sont estimées et identifiées comme telles.

### 8.3 Détection

**[D]** La console reprend trois projections 2D et une vue 3D de l’espace environnant, avec plots sélectionnables et liste de contacts. Elle distingue un mode passif (IR et écoute radar, aucune émission de radar de recherche) et un mode actif (ajout du balayage radar, capteurs passifs pouvant rester en service). Le mode passif ne supprime ni chaleur ni signature de propulsion ; il ne signifie pas invisibilité.

**[D]** Les plots présentent identifiant local, sources d’observation, dernière observation/ancienneté, informations estimées disponibles et confiance. La classification peut rester « inconnu » ou « vaisseau probable » ; sa confiance est distincte de la précision de localisation. Sans distance disponible, représenter une direction incertaine, pas un point arbitraire. Une nouvelle détection, y compris passive, déclenche l’alerte commune depuis n’importe quel poste selon les règles de connaissance et de retour au temps normal.

**[P]** Gris pour le mode passif et rouge pour le mode actif constituent une palette provisoire, toujours accompagnée de libellés et d’icônes. Les gestes de sélection de secteur, l’ouverture du cône de recherche, la disposition des panneaux et le détail de classification seront affinés après essais ; ils ne supposent pas un système complexe d’identification hors périmètre.

- **Commandes** : choix IR/écoute radar passive/radar actif, marche/arrêt, balayage large, secteur, suivi, sélection de piste.
- **Affichages** : couverture, progression du cycle, consommation, observations, cônes/zones d’incertitude, piste récente/extrapolée/perdue.
- **Retours** : cycle sans observation, secteur hors estimation, suivi peu informatif faute de localisation, cycle interrompu par puissance insuffisante.
- **Aide** : aucune mesure n’est garantie ; un contact perdu conserve son historique et peut être recherché dans une zone élargie.

### 8.4 Tactique/armement

**[D]** Console volontairement simple : reprendre la carte et la liste des contacts, sélectionner un contact, lire son incertitude, l’estimation de réussite et le stock, puis lancer un missile par action explicite. Aucun tir automatique du joueur ni gestion complexe de salves dans le MVP. La qualité de piste informe sans bloquer la décision.

**[D]** Les missiles propres sont visibles sur la carte avec leurs trajectoires et un temps estimé avant atteinte de l’objectif. Une liste affiche pour chacun cible assignée, réserve propulsive et état (propulsé, en dérive, perdu). Ils restent des corps soumis au même socle physique que les vaisseaux ; leurs paramètres propres seront réglés ultérieurement. Les missiles adverses ne sont affichés que selon les observations disponibles.

**[D]** La carte symbolise la liaison de données entre le vaisseau et chacun de ses missiles. Elle matérialise la transmission des estimations issues de la détection du porteur, qui permettent au missile de viser ; elle ne représente ni un capteur autonome du missile ni un accès à la position réelle cachée. **[P]** Un trait distinct des trajectoires, accompagné d’une légende, indique cette liaison ; la fiche précise l’ancienneté de la piste transmise. Une liaison disponible n’implique pas une observation récente : après perte de contact, le missile poursuit sur la piste extrapolée conformément aux règles retenues.

**[P]** Le temps avant objectif est explicitement une estimation calculée à partir de l’état connu du missile et de la piste estimée/extrapolée. Il évolue avec les corrections et manœuvres ; ce n’est ni un compte à rebours garanti ni une mesure issue de la position réelle cachée de la cible. Afficher « indéterminé » si les données ne permettent pas d’estimation, et un indicateur d’incertitude lorsque la piste vieillit. Aucune valeur fictive ne doit suggérer un impact assuré.

- **Commandes** : sélection de piste partagée, préparation d’un missile, lancement explicite, abandon d’engagement.
- **Affichages** : stock, qualité/ancienneté de piste, avertissement d’incertitude, missiles actifs, réserves et ordre de chaque missile, résultat connu.
- **Retours** : raison physique précise de tir indisponible ; confirmation visuelle d’un lancement unique ; absence de certitude affichée comme telle.
- **Aide** : la liaison transmet des estimations ; elle ne transforme pas le missile en capteur.

### 8.5 Ingénierie

**[D]** La première interface d’ingénierie montre avant tout trois réserves : carburant, batterie et armement (nombre de missiles restants). Le générateur consomme le carburant pour alimenter le vaisseau ; la batterie joue principalement le rôle de secours. Garder le poste simple, sans tableau de gestion complexe imposé au démarrage.

**[P]** Trois jauges/cartes de synthèse, avec quantités restantes et alertes. Sur la batterie, un libellé « générateur / recharge / secours » permet de comprendre l’alimentation courante. Débits, bilan électrique et commandes de priorités restent accessibles dans un détail secondaire, plutôt que d’encombrer la vue initiale.

- **Commandes** : activation des groupes moteurs/RCS et consommateurs, contrôle simple des équipements et de leurs priorités électriques ; pas de réseau électrique éditable.
- **Affichages** : masse actuelle, propergol restant et débit, production/demande de puissance, batterie et tendance, équipements actifs/inhibés, masse des missiles stockés.
- **Retours** : effets immédiats des coupures sur les ordres ; priorité de fourniture visible ; un ordre inhibé ne reprend que selon une politique affichée.
- **Défaut proposé** : après une coupure manuelle, les ordres propulsifs associés sont annulés pour éviter un redémarrage surprise ; après saturation temporaire, une consigne maintenue reste en attente et porte ce statut.

### 8.6 Support vie

Affichage simple : alimentation, autonomie d’urgence, état nominal/critique, cause et compte à rebours si applicable. Bouton vers ingénierie en cas de problème. Aucun tableau complexe de paramètres non simulés.

### 8.7 Alertes et aide

**[P]** Trois niveaux : information, avertissement, critique. Chaque alerte porte un horodatage de connaissance, une cause compréhensible et une action pertinente. Acquitter masque l’insistance mais ne supprime ni la cause ni le journal. Dédupliquer les alertes persistantes ; éviter une alerte répétée à chaque tick.

Seuils proposés : propergol/batterie bas à 20 %, critiques à 5 % ; zéro déclenche l’arrêt correspondant. Une alerte « menace » exige une observation compatible, pas la simple existence d’un missile ennemi réel. L’aide initiale est courte, consultable à nouveau, et explique inertie, piste, accélération temporelle et changement de poste.

## 9. Partie de démonstration

### 9.1 Duel symétrique décidé

**[D]** Deux vaisseaux identiques disposent des mêmes capteurs, moteurs, capacités, réserves de ressources et missiles. Leur objectif réciproque est de trouver puis neutraliser l’adversaire. Les positions et vecteurs vitesse initiaux sont définis pour chacun ; des conditions comparables n’impliquent pas des coordonnées ni des vecteurs identiques.

**[D]** Le joueur commence déjà en mouvement, avec l’ordre de patrouiller une zone où un ennemi a été signalé, sans localisation précise de celui-ci. L’adversaire commence également dans la zone, sans connaissance gratuite du joueur. Les décisions déterminantes sont où aller, quand manœuvrer, rester passif ou rechercher activement, engager dès localisation exploitable ou poursuivre l’approche et l’observation.

**[P]** Réglages initiaux : quatre missiles par vaisseau, mêmes charges de propergol et batterie, jusqu’à dix corps actifs (deux vaisseaux et huit missiles) et trente-deux pistes par observateur. Étendue totale fixée à dix fois la séparation initiale selon la convention géométrique proposée en section 6 ; durée cible 10–15 minutes réelles avec accélération. Le rayon de placement initial est un paramètre à calibrer avec les signatures et capteurs : ni détection imposée au premier cycle, ni attente passive excessive. Une graine nominale et plusieurs variantes vérifient cette propriété ; aucune portée ou distance n’est une donnée physique validée.

### 9.2 Parcours de référence pour la recette

Le parcours suivant est un scénario reproductible de vérification, pas une séquence imposée au joueur ni un script garantissant sa victoire.

| Phase | Situation possible | Décision testée | Preuve de lisibilité |
| --- | --- | --- | --- |
| Patrouille | Joueur déjà en mouvement, cible non localisée | Choisir route et attitude, pousser puis dériver | Vitesse conservée moteur coupé |
| Signature | Adversaire manœuvre selon ses décisions | Rechercher en IR | Direction sans distance exacte |
| Perte | Adversaire coupe sa propulsion | Lire ancienneté et incertitude | Estimation non corrigée par la vérité cachée |
| Recherche | Piste devenue incertaine | Concentrer secteur ou activer radar | Coût et cycle visibles, réacquisition explicable |
| Engagement | Piste suffisamment localisée | Tirer ou poursuivre observation/approche | Fiche partagée, coût d’opportunité et stock visible |
| Riposte | Adversaire obtient sa propre piste exploitable | Réagir aux seuls indices connus | Aucun avertissement de missile caché |
| Résolution | Un ou plusieurs engagements se résolvent | Observer les contacts tant que le duel continue | Premier camp neutralisé : fin immédiate |

Une variante pédagogique séparée, éventuellement sans tir adverse, est facultative. Elle ne remplace jamais le duel principal. Aucun adversaire ne se téléporte ni ne fournit une observation artificielle pour faire avancer le parcours.

### 9.3 Adversaire minimal mais actif

**[D/P]** L’adversaire cherche et engage avec ses propres observations. Comportements simples proposés : patrouille/dérive, recherche passive large, recherche active après délai sans piste, concentration sur une estimation, engagement selon sa propre estimation de réussite et politique configurable, recherche élargie après perte, manœuvre de repli après menace observée. Les transitions utilisent seulement sa connaissance, ses réserves, le temps et des paramètres publics au diagnostic.

Les capacités et règles sont identiques à celles du joueur ; les choix peuvent différer. Aucune exigence de stratégie optimale ni d’IA avancée. Un calendrier peut déclencher une recherche ou une manœuvre, jamais fournir une localisation cachée ou autoriser un tir omniscient.

### 9.4 Neutralisation et conditions terminales

**[D]** Un impact direct neutralise le vaisseau en une fois. Dès qu’un camp est neutralisé, la partie se termine immédiatement : toute simulation s’arrête, y compris les missiles encore en vol. Aucun tir résiduel n’est résolu après la fin ; aucune fenêtre de clôture ni simulation d’épave n’est nécessaire. Le verdict terminal arbitré annonce le résultat même si l’impact n’était pas observé par les capteurs. Cette exception est limitée à la fin de partie : les consoles et décisions n’accèdent toujours pas aux données cachées pendant le jeu.

- **Victoire** : adversaire neutralisé en premier.
- **Défaite** : joueur neutralisé en premier. L’incapacité équipage par surcharge prolongée reste un échec décidé ; appliquer la même règle à l’adversaire habité. L’épuisement du support vie comme cause d’incapacité reste proposé.
- **Simultanéité exacte [P]** : si les deux camps sont neutralisés au même instant de simulation, déclarer une neutralisation mutuelle. Des impacts à des instants distincts dans un même pas ne sont pas simultanés : le premier termine la partie. Traiter les événements par instant de collision pour ne pas avantager l’ordre des corps.
- **Absence de capacité d’engagement [P]** : un camp sans missiles peut continuer ou abandonner ; aucun réapprovisionnement automatique. Si les deux camps sont sans capacité et sans missile actif, ne pas révéler les stocks cachés par une fin anticipée ; l’échéance publique proposée permet une issue indécise.
- **Échéance publique [P]** : 30 minutes simulées sans neutralisation → objectif non atteint / issue indécise. Ce garde-fou reste ajustable, distinct de la fin immédiate décidée sur neutralisation.
- **Abandon volontaire [P]** : fin distincte, sans prétendre à une neutralisation physique.

À la fin, figer la simulation, afficher motif et chronologie connue, ressources consommées et engagements ; proposer même graine ou retour briefing. Le débrief réaliste ne dévoile pas la chronologie omnisciente ; le mode test peut le faire séparément. Aucun freinage final requis pour gagner le duel ; poussée, dérive et freinage restent couverts par la recette.

## 10. Sauvegarde, erreurs et reproductibilité

**[P]** Sauvegarde locale à un tick cohérent : manuelle, automatique toutes les 30 secondes réelles pendant la partie et lors d’une suspension lorsque possible. Deux emplacements automatiques alternés avec validation pour conserver le précédent si l’écriture échoue. Afficher date réelle, temps mission et résultat de sauvegarde. Pas de serveur ou compte requis.

Sauvegarder état physique, ressources, pistes propres à chaque observateur, observations, ordres, échéances de capteurs, missiles, script, charge d’exposition et état équipage, générateur pseudo-aléatoire, version de schéma et paramètres. Reprise en pause à ×1 ; aucune compensation de durée hors ligne. Une sauvegarde de mode test reste marquée test et ne devient pas une partie réaliste réputée intègre.

Une sauvegarde corrompue/incompatible est refusée avec message et possibilité de charger le précédent emplacement ou recommencer. Aucun effacement silencieux. Un quota de stockage atteint laisse la partie jouable mais indique clairement que la sauvegarde a échoué. Version initiale : aucune migration universelle exigée ; compatibilité annoncée par version.

Le redémarrage réinitialise corps, stocks, pistes, timers, journal et graine. Une nouvelle graine constitue une action distincte. Les paramètres de scénario sont validés au chargement : nombres finis, masses/inerties valides, références existantes, réserves dans leurs capacités, moteurs et objectifs configurés.

Si un état non fini ou une invariant critique apparaît en cours de partie, pause technique, message lisible et export de diagnostic proposé ; ne pas continuer avec des positions invalides. Le journal technique borné conserve les événements et commandes utiles, sans stockage illimité à chaque frame.

## 11. Carte maître et instrumentation

**[D]** Disponible dès le premier jalon simulé, en mode test identifiable par un bandeau permanent. Afficher tous les corps réels, y compris non détectés, et superposer indépendamment les pistes de chaque observateur. Sélection : position/vitesse/attitude réelles, forces/couples, stocks, dernière émission, observations produites ou refusées avec motifs de simulation.

**[P]** Le lancement choisit « partie réaliste » ou « test ». Une partie réaliste n’expose ni raccourci maître ni objet de vérité à ses vues normales. Il ne s’agit pas d’une protection anti-triche face au propriétaire du navigateur, mais d’une séparation des contrats et des parcours du jeu. Basculer une sauvegarde vers test la marque explicitement ; pas de retour prétendument réaliste après consultation.

Le journal interne peut relier ID réel et pistes pour vérifier les erreurs ; le journal joueur ne le peut pas. Export diagnostic : graine, version, paramètres, commandes datées, événements et métriques agrégées. Limiter la taille, signaler une troncature et conserver les informations nécessaires à un scénario court reproductible.

## 12. Exigences et critères d’acceptation

Les identifiants ci-dessous constituent la référence de recette. Les seuils numériques sont proposés et configurables avant gel du MVP ; toute modification doit être documentée et ne doit pas masquer une régression.

| ID | Statut | Exigence | Critère d’acceptation |
| --- | --- | --- | --- |
| UX-01 | D | Coupe et consoles intégrées | Les cinq compartiments/postes ouvrent une console fonctionnelle ; aucune scène intérieure 3D requise |
| UX-02 | D | Persistance interpostes | Après 20 changements de poste, un ordre de poussée et une tâche capteur continuent sans remise à zéro |
| UX-03 | P | Navigation courte | Tout poste accessible en une action depuis tout autre ; retour coupe permanent |
| UX-05 | D/P | Carte de pilotage | Trois projections orthogonales et une vue 3D concordent au même instant ; orientation et vitesse distinctes ; passé plein et prévision pointillée ; coupure sans force donne une projection rectiligne ; destination séparée sans pilote automatique implicite |
| UX-04 | P | Causes visibles | Chaque commande désactivée expose un motif textuel ; toutes alertes critiques ont une action ou explication |
| PHY-01 | D | Inertie linéaire | Sans force pendant 600 s, erreur relative de vitesse ≤ 10⁻⁶ et de déplacement ≤ 10⁻⁴ par rapport à la référence analytique |
| PHY-02 | D | Attitude séparée | Rotation de 180° sans force linéaire : vecteur vitesse inchangé dans la tolérance PHY-01 |
| PHY-03 | D | Forces et couples placés | Bancs symétrique/décentré : signe et axe du couple corrects ; moteur passant par centre de masse sans couple parasite |
| PHY-04 | D | Consommation et masse | Poussée constante : consommation conforme au débit configuré à 0,1 % près ; masse totale égale aux masses et stocks à la tolérance numérique |
| PHY-05 | D | Épuisement | Réservoir presque vide : aucune valeur négative ; aucune poussée après l’instant d’épuisement au-delà d’un pas de tolérance temporelle |
| PHY-07 | D | Surcharge consciente | La jauge indique valeur et direction, avertissement au dépassement du seuil initial 5 G ; le joueur peut forcer au-delà du seuil conventionnel sans dépasser les capacités réelles des moteurs |
| PHY-08 | D/P | Exposition équipage | Avec paramètres de test : exposition courte sans incapacité, exposition prolongée jusqu’à 100 % avec échec ; récupération sous seuil selon règle ; résultat identique à ×1/×10 et pour les deux équipages ; missiles exclus |
| PHY-06 | P | Masse et lancement | Masse perdue par le porteur égale à la masse initiale du missile ; état initial de séparation conforme au modèle documenté |
| RES-01 | D/P | Puissance et énergie | Surplus recharge et déficit décharge dans les limites ; saturation suit les priorités choisies ; batterie vide ne fournit aucune énergie |
| RES-04 | D/P | Générateur à carburant | Consommation de carburant et masse correspondante ; zéro carburant arrête la production ; secours batterie dans ses limites ; scénario nominal principalement alimenté par générateur |
| UX-06 | D/P | Ingénierie initiale | Carburant, batterie et stock missiles lisibles dans la vue principale ; état générateur/secours identifiable ; détails secondaires accessibles |
| RES-03 | D | Réserves communes | Principaux et RCS consomment le même réservoir du vaisseau ; missile consomme uniquement sa propre réserve |
| RES-02 | P | Support vie simple | Perte d’alimentation déclenche décompte ; restauration l’arrête ; zéro produit une unique fin d’échec |
| DET-01 | D | Connaissance imparfaite | Première observation IR seule : distance et vitesse exactes absentes des données et vues normales |
| DET-02 | D | Extrapolation sans vérité | Deux mondes aux observations identiques mais mouvements cachés différents produisent les mêmes pistes et commandes joueur |
| DET-03 | P | Incertitude et recherche | Sans observation, incertitude non décroissante ; nouvelle mesure compatible peut la réduire ; large/secteur ont couvertures et cycles distincts |
| DET-04 | D | Contact partagé | ID local, dates, état et valeurs de piste identiques dans les postes à un même tick |
| DET-05 | P | Signature résiduelle | Coupure propulsion laisse une signature thermique non nulle selon le réglage ; aucune extinction immédiate artificielle |
| DET-07 | D/P | Écoute passive et catalogue | Émission reçue au-dessus du seuil : observation directionnelle ; silence adverse : aucune émission inventée ; un second radar aux paramètres différents fonctionne sans changement du moteur |
| DET-08 | D/P | Gisement et mouvement | Une mesure isolée indique une direction vers contact sans vitesse 3D ; les balayages successifs construisent une estimation de mouvement et son incertitude |
| DET-06 | P | Association honnête | Réacquisition ambiguë conserve le doute ; aucune fusion déterminée par ID réel en mode réaliste |
| ARM-01 | D | Stock et physique missile | Chaque lancement consomme une unité ; un missile réutilise le modèle corps/propulsion et ses propres réserves |
| ARM-02 | D | Absence d’autodirecteur | Missile sans nouvelle estimation ne corrige pas son ordre à partir d’une manœuvre cible cachée |
| ARM-03 | D/P | Perte et épuisement définis | Perte : poursuite estimée/extrapolée ; réacquisition : correction sans vérité cachée ; réserve nulle conserve la dérive ; statut visible |
| ARM-07 | D/P | Console tactique simple | Lancement unitaire explicite ; missiles propres, trajectoires et liaison de données visibles avec légendes distinctes ; cible, réserve, état et temps estimé affichés ; temps indéterminé si données insuffisantes ; aucun missile adverse caché révélé |
| ARM-05 | D/P | Liberté de tir | Pistes directionnelle, perdue et incertaine : tir permis si moyens physiques disponibles ; estimation de réussite sans vérité cachée ; aucune garantie |
| DET-10 | D/P | Console passive/active | Quatre vues cohérentes ; mode passif sans émission radar, mode actif avec balayage ; plots et fiche distinguent source, ancienneté, classification et incertitude ; alerte passive reçue depuis un autre poste |
| DET-09 | D | Contacts automatiques | Observation valide crée/met à jour la connaissance sans validation manuelle ; consignes de zones/priorités persistantes entre postes |
| ARM-04 | D | Fin immédiate | Premier impact neutralisant : verdict terminal et arrêt de tous les corps, sans attendre une mesure capteur ; aucun événement futur de missile résiduel résolu |
| ARM-06 | D/P | Frontière des missiles | Missile en dérive conservé avant frontière ; taille initiale égale à 10 × séparation initiale selon convention déclarée et constante après déplacement ; franchissement continu provoque retrait unique, sans dégât de zone ni retour ; même résultat à ×1/×10 et après sauvegarde |
| TIM-01 | D | Équivalence temporelle | Même graine et commandes aux mêmes ticks à ×1/×10 pendant 600 s : mêmes événements/états discrets, écart position ≤ 0,1 m, vitesse ≤ 0,001 m/s, ressources ≤ 0,01 % de capacité |
| TIM-02 | P | Événements rapides | Un impact entre deux échantillons avec le volume orienté est détecté à ×1 et ×10 ; un passage voisin sans contact ne cause aucun dégât ; aucune double résolution |
| TIM-03 | P | Alertes connues seules | Événement caché isolé : vitesse temporelle inchangée ; nouvelle détection ou alerte critique rendue observable : retour à ×1 sans changer le poste |
| TIM-05 | D | Pause sans ordres | Pendant pause, aucune commande de jeu acceptée ni mise en file ; état et ordres préexistants figés, puis repris sans modification |
| TIM-04 | P | Arrière-plan | Après 60 s réelles masqué, aucune progression au-delà du tick de suspension ; retour en pause sans rattrapage |
| SAV-01 | P | Reprise complète | Sauvegarder/recharger au milieu d’un cycle et d’un engagement : mêmes événements et résultats qu’exécution continue à commandes identiques |
| SAV-02 | P | Erreurs de stockage | Corruption, version inconnue et quota plein produisent un message ; dernier point valide conservé |
| DBG-01 | D | Carte maître | Un ennemi jamais détecté est visible en test, absent des consoles réalistes ; superposition vrai/estimé disponible |
| DBG-02 | D | Adversaire non omniscient | Changement caché du joueur sans nouvelle observation : aucune adaptation réactive de l’adversaire hors calendrier scripté |
| MIS-01 | P | Partie complète | Briefing → partie → succès et chaque branche d’échec → débrief → redémarrage fonctionnent sans rechargement manuel |
| MIS-03 | D | Symétrie des moyens | Les deux définitions de vaisseau et stocks initiaux sont identiques ; positions/vitesses peuvent différer ; aucune piste précise initiale |
| MIS-04 | D | Adversaire actif | Sur une graine de recette, l’adversaire recherche et lance selon sa propre connaissance/politique ; aucune donnée cible cachée ne fournit sa consigne de tir |
| MIS-05 | P | Issues du duel | Tests victoire, défaite, simultanéité exacte, aucun engagement possible et arrêt immédiat des missiles résiduels : une seule issue, indépendante de l’ordre des corps |
| MIS-02 | P | Reproductibilité | Même version, paramètres, graine et commandes donnent même ordre d’événements et mêmes résultats sur un navigateur de référence |
| PERF-01 | P | Budget navigateur | Sur machine de référence documentée, scénario plafond pendant 15 min : rendu médian ≥ 30 FPS, commandes reflétées en ≤ 100 ms hors pause technique |
| HELP-01 | P | Compréhension | Au moins 4 testeurs sur 5 expliquent après la démo pourquoi une piste est incertaine, pourquoi freiner consomme et à quoi servent trois postes |

Pour PHY-01, le dénominateur relatif utilise un plancher de 1 m/s et 1 m ; tester aussi le repos exact. Les comparaisons flottantes ne portent jamais sur une égalité textuelle des coordonnées. La reproductibilité exacte inter-navigateurs n’est pas promise ; les mêmes résultats discrets et les tolérances numériques le sont sur les configurations officiellement retenues.

## 13. Vérification et jouabilité

### 13.1 Stratégie de recette

1. **Bancs physiques ciblés** : inertie, rotation, moteurs symétriques/décentrés, masse variable, stocks presque nuls, séparation missile. Références analytiques là où possibles.
2. **Contrats d’information** : observations angulaires seules, mondes cachés divergents à observations égales, absence d’accès vérité dans estimateur/commandes, adversaire et alertes.
3. **Intégration temporelle** : exécution ×1/×10, changement de poste, onglet masqué, épuisement entre deux ticks, passage rapide, sauvegarde au milieu d’une échéance.
4. **Parcours utilisateur** : démo réussie, tir impossible, perte de piste, réserve vide, panne de sauvegarde et redémarrage. Vérifier texte, unités et motifs UI.
5. **Recette de performance** : préciser ordinateur, système et versions navigateur. Cible proposée : versions stables de Chromium et Firefox disponibles au gel ; valider Safari avant d’en annoncer le support.

Chaque scénario automatisé utilise une graine et des commandes datées en temps simulé. Le rapport conserve paramètres, résultat attendu/observé et première divergence. Tester les frontières et causalités ; éviter des tests qui recopient simplement le calcul implémenté.

### 13.2 Indicateurs de première version aboutie

**[P]** Session observée avec cinq personnes, sans explication orale supplémentaire après le briefing. Mesurer :

- Les objectifs de HELP-01 ; demander une explication avec les mots du joueur.
- Une première manœuvre et un premier changement de poste en moins de 2 minutes réelles.
- Au moins 4 personnes sur 5 retrouvent la fiche du même contact en tactique sans aide.
- Les effets d’une poussée, d’un radar et d’un tir sont visibles dans la seconde réelle, même si leur résultat de simulation prend plus longtemps.
- Aucune attente imposée sans estimation de durée, activité pertinente ou accélération disponible ; viser moins de 30 secondes réelles d’attente passive continue dans le scénario nominal.
- Les échecs sont explicables par les informations connues et le débrief, sans devoir ouvrir la carte maître.

Ces mesures guident l’ajustement de la démo ; elles ne justifient pas d’ajouter campagne, multijoueur ou systèmes exclus.

## 14. Séquence conseillée pour la future implémentation

1. **Socle vertical visible** : chargement scénario et validation, corps inertiel, coupe, pilotage, bandeau temps et carte maître. Vérifier PHY-01/02 et DBG-01.
2. **Vaisseau modulaire minimal** : moteurs placés, RCS, propergol/masse, énergie et ingénierie ; assistance retenue. Vérifier PHY-03 à PHY-06 et RES-01.
3. **Connaissance et détection** : observations IR/écoute passive/radar actif, pistes, incertitude, fiche partagée, séparation de l’adversaire. Vérifier DET et DBG-02 avant armement.
4. **Engagement et mission** : missiles, impact direct unique, fin immédiate, briefing et toutes fins. Vérifier ARM et MIS.
5. **Fiabilisation livrable** : sauvegarde/reprise, arrière-plan, accélération, aide, lisibilité, erreurs, performance et playtests.

L’interface accompagne chaque jalon. Aucun jalon n’autorise de remplacer durablement une console prévue par des informations de debug. La livraison MVP exige le parcours entier et les critères applicables ; une réussite de tests physiques seuls ne suffit pas.

## 15. Arbitrages ouverts et recommandations

| Arbitrage | Recommandation par défaut | À réexaminer si… |
| --- | --- | --- |
| Détail de l’assistance retenue | Maintien d’attitude et orientation contre-vitesse ; diagnostic moteur réservé au test | Les tests montrent une assistance opaque |
| Multiplicateurs des trois vitesses | ×1, ×5 et ×10 proposés ; pause sans ordres décidée | La recherche présente trop d’attente ou de précipitation |
| Charge équipage | Seuil initial 5 G et échec après dépassement prolongé décidés ; accumulation/récupération et modulation directionnelle à régler | Les tests révèlent une alerte trop tardive ou une récupération exploitable |
| Surcharge structurelle | Avertissement distinct ; dommages non décidés | Un enjeu structurel est retenu |
| Réglages des trois capteurs retenus | IR et écoute passive directionnels ; radar actif direction/distance ; mouvement par mesures successives | La recherche manque de lisibilité ou de choix intéressants |
| Politique adverse de recherche/tir | Recherche et tir obligatoires ; transitions simples fondées sur ses pistes | Les playtests montrent une attente ou une agressivité excessive |
| Géométrie du théâtre | Taille 10 × séparation initiale décidée ; sphère de ce diamètre centrée au milieu initial proposée | La limite interrompt trop tôt les engagements ou conserve trop longtemps des corps inutiles |
| Gestes et cadrage navigation | Trois projections 2D et vue 3D décidées ; manipulation de l’orientation, zoom et horizon de prévision à tester | La lisibilité ou la précision de commande est insuffisante |
| Réglages numériques | Fichier de paramètres versionné, valeurs provisoires ci-dessus | Les scénarios de recette ou playtests échouent |
| Stack et stockage local | Modules séparant simulation/connaissance/UI ; stockage transactionnel navigateur | Un prototype révèle un coût ou une incompatibilité concret |

Avant le début de l’implémentation, consigner les défauts effectivement adoptés dans un court registre de décisions daté. L’absence de retour utilisateur ne doit pas être décrite comme une validation. Les arbitrages ci-dessus n’empêchent pas de préparer un prototype conforme aux recommandations, mais tout changement de périmètre majeur exige une décision explicite.

## 16. Définition de terminé

Le MVP est terminé quand une partie complète est jouable dans le navigateur cible, que les cinq postes ont un rôle lisible, que les ordres et réserves persistent correctement, que la détection reste imparfaite sans fuite de vérité, que les missiles respectent cette connaissance, et que les résultats conduisent à un débrief puis à une reprise ou un redémarrage fiable.

Le dossier de livraison devra comprendre : application, scénario et réglages versionnés, commande/documentation de lancement, courte aide utilisateur, rapport de recette avec machine de référence, limites connues et procédure d’accès au mode test. Le présent document reste la spécification préparatoire ; aucun jeu n’est développé dans le cadre de sa rédaction.
