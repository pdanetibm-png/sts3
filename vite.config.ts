/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    // Seul le paquet three.js (moteur de rendu WebGL, ~535 kB, indivisible) dépasse 500 kB ;
    // le code du jeu est séparé et reste bien en dessous.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        // three.js à part : il change rarement, le navigateur le garde en cache d'une version à l'autre.
        codeSplitting: {
          groups: [{ name: "three", test: /node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
