"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { imageDuTransfert, importerImage } from "@/lib/image-upload";

/**
 * Import d'une image depuis l'appareil : compression + envoi sur `/api/images`, puis `onImporte(url)`.
 * `importer` sert aussi aux zones qui acceptent le collage (Ctrl+V) ou le glisser-déposer.
 */
export function useImportImage(onImporte: (url: string) => void, max = 1600) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");

  async function importer(fichier: File | null) {
    if (!fichier || enCours) return;
    setEnCours(true);
    setErreur("");
    try {
      onImporte(await importerImage(fichier, max));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur lors de l'envoi");
    } finally {
      setEnCours(false);
    }
  }

  /** Props à étaler sur un élément pour qu'il accepte le collage et le glisser-déposer d'une image. */
  const zone = {
    onPaste: (e: React.ClipboardEvent) => {
      const f = imageDuTransfert(e.clipboardData);
      if (f) {
        e.preventDefault();
        importer(f);
      }
    },
    onDragOver: (e: React.DragEvent) => {
      if (Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      const f = imageDuTransfert(e.dataTransfer);
      if (f) {
        e.preventDefault();
        importer(f);
      }
    },
  };

  return { importer, enCours, erreur, zone };
}

/** Bouton « Importer une photo » (ouvre la galerie / l'appareil photo sur mobile). */
export function BoutonImportImage({
  importer,
  enCours,
  libelle = "Importer une photo",
}: {
  importer: (f: File | null) => void;
  enCours: boolean;
  libelle?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={enCours}
        className="shrink-0"
      >
        {enCours ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
        {enCours ? "Envoi…" : libelle}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          importer(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
    </>
  );
}
