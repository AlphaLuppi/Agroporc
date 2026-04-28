import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Plats du Jour — API",
  description: "Documentation Swagger des endpoints publics de l'API Plats du Jour.",
};

const SWAGGER_VERSION = "5.17.14";

export default function ApiDocsPage() {
  return (
    <>
      <link
        rel="stylesheet"
        href={`https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css`}
      />
      <div
        id="swagger-ui"
        className="bg-white rounded-[var(--radius)] -mx-3 sm:mx-0 overflow-hidden"
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
