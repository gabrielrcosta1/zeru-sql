import { Fragment } from "react";

const KEYWORDS = new Set(
  `select from where and or not in is null as join left right inner outer on group by order asc desc limit offset insert into values update set delete create table alter drop distinct count sum avg min max having union all interval now filter case when then else end between like ilike exists`.split(
    " "
  )
);

/** Tiny, dependency-free SQL highlighter for read-only previews. */
export function SqlHighlight({ sql }: { sql: string }) {
  const lines = sql.split("\n");
  return (
    <code className="block whitespace-pre font-mono text-xs leading-[1.55]">
      {lines.map((line, li) => (
        <Fragment key={li}>
          {li > 0 && "\n"}
          <Line line={line} />
        </Fragment>
      ))}
    </code>
  );
}

function Line({ line }: { line: string }) {
  if (line.trimStart().startsWith("--")) {
    return <span className="italic text-content-faint">{line}</span>;
  }
  // Tokenize on words, strings and whitespace/punctuation.
  const tokens = line.match(/'[^']*'|"[^"]*"|[A-Za-z_][A-Za-z0-9_]*|\s+|[^\sA-Za-z0-9_]+/g) ?? [];
  return (
    <>
      {tokens.map((t, i) => {
        if (/^'.*'$/.test(t) || /^".*"$/.test(t))
          return (
            <span key={i} className="text-teal">
              {t}
            </span>
          );
        if (/^\d+$/.test(t))
          return (
            <span key={i} className="text-sky">
              {t}
            </span>
          );
        if (KEYWORDS.has(t.toLowerCase()))
          return (
            <span key={i} className="font-semibold text-iris">
              {t}
            </span>
          );
        if (/^[^\sA-Za-z0-9_]+$/.test(t))
          return (
            <span key={i} className="text-content-muted">
              {t}
            </span>
          );
        return <span key={i}>{t}</span>;
      })}
    </>
  );
}
