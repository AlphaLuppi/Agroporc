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

export const GESTES: Record<Reaction, Geste> = { regard, saut, tape, sursaut, ronron, rugir, salut, lecher, etirement, "serre-main": serreMain };
export type { Geste, PoseGeste, ContexteGeste, ClipImages, EvenementGeste } from "./types";
