/**
 * Adresse d'un client WebSocket (PUR, utilisé par `serveur-fps/src/index.ts` pour plafonner les connexions par IP). Derrière Traefik
 * (aucun port publié), le DERNIER élément de `x-forwarded-for` est celui que le proxy a ajouté : les précédents peuvent être forgés par le
 * client et ne servent pas. Sans en-tête : l'adresse de la socket.
 */
export function ipClient(entete: string | string[] | undefined, adresse: string | undefined): string {
  const brut = Array.isArray(entete) ? entete.join(",") : entete;
  const dernier = brut?.split(",").map((x) => x.trim()).filter(Boolean).pop();
  return dernier || adresse || "inconnue";
}
