function logStructured_(level, message, details) {
  Logger.log(
    JSON.stringify({
      level: level,
      message: message,
      loggedAt: new Date().toISOString(),
      details: details || {},
    }),
  );
}

function logInfo_(message, details) {
  logStructured_("INFO", message, details);
}

function logError_(message, details) {
  logStructured_("ERROR", message, details);
}
