"use server";

import { getAllPhotos, addPhoto, deletePhoto } from "@/lib/db";
import type { Photo } from "@/lib/db";

const VALID_SLUGS = new Set(["bistrot_trefle", "pause_gourmande", "truck_muche"]);
const VALID_TYPES: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};
const MAX_SIZE = 3 * 1024 * 1024;

export async function listPhotos(): Promise<Photo[]> {
  return getAllPhotos();
}

export async function uploadPhotoAction(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const file = formData.get("file");
  const slug = formData.get("slug");

  if (!file || !(file instanceof File)) {
    return { ok: false, error: "Fichier manquant" };
  }
  if (typeof slug !== "string" || !VALID_SLUGS.has(slug)) {
    return { ok: false, error: "Restaurant invalide" };
  }
  const contentType = VALID_TYPES[file.type];
  if (!contentType) {
    return { ok: false, error: "Format non supporté (JPG, PNG, WEBP, GIF)" };
  }
  if (file.size > MAX_SIZE) {
    return { ok: false, error: "Fichier trop lourd (max 3 Mo)" };
  }

  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const filename = file.name.slice(0, 255) || `photo_${Date.now()}`;

  await addPhoto(slug, filename, contentType, base64);
  return { ok: true };
}

export async function deletePhotoAction(
  id: number
): Promise<{ ok: boolean; error?: string }> {
  const deleted = await deletePhoto(id);
  if (!deleted) return { ok: false, error: "Photo introuvable" };
  return { ok: true };
}
