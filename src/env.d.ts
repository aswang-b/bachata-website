declare namespace App {
  interface Locals {
    // Loaded by middleware.ts for page requests (not API routes).
    siteSettings?: import('./lib/siteSettings').SiteSettings;
    // The WhatsApp community link (lib/siteConfig.ts), or null when none is set.
    whatsappUrl?: string | null;
    // Where we are: city, state and homepage note (lib/siteConfig.ts).
    siteLocation?: import('./lib/siteLocation').SiteLocation;
  }
}
