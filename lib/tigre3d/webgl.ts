/**
 * Détection de WebGL, sans three (le composant l'importe tout de suite, three vient à la demande).
 * Sans WebGL, le thème Tigre garde l'ancien sprite webp.
 */
let memo: boolean | null = null;

export function webglDisponible(): boolean {
  if (memo !== null) return memo;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    memo = !!gl;
    // Libère tout de suite le contexte de test : les navigateurs en plafonnent le nombre.
    (gl as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    memo = false;
  }
  return memo;
}
