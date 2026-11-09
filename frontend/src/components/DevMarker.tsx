import { useEffect, useState } from "react";
import { UpdateService } from "@/lib/api";

/** A "Dev mode" tag at the top of every window when Relay isn't a release
 * build, so a dev copy is never mistaken for the installed one. */
export function DevMarker() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    UpdateService.Status().then(
      (s) => s.dev && setVersion(s.current),
      () => {},
    );
  }, []);

  if (version === null) return null;
  return (
    <div
      role="status"
      title="Not a release build: no update checks, and Buffer posts carry the test note."
      className="pointer-events-none fixed left-1/2 top-2 z-[100] -translate-x-1/2 select-none rounded-full border border-[#fbbf24]/50 bg-[#fbbf24]/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[.06em] text-[#fbbf24] backdrop-blur"
    >
      Dev mode{version ? ` · v${version}` : ""}
    </div>
  );
}
