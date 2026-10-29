/**
 * Données de la scène 3D d'Agroparc (public/agroparc/scene.json).
 * Coordonnées locales en mètres, centrées sur `center` (lon, lat) :
 * x vers l'est, z vers le sud (three.js : y vers le haut). 1 unité = 1 m.
 * Bâtiments et hauteurs : IGN BD TOPO. Voirie, parkings, arbres : OpenStreetMap.
 */
export type Vec2 = [number, number];

export interface Building {
  /** hauteur en mètres */
  h: number;
  /** emprise au sol (anneau extérieur, non fermé) */
  r: Vec2[];
  /** centroïde */
  c: Vec2;
  holes?: Vec2[][];
  /**
   * Pièce synthétique de la carte zombies (jamais dans `scene.json`) : porte payante, barricade, « champ » passe-tigres (bloque les
   * joueurs, laisse passer tigres, balles et regards) ou mur ajouté. Absent = bâtiment ordinaire.
   */
  type?: BatimentType;
}

/**
 * v7 (carte « Service de midi ») : `fenetre` = fenêtre ou passage barricadé de planches (passe-tigres comme un champ), `coque` = mur d'un
 * bâtiment creusé, `cloison` = mur intérieur, `meuble` = mobilier bas (collision à sa vraie hauteur), `creux` = bâtiment creusé (ni collision
 * ni décor : ses murs sont des `coque`). Ces cinq types sont dessinés par le rendu des intérieurs, pas par le décor.
 */
export type BatimentType = "porte" | "barricade" | "champ" | "mur" | "fenetre" | "coque" | "cloison" | "meuble" | "creux";

/** M : voie principale, R : résidentielle, S : desserte/service, F : piéton */
export type RoadClass = "M" | "R" | "S" | "F";

export interface Road {
  c: RoadClass;
  p: Vec2[];
}

/** Polyligne parcourue par les voitures */
export interface Route {
  p: Vec2[];
  oneway: boolean;
}

export type PoiType = "home" | "resto" | "truck" | "shop";

export interface Poi {
  id: string;
  /** Doit correspondre au champ `restaurant` des plats de l'API pour les restos */
  name: string;
  type: PoiType;
  lon: number;
  lat: number;
  addr: string;
  x: number;
  z: number;
  /** index du bâtiment dans `buildings` */
  b: number;
  /** hauteur de ce bâtiment */
  bh: number;
}

export interface SceneData {
  center: Vec2;
  buildings: Building[];
  roads: Road[];
  routes: Route[];
  trees: Vec2[];
  parkings: Vec2[][];
  water: Vec2[][];
  wlines: Vec2[][];
  pois: Poi[];
  /** voie d'arrivée du food truck */
  truckRoad: Vec2[];
  /** voies principales (classe M) parcourues par les bus */
  busRoutes: Route[];
  /** arrêts de bus OSM (highway=bus_stop) */
  busStops: Vec2[];
  /** point visé par la caméra au repos */
  focus: Vec2;
  /**
   * Marque de la scène d'un mode qui a ses propres pièces synthétiques (jamais dans `scene.json`) : "zombies" ou "br" (Battle Royale, v8).
   * Absent = scène de l'arène. `estSceneZombies` (minimap.ts) reste faux pour "br".
   */
  modeCarte?: "zombies" | "br";
}
