import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Agroporc — API",
  description: "Documentation Swagger des endpoints publics de l'API Agroporc.",
};

const SWAGGER_VERSION = "5.17.14";

const SWAGGER_CONTRASTE = `
.swagger-ui .opblock.opblock-get .opblock-summary-method { background: #1f6fd1; }
.swagger-ui .opblock.opblock-post .opblock-summary-method { background: #1a7f55; }
.swagger-ui .opblock.opblock-put .opblock-summary-method { background: #b45309; }
.swagger-ui .info .title small { background: #5c6370; }
.swagger-ui .info .title small.version-stamp { background: #5a7d00; }
.swagger-ui .info a, .swagger-ui .info .url { color: #1d63c4; }
.swagger-ui .btn.authorize { color: #1a7f55; border-color: #1a7f55; }
.swagger-ui .btn.authorize svg { fill: #1a7f55; }
.swagger-ui .btn.execute { background: #1f6fd1; border-color: #1f6fd1; }
.swagger-ui .btn.cancel { color: #c10007; border-color: #c10007; }
`;

export default function ApiDocsPage() {
  return (
    <>
      <link
        rel="stylesheet"
        href={`https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css`}
      />
      {/* Après la feuille de swagger-ui (même spécificité, l'ordre départage) : badges, liens et
          boutons assombris pour tenir 4,5:1 sur le fond blanc. Swagger n'a pas de mode sombre,
          la carte reste blanche dans les 3 thèmes. */}
      <style>{SWAGGER_CONTRASTE}</style>
      <div
        id="swagger-ui"
        className="bg-white border border-[var(--border-accent)] shadow-[var(--shadow)] rounded-[var(--radius)] -mx-3 sm:mx-0 overflow-hidden"
        style={{ minHeight: "70vh" }}
      />
      <Script
        src={`https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js`}
        strategy="afterInteractive"
      />
      <Script
        id="swagger-ui-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            (function init() {
              if (typeof SwaggerUIBundle === 'undefined') {
                return setTimeout(init, 50);
              }
              window.ui = SwaggerUIBundle({
                url: '/api/openapi.json',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [SwaggerUIBundle.presets.apis],
                layout: 'BaseLayout',
                tryItOutEnabled: true,
              });
            })();
          `,
        }}
      />
    </>
  );
}
