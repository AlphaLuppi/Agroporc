# Serveur temps réel de l'arène FPS. Contexte de build = RACINE du dépôt :
#   docker build -f serveur-fps/Dockerfile -t pdj-fps .
# (le serveur regroupe lib/fps et lib/agroparc3d, partagés avec le site, et lit public/agroparc/scene.json)

# ---- 1. build : esbuild regroupe src/index.ts + lib/fps/* + ws en un seul dist/index.js ----
FROM node:22-alpine AS build
WORKDIR /depot/serveur-fps
COPY serveur-fps/package.json serveur-fps/package-lock.json ./
RUN npm ci
COPY serveur-fps/tsconfig.json ./
COPY serveur-fps/scripts ./scripts
COPY serveur-fps/src ./src
COPY lib/fps /depot/lib/fps
COPY lib/agroparc3d /depot/lib/agroparc3d
RUN npm run typecheck && npm run build

# ---- 2. exécution : Node seul, aucun node_modules, utilisateur non-root ----
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8787 \
    SCENE_JSON=/app/scene.json
WORKDIR /app
COPY --from=build /depot/serveur-fps/dist/index.js ./index.js
COPY public/agroparc/scene.json ./scene.json
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/sante" > /dev/null || exit 1
CMD ["node", "index.js"]
