export function installCommunityPreviewIsolation(host) {
  const reject = () =>
    Promise.reject(new Error("Network access is disabled in Community previews."));
  host.fetch = reject;
  host.XMLHttpRequest = class DisabledXMLHttpRequest {
    constructor() {
      throw new Error("Network access is disabled in Community previews.");
    }
  };
  host.WebSocket = class DisabledWebSocket {
    constructor() {
      throw new Error("Network access is disabled in Community previews.");
    }
  };
}
