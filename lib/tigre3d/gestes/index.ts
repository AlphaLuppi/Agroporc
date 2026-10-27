/**
 * Registre des gestes : une réaction (lib/tigre-reactions.ts) → son module. Pour ajouter un
 * geste : un fichier `<nom>.ts` qui exporte un `Geste` (cf. types.ts), puis une ligne ici.
 */
import type { Reaction } from "../../tigre-reactions";
import type { Geste } from "./types";
import { regard } from "./regard";
import { saut } from "./saut";
import { tape } from "./tape";
import { sursaut } from "./sursaut";
import { ronron } from "./ronron";
import { rugir } from "./rugir";
import { salut } from "./salut";
import { lecher } from "./lecher";
import { etirement } from "./etirement";
import { serreMain } from "./serre-main";
import { batte } from "./batte";
import { griffe } from "./griffe";

export const GESTES: Record<Reaction, Geste> = { regard, saut, tape, sursaut, ronron, rugir, salut, lecher, etirement, "serre-main": serreMain, batte };
/**
 * Gestes hors du thème Tigre : ils ne sont pas des `Reaction` (donc jamais tirés, jamais dans `POIDS_REACTIONS`, ni textes ni bulle) ;
 * seul le mode zombies de l'arène les lance. « griffe » : coup de patte du tigre zombie (lib/fps/zombies-anim.ts).
 */
export const GESTES_ARENE = { griffe } as const;
export type { Geste, PoseGeste, ContexteGeste, ClipImages, EvenementGeste } from "./types";
