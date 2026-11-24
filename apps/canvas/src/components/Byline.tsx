// Who wrote a card, by name: a person's name and initial, or Jamie.
// The id → login directory is built once from what the canvas has read (lib/author.ts).
import { createContext, useContext, useState } from "react";
import { authorName, avatarOf, type Author } from "../lib/author";

export const AuthorDirectory = createContext<Record<string, string>>({});

export function Byline({ author, prefix = "by ", className }: { author: Author; prefix?: string; className?: string }) {
  const dir = useContext(AuthorDirectory);
  const name = authorName(author, dir);
  const src = avatarOf(author, dir);
  const [broken, setBroken] = useState(false);
  if (!name) return null;
  return (
    <span className={`ic-by${className ? ` ${className}` : ""}`}>
      {prefix}
      {author.kind === "person" && src && !broken ? (
        <img className="ic-avatar" src={src} alt="" width={14} height={14} onError={() => setBroken(true)} />
      ) : (
        <i className={`ic-avatar ic-avatar-${author.kind}`}>{name.charAt(0).toUpperCase()}</i>
      )}
      {name}
    </span>
  );
}
