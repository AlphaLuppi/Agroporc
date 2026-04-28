import { NextResponse } from "next/server";

export const dynamic = "force-static";

const spec = {
  openapi: "3.0.3",
  info: {
    title: "Plats du Jour API",
    version: "1.0.0",
    description:
      "API publique d'agroporc.vercel.app — agrégation de menus, commentaires, idées et profils IA.\n\n" +
      "Les endpoints marqués 🔒 nécessitent un Bearer token (`Authorization: Bearer <API_SECRET_TOKEN>`).",
  },
  servers: [{ url: "/", description: "Cette instance" }],
  tags: [
    { name: "PDJ", description: "Plats du jour (lecture / ingestion)" },
    { name: "Commentaires", description: "Commentaires sur les plats" },
    { name: "Idées", description: "Suggestions et votes" },
    { name: "IA", description: "Profils des personnages IA" },
    { name: "Feedback IA", description: "Retours humains sur les commentaires IA" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "API_SECRET_TOKEN" },
    },
    schemas: {
      Commentaire: {
        type: "object",
        required: ["auteur", "texte"],
        properties: {
          auteur: { type: "string", maxLength: 50 },
          texte: { type: "string", maxLength: 500 },
          image_url: { type: "string", description: "URL http(s) ou data: URI (max 5 Mo)" },
          reponse_a: { type: "string", description: "Auteur du commentaire parent" },
          reponse_a_index: { type: "integer", description: "Index du commentaire parent" },
          is_human: {
            type: "boolean",
            default: true,
            description: "false = commentaire IA. Défaut true (formulaire web).",
          },
        },
      },
      Plat: {
        type: "object",
        properties: {
          restaurant: { type: "string" },
          plat: { type: "string" },
          prix: { type: "string" },
          score_sportif: { type: "number" },
          score_goulaf: { type: "number" },
          commentaires: { type: "array", items: { $ref: "#/components/schemas/Commentaire" } },
        },
      },
      PdjEntry: {
        type: "object",
        required: ["date"],
        properties: {
          date: { type: "string", format: "date", example: "2026-04-28" },
          plats: { type: "array", items: { $ref: "#/components/schemas/Plat" } },
          recommandations: {
            type: "object",
            properties: {
              sportif: {
                type: "object",
                properties: { restaurant: { type: "string" }, plat: { type: "string" }, raison: { type: "string" } },
              },
              goulaf: {
                type: "object",
                properties: { restaurant: { type: "string" }, plat: { type: "string" }, raison: { type: "string" } },
              },
            },
          },
        },
      },
      Idee: {
        type: "object",
        properties: {
          id: { type: "integer" },
          auteur: { type: "string" },
          texte: { type: "string" },
          votes: { type: "array", items: { type: "string" } },
          statut: { type: "string", enum: ["en_attente", "validee", "rejetee"] },
          created_at: { type: "string", format: "date-time" },
          faisabilite: { type: "string", enum: ["faisable", "complexe", "impossible", "troll"] },
          evaluation: { type: "string" },
          evaluated_at: { type: "string", format: "date-time" },
        },
      },
      IaProfile: {
        type: "object",
        properties: {
          nom: { type: "string" },
          prenom: { type: "string" },
          emoji: { type: "string" },
          couleur: { type: "string" },
          role: { type: "string" },
          personnalite: { type: "string" },
          style_de_parole: { type: "string" },
          traits: { type: "array", items: { type: "string" } },
          sujets_fetiches: { type: "array", items: { type: "string" } },
          blagues_recurrentes: { type: "array", items: { type: "string" } },
          gifs_fetiches: { type: "array", items: { type: "string" } },
          avatar_url: { type: "string" },
          actif: { type: "boolean" },
        },
      },
      Error: { type: "object", properties: { error: { type: "string" } } },
      Ok: { type: "object", properties: { ok: { type: "boolean", example: true } } },
    },
  },
  paths: {
    "/api/pdj": {
      get: {
        tags: ["PDJ"],
        summary: "Plat du jour le plus récent",
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/PdjEntry" } } } },
          "404": { description: "Aucune donnée", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/update": {
      get: {
        tags: ["PDJ"],
        summary: "Health-check de l'endpoint d'ingestion",
        responses: { "200": { description: "OK" } },
      },
      post: {
        tags: ["PDJ"],
        summary: "🔒 Ingérer / mettre à jour un PdjEntry pour une date",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/PdjEntry" } } },
        },
        responses: {
          "200": { description: "Mis à jour", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } },
          "400": { description: "Champ manquant" },
          "401": { description: "Non autorisé" },
        },
      },
    },
    "/api/commentaire": {
      post: {
        tags: ["Commentaires"],
        summary: "Ajouter un commentaire sur un plat",
        description: "Rate limit : 5 req/min/IP. Champ `is_human` optionnel pour distinguer humain (défaut) ou IA.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["date", "platIndex", "auteur"],
                properties: {
                  date: { type: "string", format: "date" },
                  platIndex: { type: "integer" },
                  auteur: { type: "string", maxLength: 50 },
                  texte: { type: "string", maxLength: 500 },
                  image_url: { type: "string" },
                  reponse_a: { type: "string" },
                  reponse_a_index: { type: "integer" },
                  is_human: { type: "boolean", default: true },
                  website: { type: "string", description: "Honeypot — laisser vide" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } },
          "400": { description: "Champ requis manquant ou invalide" },
          "404": { description: "Plat ou date introuvable" },
          "429": { description: "Trop de requêtes" },
        },
      },
    },
    "/api/feedback-ia": {
      get: {
        tags: ["Feedback IA"],
        summary: "🔒 Réponses humaines aux commentaires IA, groupées par personnage",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    feedback: {
                      type: "object",
                      additionalProperties: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            date: { type: "string", format: "date" },
                            restaurant: { type: "string" },
                            plat: { type: "string" },
                            ai_texte: { type: "string" },
                            ai_image_url: { type: "string" },
                            human_auteur: { type: "string" },
                            human_texte: { type: "string" },
                            human_image_url: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Non autorisé" },
        },
      },
    },
    "/api/ia": {
      get: {
        tags: ["IA"],
        summary: "Lister tous les profils IA",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    profiles: { type: "array", items: { $ref: "#/components/schemas/IaProfile" } },
                  },
                },
              },
            },
          },
        },
      },
      put: {
        tags: ["IA"],
        summary: "Mettre à jour un profil IA existant",
        description: "Rate limit : 15 req/min/IP.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["nom", "profile"],
                properties: {
                  nom: { type: "string" },
                  updated_by: { type: "string", maxLength: 50 },
                  profile: { $ref: "#/components/schemas/IaProfile" },
                  website: { type: "string", description: "Honeypot — laisser vide" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "OK" },
          "400": { description: "Payload invalide" },
          "404": { description: "Profil introuvable" },
          "429": { description: "Trop de requêtes" },
        },
      },
    },
    "/api/idees": {
      get: {
        tags: ["Idées"],
        summary: "Lister toutes les idées",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Idee" } } },
            },
          },
        },
      },
      post: {
        tags: ["Idées"],
        summary: "Soumettre une idée",
        description: "Rate limit : 3 req/min/IP.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["auteur", "texte"],
                properties: {
                  auteur: { type: "string", maxLength: 50 },
                  texte: { type: "string", maxLength: 500 },
                  website: { type: "string", description: "Honeypot — laisser vide" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Idée créée", content: { "application/json": { schema: { $ref: "#/components/schemas/Idee" } } } },
          "400": { description: "Champ invalide" },
          "429": { description: "Trop de requêtes" },
        },
      },
    },
    "/api/idees/vote": {
      post: {
        tags: ["Idées"],
        summary: "Toggle un vote sur une idée",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["ideeId", "votant"],
                properties: {
                  ideeId: { type: "integer" },
                  votant: { type: "string", maxLength: 50 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "OK" },
          "400": { description: "Champ invalide" },
          "404": { description: "Idée introuvable" },
        },
      },
    },
    "/api/idees/non-evaluees": {
      get: {
        tags: ["Idées"],
        summary: "🔒 Idées non encore évaluées par l'IA",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Idee" } } } } },
          "401": { description: "Non autorisé" },
        },
      },
    },
    "/api/idees/evaluation": {
      post: {
        tags: ["Idées"],
        summary: "🔒 Enregistrer l'évaluation IA d'une idée",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id", "faisabilite", "evaluation"],
                properties: {
                  id: { type: "integer" },
                  faisabilite: { type: "string", enum: ["faisable", "complexe", "impossible", "troll"] },
                  evaluation: { type: "string", maxLength: 1000 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "OK" },
          "400": { description: "Payload invalide" },
          "401": { description: "Non autorisé" },
          "404": { description: "Idée introuvable" },
        },
      },
    },
  },
};

export async function GET() {
  return NextResponse.json(spec);
}
