import { Fragment, type ReactNode } from "react";

// Minimal, dependency-free Markdown renderer scoped to what the agent emits:
// bold/italic, inline code, links, headings, and ordered/unordered lists.
// Kept intentionally small — not a full CommonMark implementation.

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "ol"; items: string[]; start: number }
  | { kind: "ul"; items: string[] }
  | { kind: "p"; text: string };

const ORDERED = /^(\d+)\.\s+(.*)$/;
const UNORDERED = /^[-*]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: "p", text: para.join("\n") });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushPara();
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      flushPara();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    const ordered = ORDERED.exec(trimmed);
    if (ordered) {
      flushPara();
      const start = Number(ordered[1]);
      const items = [ordered[2]];
      while (i + 1 < lines.length) {
        const next = ORDERED.exec(lines[i + 1].trim());
        if (!next) break;
        items.push(next[2]);
        i++;
      }
      blocks.push({ kind: "ol", items, start });
      continue;
    }

    const unordered = UNORDERED.exec(trimmed);
    if (unordered) {
      flushPara();
      const items = [unordered[1]];
      while (i + 1 < lines.length) {
        const next = UNORDERED.exec(lines[i + 1].trim());
        if (!next) break;
        items.push(next[1]);
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    para.push(line);
  }
  flushPara();

  return blocks;
}

// Inline formatting: **bold**, *italic*/_italic_, `code`, [text](url).
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const pattern =
    /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let n = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const key = `${keyPrefix}-${n++}`;
    if (match[2] !== undefined) {
      nodes.push(
        <strong key={key} className="font-semibold text-text">
          {renderInline(match[2], key)}
        </strong>,
      );
    } else if (match[4] !== undefined) {
      nodes.push(<em key={key}>{renderInline(match[4], key)}</em>);
    } else if (match[6] !== undefined) {
      nodes.push(<em key={key}>{renderInline(match[6], key)}</em>);
    } else if (match[8] !== undefined) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-panel/70 border border-hairline px-1 py-0.5 font-mono text-[0.85em]"
        >
          {match[8]}
        </code>,
      );
    } else if (match[10] !== undefined) {
      nodes.push(
        <a
          key={key}
          href={match[11]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-signal underline underline-offset-2 hover:brightness-110"
        >
          {renderInline(match[10], key)}
        </a>,
      );
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}

// Render a paragraph's text, treating single newlines as <br/>.
function renderParagraph(text: string, key: string): ReactNode {
  const lines = text.split("\n");
  return (
    <p key={key} className="whitespace-pre-wrap">
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {renderInline(line, `${key}-${i}`)}
        </Fragment>
      ))}
    </p>
  );
}

const HEADING_CLASS = "font-display font-semibold tracking-tight text-text";

export function Markdown({ content }: { content: string }) {
  const blocks = parseBlocks(content);

  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        const key = `b-${i}`;
        switch (block.kind) {
          case "heading": {
            const size =
              block.level <= 1 ? "text-base" : block.level === 2 ? "text-[15px]" : "text-[14px]";
            return (
              <p key={key} className={`${HEADING_CLASS} ${size}`}>
                {renderInline(block.text, key)}
              </p>
            );
          }
          case "ol":
            return (
              <ol key={key} start={block.start} className="list-decimal pl-5 space-y-1">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ol>
            );
          case "ul":
            return (
              <ul key={key} className="list-disc pl-5 space-y-1">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case "p":
            return renderParagraph(block.text, key);
        }
      })}
    </div>
  );
}
