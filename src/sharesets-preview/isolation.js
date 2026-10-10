export function installSharesetsPreviewIsolation(host) {
  const reject = () =>
    Promise.reject(new Error("Network access is disabled in Sharesets previews."));
  host.fetch = reject;
  host.XMLHttpRequest = class DisabledXMLHttpRequest {
    constructor() {
      throw new Error("Network access is disabled in Sharesets previews.");
    }
  };
  host.WebSocket = class DisabledWebSocket {
    constructor() {
      throw new Error("Network access is disabled in Sharesets previews.");
    }
  };
}
