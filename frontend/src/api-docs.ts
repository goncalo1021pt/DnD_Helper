/*
 * The API reference (#348). RapiDoc is vendored as one file — see
 * vendor/rapidoc/README.md for why and how to update it — and api-docs.html
 * points it at /api/openapi.json, the contract the server runs. Nothing here
 * is imported by the app: it is the second Vite entry, and the SPA's page load
 * pays nothing for it.
 */
import "../vendor/rapidoc/rapidoc-min.js";
