export type LogDetails = Record<string, string | number | boolean | undefined>;

export function serverLog(
  level: "info" | "warn" | "error",
  event: string,
  details?: LogDetails,
) {
  const message = `[Drop:server] ${event}`;
  const output =
    level === "info"
      ? console.info
      : level === "warn"
        ? console.warn
        : console.error;
  if (details) output(message, details);
  else output(message);
}
