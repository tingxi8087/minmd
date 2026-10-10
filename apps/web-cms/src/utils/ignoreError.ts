const ignoreList = [
  "findDOMNode is deprecated",
  "https://reactrouter.com/v6/upgrading",
];
const originalError = console.error;
const originalWarn = console.warn;
console.error = (message, ...args) => {
  if (typeof message == "string") {
    for (const item of ignoreList) {
      if (message.includes(item)) {
        return;
      }
    }
  }
  originalError(message, ...args);
};
console.warn = (message, ...args) => {
  if (typeof message == "string") {
    for (const item of ignoreList) {
      if (message.includes(item)) {
        return;
      }
    }
  }
  originalWarn(message, ...args);
};
