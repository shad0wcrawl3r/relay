import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Events } from "@wailsio/runtime";
import { SettingsService } from "./api";

/** Which services besides Plane are set up. null until known. */
interface IntegrationsStore {
  buffer: boolean | null;
  devto: boolean | null;
  refresh: () => void;
}

const Ctx = createContext<IntegrationsStore | null>(null);

export function useIntegrations(): IntegrationsStore {
  const s = useContext(Ctx);
  if (!s) throw new Error("useIntegrations outside IntegrationsProvider");
  return s;
}

export function IntegrationsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ buffer: boolean | null; devto: boolean | null }>({ buffer: null, devto: null });
  const refresh = useCallback(() => {
    SettingsService.Integrations()
      .then((i) => setState({ buffer: i.buffer, devto: i.devto }))
      .catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    // Go sends this on sign-in, sign-out (including Buffer ending it) and saved settings.
    const off = Events.On("integrations:changed", (ev) => {
      const i = ev.data as { buffer: boolean; devto: boolean } | undefined;
      if (i && typeof i.buffer === "boolean") setState({ buffer: i.buffer, devto: i.devto });
      else refresh();
    });
    return () => off();
  }, [refresh]);
  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
