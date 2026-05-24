import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: "http://127.0.0.1:4200",
    supportFile: false,
    specPattern: "cypress/e2e/**/*.cy.js",
    video: false
  }
});
