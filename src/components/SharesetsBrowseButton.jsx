import { ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { HoverTip } from "./HoverTip.jsx";
import { openExternalUrl, SHARESETS_URL } from "../ipc/openExternal.js";

const CATEGORY_LABELS = {
  themes: "Themes",
  presets: "Presets",
  loudness: "Loudness Profiles",
};

/** @param {{ category: "themes" | "presets" | "loudness", children?: import("react").ReactNode, onOpen?: typeof openExternalUrl }} props */
export function SharesetsBrowseButton({ category, children = "Browse", onOpen = openExternalUrl }) {
  const label = `Browse ${CATEGORY_LABELS[category]} on Sharesets`;
  return (
    <HoverTip tip={label}>
      <Button
        variant="ghost"
        className="text-foreground"
        aria-label={label.toLowerCase()}
        onClick={() => onOpen(`${SHARESETS_URL}${category}/`)}
      >
        {children}
        <ExternalLink />
      </Button>
    </HoverTip>
  );
}
