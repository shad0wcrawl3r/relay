import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "@/components/Toaster";
import { PlaneProvider } from "@/lib/store";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <TooltipProvider>
        <PlaneProvider>
          <App />
        </PlaneProvider>
      </TooltipProvider>
    </ToastProvider>
  </React.StrictMode>,
);
