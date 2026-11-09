import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Guide } from "@/views/guide/Guide";
import { ToastProvider } from "@/components/Toaster";
import { PlaneProvider } from "@/lib/store";
import { IntegrationsProvider } from "@/lib/integrations";
import { TerminalProvider } from "@/lib/terminal";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DevMarker } from "@/components/DevMarker";
import { ZoomKeys } from "@/lib/zoom";
import "./index.css";

// The setup guide is a second window on the same bundle (guide.go).
const isGuide = new URLSearchParams(window.location.search).get("window") === "guide";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <ZoomKeys />
      <DevMarker />
      <TooltipProvider>
        <PlaneProvider>
          <IntegrationsProvider>
            {isGuide ? (
              <Guide />
            ) : (
              <TerminalProvider>
                <App />
              </TerminalProvider>
            )}
          </IntegrationsProvider>
        </PlaneProvider>
      </TooltipProvider>
    </ToastProvider>
  </React.StrictMode>,
);
