import type { DonneesSquelette } from "./squelette";
export function nomThree(nom: string): string;
export function jsonGLB(octets: Uint8Array): { nodes: Array<{ name?: string }>; [cle: string]: unknown };
export function extraireSquelette(octets: Uint8Array): DonneesSquelette;
