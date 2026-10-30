declare namespace App {
  interface Locals {
    // Loaded by middleware.ts for page requests (not API routes).
    siteSettings?: import('./lib/siteSettings').SiteSettings;
  }
}
