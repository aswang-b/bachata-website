// Astro/Vite populate a real import.meta.env object at SSR runtime, but a
// standalone Netlify function (bundled directly by esbuild, no Vite) only
// has process.env. This works in both.
export function env(key: string): string | undefined {
  return (import.meta as unknown as { env?: Record<string, string> }).env?.[key] ?? process.env[key];
}
