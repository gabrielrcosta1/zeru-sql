/** True when running on macOS (native traffic lights are shown by the OS). */
export const isMac =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent);
