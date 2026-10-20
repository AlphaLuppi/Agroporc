/**
 * Import d'images depuis le navigateur (photo de profil IA, gifs fétiches, photo d'un plat) :
 * redimensionnement + recompression avant envoi pour que les photos de téléphone
 * (souvent 5-10 Mo) passent sous la limite serveur de 3 Mo. Les GIF sont envoyés tels quels
 * (les redessiner sur un canvas tuerait l'animation).
 */

export const TAILLE_MAX_UPLOAD = 3 * 1024 * 1024;
export const TYPES_ACCEPTES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Dimensions après réduction pour que le plus grand côté tienne dans `max` (jamais d'agrandissement). */
export function dimensionsReduites(largeur: number, hauteur: number, max: number): { largeur: number; hauteur: number } {
  const plusGrand = Math.max(largeur, hauteur);
  if (plusGrand <= max || plusGrand === 0) return { largeur, hauteur };
  const ratio = max / plusGrand;
  return { largeur: Math.max(1, Math.round(largeur * ratio)), hauteur: Math.max(1, Math.round(hauteur * ratio)) };
}

/** Message d'erreur si le fichier ne peut pas être envoyé, sinon null. */
export function erreurFichier(type: string, taille: number): string | null {
  if (!type.startsWith("image/")) return "Ce fichier n'est pas une image";
  if (type === "image/gif" && taille > TAILLE_MAX_UPLOAD) return "GIF trop lourd (max 3 Mo)";
  return null;
}

/** Première image d'un presse-papier ou d'un glisser-déposer. */
export function imageDuTransfert(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  for (const f of Array.from(dt.files)) if (f.type.startsWith("image/")) return f;
  for (const item of Array.from(dt.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

function versBlob(canvas: HTMLCanvasElement, type: string, qualite: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, qualite));
}

/**
 * Réduit l'image à `max` px sur le plus grand côté et la recompresse (WebP, ou JPEG si le
 * navigateur ne sait pas encoder le WebP). Garde l'original s'il est déjà léger et petit.
 */
export async function preparerImage(fichier: File, max = 1600): Promise<File> {
  const erreur = erreurFichier(fichier.type, fichier.size);
  if (erreur) throw new Error(erreur);
  if (fichier.type === "image/gif") return fichier;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(fichier);
  } catch {
    throw new Error("Image illisible (format non supporté ?)");
  }
  const { largeur, hauteur } = dimensionsReduites(bitmap.width, bitmap.height, max);
  const dejaOk =
    TYPES_ACCEPTES.includes(fichier.type) &&
    largeur === bitmap.width &&
    fichier.size <= 500 * 1024;
  if (dejaOk) {
    bitmap.close();
    return fichier;
  }

  const canvas = document.createElement("canvas");
  canvas.width = largeur;
  canvas.height = hauteur;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Compression impossible sur ce navigateur");
  ctx.drawImage(bitmap, 0, 0, largeur, hauteur);
  bitmap.close();

  let blob = await versBlob(canvas, "image/webp", 0.85);
  if (!blob || blob.type !== "image/webp") {
    // Pas d'encodeur WebP (vieux Safari) : JPEG sur fond blanc (pas de transparence en JPEG).
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, largeur, hauteur);
    blob = await versBlob(canvas, "image/jpeg", 0.85);
  }
  if (!blob) throw new Error("Compression impossible sur ce navigateur");
  if (TYPES_ACCEPTES.includes(fichier.type) && blob.size >= fichier.size && fichier.size <= TAILLE_MAX_UPLOAD) {
    return fichier;
  }
  if (blob.size > TAILLE_MAX_UPLOAD) throw new Error("Image trop lourde même après compression");

  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const base = fichier.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${base}.${ext}`, { type: blob.type });
}

/** Compresse puis envoie l'image sur `/api/images` ; renvoie l'URL à utiliser (`/api/images/12.webp`). */
export async function importerImage(fichier: File, max = 1600): Promise<string> {
  const pret = await preparerImage(fichier, max);
  const formData = new FormData();
  formData.append("file", pret);
  const res = await fetch("/api/images", { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.url !== "string") throw new Error(data.error || "Erreur lors de l'envoi");
  return data.url;
}
