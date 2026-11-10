import type { BufferChannel } from "@/lib/api";

/** Text limits per network, as Buffer enforces them. */
export const LIMITS: Record<string, number> = {
  twitter: 280,
  bluesky: 300,
  threads: 500,
  mastodon: 500,
  linkedin: 3000,
  facebook: 63206,
  googlebusiness: 1500,
};

/** Where networks fold a long post behind "see more". Approximate: it varies by device. */
const FOLD_AT: Record<string, number> = { linkedin: 210, facebook: 480, googlebusiness: 250 };

const NETWORK: Record<string, { name: string; bg: string; link: string }> = {
  linkedin: { name: "LinkedIn", bg: "#1b1f23", link: "#71b7fb" },
  twitter: { name: "X", bg: "#000000", link: "#1d9bf0" },
  bluesky: { name: "Bluesky", bg: "#161e27", link: "#208bfe" },
  threads: { name: "Threads", bg: "#101010", link: "#77a7ff" },
  mastodon: { name: "Mastodon", bg: "#191b22", link: "#8c8dff" },
  facebook: { name: "Facebook", bg: "#242526", link: "#4599ff" },
  googlebusiness: { name: "Google Business", bg: "#1f1f1f", link: "#8ab4f8" },
};

export const networkName = (service: string) => NETWORK[service]?.name ?? (service ? service[0].toUpperCase() + service.slice(1) : "");

const URL_RE = /(https?:\/\/[^\s]+)/g;

/** Roughly how a network lays out a post, including where "see more" falls. */
export function PostPreview({ channel, text }: { channel: BufferChannel; text: string }) {
  const net = NETWORK[channel.service] ?? { name: networkName(channel.service), bg: "#18181b", link: "#93c5fd" };
  const foldAt = FOLD_AT[channel.service];
  const folded = !!foldAt && text.length > foldAt;
  const [before, after] = folded ? [text.slice(0, foldAt), text.slice(foldAt)] : [text, ""];
  const limit = LIMITS[channel.service];
  const links = (part: string) =>
    part.split(URL_RE).map((piece, i) =>
      i % 2 === 1 ? (
        <span key={i} style={{ color: net.link }}>
          {piece}
        </span>
      ) : (
        piece
      ),
    );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="rounded-[10px] border border-border p-4" style={{ background: net.bg }}>
        <div className="mb-3 flex items-center gap-2.5">
          {channel.avatar ? (
            <img src={channel.avatar} alt="" className="size-10 rounded-full object-cover" />
          ) : (
            <span className="grid size-10 place-items-center rounded-full bg-[#38434f] text-sm font-semibold text-strong">
              {(channel.displayName || channel.name).slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-strong">{channel.displayName || channel.name}</span>
            <span className="text-xs text-dim">{net.name}</span>
          </div>
          {limit && (
            <span className={`ml-auto shrink-0 text-xs ${text.length > limit ? "text-overdue" : "text-dim"}`}>
              {text.length.toLocaleString()} / {limit.toLocaleString()}
            </span>
          )}
        </div>
        <p className="m-0 whitespace-pre-wrap break-words text-sm leading-[1.45] text-[#e4e4e7]">
          {links(before)}
          {folded && <span className="my-2 block border-t border-dashed border-border-strong pt-1 text-xs text-dim">Readers tap “see more” to read past this line</span>}
          {folded && links(after)}
        </p>
      </div>
    </div>
  );
}

export const PREVIEW_NOTE = "An approximate preview: each network sets the final layout and link card.";
