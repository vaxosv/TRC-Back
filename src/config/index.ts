export const ALLOWED_ORIGINS = new Set([
  "http://localhost:4200",
  "http://192.168.1.11:4200",
  "https://trc--telavirc-8373e.europe-west4.hosted.app",
]);

export function isOriginAllowed(origin: string | undefined): boolean {
  return origin !== undefined && ALLOWED_ORIGINS.has(origin);
}
