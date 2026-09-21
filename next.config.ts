import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Vercel plafonne le corps d'une requête de fonction à 4,5 Mo au niveau de
      // l'infra (413 FUNCTION_PAYLOAD_TOO_LARGE) : au-delà, la requête n'atteint
      // même pas l'app. On reste sous ce plafond, tout en laissant passer les
      // photos de l'admin (limitées à 3 Mo côté action + overhead multipart).
      // https://vercel.com/docs/functions/limitations
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
