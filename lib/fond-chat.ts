/**
 * Easter egg « cat » (pur, testé par lib/fond-chat.test.ts) : app/components/FondChatEasterEgg.tsx
 * remplace le fond du site par le gif du chat « shake my hand » le temps d'UNE lecture, puis rend
 * le fond du thème. Un gif ne signale pas sa fin : on lit la durée dans ses octets (somme des
 * délais des images), avec une durée par défaut si le fichier n'a pas pu être lu.
 */

export const CODE_CHAT = "cat";

export const GIF_CHAT_URL = "https://media1.tenor.com/m/0Kr4YkG5ZdgAAAAd/shake-my-hand-shake-hand.gif";

/** Durée d'une lecture quand le gif n'a pas pu être lu (CORS) : la vidéo fait 205 images à 30 i/s. */
export const DUREE_CHAT_DEFAUT_MS = 6850;

/** Garde-fou : un gif mal lu ne laisse jamais le fond remplacé plus longtemps. */
export const DUREE_CHAT_MAX_MS = 30_000;

/**
 * Durée d'une lecture d'un gif (ms) : somme des délais des Graphic Control Extensions. Comme les
 * navigateurs, un délai de 0 ou 1 centième compte pour 10 centièmes. `null` si ce n'est pas un gif
 * lisible ou s'il n'a aucune image.
 */
export function dureeGif(octets: Uint8Array): number | null {
  const o = octets;
  if (o.length < 13) return null;
  const entete = String.fromCharCode(...o.subarray(0, 6));
  if (entete !== "GIF87a" && entete !== "GIF89a") return null;
  let i = 13;
  if (o[10] & 0x80) i += 3 * (1 << ((o[10] & 0x07) + 1)); // table de couleurs globale
  // Saute une suite de sous-blocs (taille, données…) jusqu'au bloc vide ; -1 si tronquée.
  const sauterSousBlocs = (j: number) => {
    while (j < o.length && o[j] !== 0) j += o[j] + 1;
    return j < o.length ? j + 1 : -1;
  };
  let delaiCourant = 0;
  let total = 0;
  let images = 0;
  while (i < o.length) {
    const bloc = o[i];
    if (bloc === 0x3b) break; // fin du fichier
    if (bloc === 0x21) {
      if (i + 1 >= o.length) break;
      if (o[i + 1] === 0xf9 && i + 6 < o.length) delaiCourant = o[i + 4] | (o[i + 5] << 8);
      i = sauterSousBlocs(i + 2);
    } else if (bloc === 0x2c) {
      if (i + 10 >= o.length) break;
      const paquet = o[i + 9];
      i += 10;
      if (paquet & 0x80) i += 3 * (1 << ((paquet & 0x07) + 1)); // table de couleurs locale
      i = sauterSousBlocs(i + 1); // + 1 : taille minimale du code LZW
      total += (delaiCourant <= 1 ? 10 : delaiCourant) * 10;
      images++;
      delaiCourant = 0;
    } else {
      return null;
    }
    if (i < 0) break; // tronqué : on garde les images complètes déjà comptées
  }
  return images > 0 ? total : null;
}

/** Durée retenue pour une lecture : celle du gif si elle est plausible, sinon la durée par défaut. */
export function dureeLecture(duree: number | null): number {
  if (duree == null || !(duree > 0)) return DUREE_CHAT_DEFAUT_MS;
  return Math.min(duree, DUREE_CHAT_MAX_MS);
}
