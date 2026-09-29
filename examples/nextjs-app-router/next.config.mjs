/**
 * A static export: the examples showcase serves it at /next (NEXT_BASE_PATH=/next). Nothing here needs a server:
 * the article is pre-rendered, and the widget, the iframe embed and the wallet run in the browser.
 * @type {import('next').NextConfig}
 */
export default {
  output: "export",
  basePath: process.env.NEXT_BASE_PATH || "",
  trailingSlash: true,
  images: { unoptimized: true },
};
