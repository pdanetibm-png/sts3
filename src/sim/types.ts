export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export type Affiliation = "joueur" | "allie" | "adversaire";

export interface StructureDef {
  /** Masse de la structure seule, hors propergol (le propergol est compté via le réservoir). */
  dryMassKg: number;
  /** Inertie diagonale approximée à pleine réserve, repère corps, en kg·m². */
  momentOfInertiaKgM2: Vec3Tuple;
  /** Sphère englobante pour la résolution de collision (ARM-04) — approximation du volume orienté. */
  collisionRadiusMeters: number;
}

export type ThrusterKind = "principal" | "rcs";

export interface ThrusterDef {
  id: string;
  kind: ThrusterKind;
  /** Position en repère corps, relative au centre de masse (supposé à l'origine structure). */
  localPosition: Vec3Tuple;
  /** Axe de poussée en repère corps (normalisé) — direction de la force appliquée au vaisseau. */
  localAxis: Vec3Tuple;
  maxThrustNewtons: number;
  specificImpulseSeconds: number;
  /** Moteur principal : fraction de la puissance du jet rayonnée dans les bandes IR usuelles (0 si absent). */
  plumeRadiantFraction?: number;
  /** Fraction de la puissance du jet absorbée par la coque (chaleur à évacuer). */
  wasteHeatFraction?: number;
}

export interface ReservoirDef {
  capacityKg: number;
  quantityKg: number;
}

export interface GeneratorDef {
  maxPowerWatts: number;
  /** kg de propergol consommés par seconde lorsque le générateur produit à pleine puissance. */
  fuelConsumptionKgPerSecondAtMaxPower: number;
  /** Rendement électrique : le reste de l'énergie produite est de la chaleur à évacuer. */
  efficiency: number;
}

export interface BatteryDef {
  capacityWattSeconds: number;
  maxChargeRateWatts: number;
  maxDischargeRateWatts: number;
  currentChargeWattSeconds: number;
}

export type ConsumerPriorityGroup = "vie" | "propulsion_auxiliaire" | "capteurs" | "services";

export interface ConsumerDef {
  id: string;
  label: string;
  nominalPowerWatts: number;
  priorityGroup: ConsumerPriorityGroup;
}

export type SensorMode = "ir_passive" | "radar_passive" | "radar_active";

/**
 * Capteur défini par son matériel (ARCHITECTURE_SIMULATION.md §3-4, CONCEPTION_DETECTION.md).
 * Les champs utiles dépendent du mode ; la validation du scénario exige ceux du mode choisi.
 */
export interface SensorDef {
  id: string;
  mode: SensorMode;
  /** Radar actif : puissance moyenne émise. Autres modes : consommation électrique. */
  powerWatts: number;
  /**
   * Consommation électrique en marche (W), prélevée sur le réseau de bord et délestable
   * (section 4.3). Absente : `powerWatts` — exact pour un capteur passif, rendement de 1 supposé
   * pour un radar (fiche à compléter).
   */
  electricalPowerWatts?: number;
  /** Durée d'un balayage de tout le ciel (secteur ouvert au maximum). */
  cycleSeconds: number;
  /** Revisite la plus rapide possible d'un secteur : en dessous, le temps gagné allonge l'intégration. */
  minFrameSeconds: number;

  /** IR passif : éclairement donnant 50 % de détection pour 1 s d'intégration (W/m²). */
  noiseEquivalentIrradianceWm2?: number;
  /** IR passif : champ de vue instantané du détecteur (sr). */
  fieldOfViewSr?: number;
  /** IR passif : angle d'un pixel — fixe la précision du gisement (rad). */
  pixelAngleRad?: number;
  /** IR passif : part du rayonnement d'une coque tiède tombant dans la bande du capteur. */
  bandFraction?: number;

  /** Radar actif : surface effective d'antenne (m²). */
  antennaAreaM2?: number;
  wavelengthMeters?: number;
  noiseTemperatureKelvin?: number;
  /** Pertes système (facteur ≥ 1). */
  lossFactor?: number;
  /** Rapport signal/bruit correspondant à 50 % de détection. */
  requiredSnr?: number;
  rangeResolutionMeters?: number;
  /** Gain hors faisceau rapporté au gain du faisceau principal (lobes secondaires). */
  sideLobeLevel?: number;

  /** Écoute : flux donnant 50 % de détection (W/m²). */
  sensitivityWm2?: number;
  /** Écoute : précision de gisement au seuil (rad). */
  bearingAccuracyRad?: number;
}

/** Bilan thermique de la coque (CONCEPTION_DETECTION.md §2). */
export interface ThermalDef {
  surfaceAreaM2: number;
  emissivity: number;
  heatCapacityJoulesPerKelvin: number;
  /** Chaleur dégagée en permanence hors réacteur et moteur (équipage, électronique), en W. */
  baselineHeatWatts: number;
}

/** Surface radar selon l'angle de vue, en m². */
export interface RadarSignatureDef {
  crossSectionFrontM2: number;
  crossSectionSideM2: number;
}

export interface SignatureDef {
  thermal: ThermalDef;
  radar: RadarSignatureDef;
}

/**
 * Doctrine de combat de l'IA (données, pas constantes du moteur). Les distances se déduisent
 * des performances du matériel et de ces choix.
 */
export interface DoctrineDef {
  /** Délai sans position connue avant de passer au radar actif. */
  searchDelaySeconds: number;
  fireCooldownSeconds: number;
  /** Demi-angle du secteur radar concentré sur une piste. */
  sectorHalfAngleRad: number;
  /** Fraction de poussée d'approche. */
  approachThrottle: number;
  /** Temps de vol maximal accepté pour un tir : fixe la portée d'engagement avec le missile embarqué. */
  maxMissileFlightSeconds: number;
  /** Tolérance sur la vitesse de rapprochement visée avant de pousser ou de freiner (m/s). */
  brakeClosingSpeedMps: number;
  /** Vitesse de rapprochement maximale recherchée en approche (m/s). */
  cruiseSpeedMps: number;
  /**
   * Part du réservoir jamais dépensée pour se positionner : elle reste disponible pour le
   * générateur (support vie) et pour manœuvrer face à une menace.
   */
  propellantReserveFraction: number;
  /** Avance maximale d'un ailier sur son chef de formation vers la cible (m) : il ne part pas seul devant. */
  wingmanMaxLeadMeters: number;
  /**
   * Leurres (CONCEPTION_LEURRES.md §7) — champs optionnels : sans eux, l'IA ne largue jamais.
   * Temps d'arrivée estimé d'une menace (piste « missile probable ») en deçà duquel on largue.
   */
  decoyThreatSeconds?: number;
  /** Durée de la manœuvre « prendre un vecteur » (retournement compris) avant le largage, si le vaisseau ne poussait pas. */
  decoyVectorSeconds?: number;
  /** Dérive moteurs coupés et radar éteint après un largage. */
  decoyDriftSeconds?: number;
  /** Délai minimal entre deux largages. */
  decoyCooldownSeconds?: number;
  /**
   * Défense terminale — optionnel : sans lui, le radar ne quitte jamais la piste visée pour une
   * menace. Temps d'arrivée estimé d'un missile en deçà duquel le radar le suit, même pendant la
   * dérive d'une tactique de leurre : sans piste fraîche, la PDC n'a rien à viser.
   */
  terminalDefenseSeconds?: number;
  /**
   * Discipline d'émission — optionnel : sans lui, le radar émet dès qu'une piste est à viser.
   * Avec lui, le radar se tait quand il ne peut rien mesurer (piste connue hors de sa portée) et,
   * sur une piste au gisement seul ou en recherche, n'émet que par brèves impulsions (un balayage)
   * espacées de cet intervalle (s). Émettre en continu trahit le vaisseau à l'écoute adverse.
   */
  radarBurstIntervalSeconds?: number;
}

/**
 * Hypothèses publiques de l'estimation (connaissance) : ce que tout observateur suppose d'un
 * contact, jamais la vérité.
 */
export interface EstimationAssumptions {
  /** Âge maximal d'une piste « récente ». */
  trackRecentSeconds: number;
  /** Au-delà, la piste est « perdue ». */
  trackLostSeconds: number;
  /** Accélération que l'on suppose possible pour un contact non observé (G) : fait grossir l'incertitude. */
  targetManeuverG: number;
  /** Même hypothèse pour un contact classé « missile probable » (G). */
  missileManeuverG: number;
  /** Vitesse relative maximale supposée d'un contact dont le mouvement n'est pas encore estimé (m/s). */
  unknownSpeedMps: number;
  /** Fenêtre de régression des mesures de distance pour estimer la vitesse. */
  velocityWindowSeconds: number;
  /** Dérive angulaire supposée d'un contact sans distance connue (rad/s) : ce que la vitesse angulaire estimée n'explique pas. */
  bearingDriftRadPerSecond: number;
  /**
   * Vitesse angulaire maximale supposée d'un contact dont la rotation n'est pas encore estimée
   * (une seule mesure) : élargit la fenêtre d'association de sa deuxième mesure. Optionnelle
   * (anciens scénarios) : défaut dans knowledge/fusion.ts.
   */
  unknownBearingRateRadPerSecond?: number;
  /**
   * Rapport supposé entre la plus grande et la plus petite surface radar d'un même objet selon
   * l'angle sous lequel on le voit : deux échos plus différents que cela (bruit compris) ne
   * viennent pas du même objet.
   */
  aspectCrossSectionSpread: number;
  /**
   * Distance passive (triangulation, manœuvre) retenue seulement si son incertitude le long de la
   * ligne de visée reste sous cette fraction de la distance. Optionnelle : défaut dans
   * knowledge/passiveRanging.ts.
   */
  passiveRangingMaxRelativeUncertainty?: number;
  /**
   * Manœuvre de la cible tolérée par la distance passive pendant sa fenêtre (G) : hypothèse « cap et
   * vitesse constants » de la méthode. Optionnelle : défaut dans knowledge/passiveRanging.ts.
   */
  passiveRangingManeuverG?: number;
}

/** Paramètres physiques du modèle de missile embarqué par ce vaisseau (section 6 — même socle dynamique). */
export interface MissileDef {
  /** Désignation lisible (catalogue). */
  name?: string;
  structureMassKg: number;
  reservoir: ReservoirDef;
  maxThrustNewtons: number;
  specificImpulseSeconds: number;
  /** Fraction de la puissance du jet rayonnée en IR (un moteur chimique rayonne beaucoup). */
  plumeRadiantFraction: number;
  /** Fraction de la puissance du jet qui chauffe la cellule. */
  wasteHeatFraction: number;
  signature: SignatureDef;
  /** Surface physique présentée de face et de profil (m²) — cible des obus de PDC. Absente : intouchable. */
  presentedAreaFrontM2?: number;
  presentedAreaSideM2?: number;
}

/** Générateur de panache IR d'un leurre : charge qui complète son jet pour imiter celui du vaisseau. */
export interface IrEmitterDef {
  /** Puissance rayonnée maximale, répartie sur le demi-espace arrière comme un jet (W). */
  maxRadiantPowerWatts: number;
  chargeKg: number;
  /** Énergie rayonnée dans les bandes IR par kg de charge (J/kg). */
  radiantEnergyJoulesPerKg: number;
}

/**
 * Leurre (CONCEPTION_LEURRES.md) : petit véhicule sans charge ni guidage qui prolonge la poussée
 * du vaisseau au moment du largage. Ses capacités, donc sa crédibilité, viennent de cette fiche.
 */
export interface DecoyDef {
  /** Désignation lisible (catalogue). */
  name?: string;
  structureMassKg: number;
  reservoir: ReservoirDef;
  maxThrustNewtons: number;
  specificImpulseSeconds: number;
  plumeRadiantFraction: number;
  wasteHeatFraction: number;
  collisionRadiusMeters: number;
  signature: SignatureDef;
  irEmitter?: IrEmitterDef;
  /** Surface physique présentée de face et de profil (m²) — cible des obus de PDC. Absente : intouchable. */
  presentedAreaFrontM2?: number;
  presentedAreaSideM2?: number;
}

/**
 * Tourelle de défense rapprochée (CONCEPTION_PDC.md) : obus à haute vitesse tirés vers le point de
 * rencontre prévu par la piste du bord.
 */
export interface PdcDef {
  /** Désignation lisible (catalogue). */
  name?: string;
  muzzleVelocityMps: number;
  rateOfFireRoundsPerSecond: number;
  /** Écart-type angulaire de la dispersion des obus (rad). */
  dispersionRad: number;
  /** Distance d'autodestruction des obus — fixe l'enveloppe d'engagement. */
  maxRangeMeters: number;
  magazineRounds: number;
  /** Temps de pointage avant le premier obus sur une nouvelle cible. */
  retargetSeconds: number;
}

/** Tourelle montée sur un vaisseau. */
export interface PdcMountDef {
  id: string;
  pdc: PdcDef;
}

/** Tolérance de l'équipage aux accélérations (sièges anti-G, entraînement) — section 4.4, PHY-08. */
export interface CrewDef {
  /** Accélération (en G) au-delà de laquelle l'exposition s'accumule. */
  gThreshold: number;
  /** Fraction d'exposition gagnée par seconde et par G au-dessus du seuil (en rapport au seuil). */
  exposureAccumulationPerSecond: number;
  /** Fraction d'exposition récupérée par seconde sous le seuil. */
  exposureRecoveryPerSecond: number;
}

export interface ShipInitialState {
  id: string;
  name: string;
  affiliation: Affiliation;
  /** Assemblage du catalogue dont ce vaisseau est issu (affichage uniquement). */
  designName?: string;
  crew: CrewDef;
  doctrine: DoctrineDef;
  structure: StructureDef;
  thrusters: ThrusterDef[];
  reservoir: ReservoirDef;
  generator: GeneratorDef;
  battery: BatteryDef;
  consumers: ConsumerDef[];
  sensors: SensorDef[];
  signature: SignatureDef;
  missileCount: number;
  missile: MissileDef;
  /** Leurres en soute (optionnel : aucun si absent). */
  decoyCount?: number;
  decoy?: DecoyDef;
  /** Tourelles de défense rapprochée (optionnel : aucune si absent). */
  pdcs?: PdcMountDef[];
  position: Vec3Tuple;
  velocity: Vec3Tuple;
  /** Quaternion (x, y, z, w), normalisé. */
  attitude: QuatTuple;
  angularVelocity: Vec3Tuple;
}

export interface ScenarioDefinition {
  version: string;
  seed: number;
  objective: string;
  /** Durée simulée au-delà de laquelle la mission est déclarée indécise (échéance publique). Défaut : 30 min. */
  deadlineSeconds?: number;
  /** Hypothèses publiques d'estimation ; défaut : celles de l'échelle du duel du MVP. */
  assumptions?: EstimationAssumptions;
  ships: ShipInitialState[];
}
