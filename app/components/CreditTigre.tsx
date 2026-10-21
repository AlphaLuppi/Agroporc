/**
 * Crédit du modèle 3D du tigre (licence CC BY 4.0 : auteur, lien, licence et mention des
 * modifications obligatoires tant que le modèle est affiché). Sans état, rendu côté serveur dans
 * le pied de page ; visible seulement dans le thème Tigre (`.pdj-credit-tigre`, app/globals.css).
 */
export const CREDIT_TIGRE = {
  titre: "Stylized Bengal Tiger",
  modele: "https://sketchfab.com/3d-models/stylized-bengal-tiger-with-4-animations-d87e750f18aa416dbccdd5ca7b81f751",
  auteur: "Jungle Jim",
  profil: "https://sketchfab.com/jungle_jim",
  licence: "CC BY 4.0",
  lienLicence: "https://creativecommons.org/licenses/by/4.0/deed.fr",
} as const;

export function CreditTigre() {
  const c = CREDIT_TIGRE;
  return (
    <p className="pdj-credit-tigre">
      Tigre 3D&nbsp;: «&nbsp;<a href={c.modele} target="_blank" rel="noopener noreferrer">{c.titre}</a>&nbsp;» par{" "}
      <a href={c.profil} target="_blank" rel="noopener noreferrer">{c.auteur}</a>,{" "}
      <a href={c.lienLicence} target="_blank" rel="noopener noreferrer">{c.licence}</a>
      {" "}(allégé et animé pour Agroporc)
    </p>
  );
}
