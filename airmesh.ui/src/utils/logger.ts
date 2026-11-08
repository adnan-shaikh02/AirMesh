type LogDetails = Record<string, string | number | boolean | undefined>;

function write(
  level: "info" | "warn" | "error",
  event: string,
  details?: LogDetails,
) {
  const message = `[Drop:browser] ${event}`;
  if (level === "info") {
    if (details) console.info(message, details);
    else console.info(message);
  } else if (level === "warn") {
    if (details) console.warn(message, details);
    else console.warn(message);
  } else if (details) console.error(message, details);
  else console.error(message);
}

export const browserLog = {
  info: (event: string, details?: LogDetails) => write("info", event, details),
  warn: (event: string, details?: LogDetails) => write("warn", event, details),
  error: (event: string, details?: LogDetails) =>
    write("error", event, details),
};
