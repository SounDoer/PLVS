import { portableToStoredTheme } from "../theme/portableTheme.js";
import { themeRuntime } from "../theme/themeRuntime.js";

/**
 * Product scenes take their theme the way the app does: surface tokens are derived from the root's
 * CSS tokens, and Canvas panels read the runtime's resolved theme. A copy of the tokens scoped to a
 * wrapper element reaches neither, so the previewed Theme is published to the runtime itself. Every
 * other asset renders on the built-in Dark shell.
 */
export function publishSharesetsPreviewTheme(plan, asset) {
  if (
    !plan.theme ||
    (asset.renderer !== "product-gallery" &&
      asset.renderer !== "multichannel-monitoring-prototype" &&
      asset.renderer !== "multichannel-monitoring")
  ) {
    return themeRuntime.publishSelection("plvs-dark");
  }
  return themeRuntime.publishAuthoring(
    portableToStoredTheme(plan.theme.document, "custom-sharesets-preview")
  );
}
