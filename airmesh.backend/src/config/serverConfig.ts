export const port = Number(process.env.PORT ?? 8787);
export const sessionTtlMs = 10 * 60 * 1000;
export const maxPayloadBytes = 64 * 1024;
