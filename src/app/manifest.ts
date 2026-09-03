import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AIC Documents",
    short_name: "AIC Docs",
    description: "Internal document platform for the Accra Innovation Center.",
    start_url: "/offline",
    scope: "/",
    display: "standalone",
    background_color: "#efe8d6",
    theme_color: "#1e3a2f",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
