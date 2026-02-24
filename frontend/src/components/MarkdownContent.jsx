import React, { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { rehypeUnwrapFirstPInLi } from "../rehype-unwrap-first-p-in-li";
import "highlight.js/styles/github-dark.min.css";
import "katex/dist/katex.min.css";

const ESCAPED_BLOCK_MATH_RE = /\\\[\s*([\s\S]*?)\s*\\\]/g;
const ESCAPED_INLINE_MATH_RE = /\\\((.+?)\\\)/g;
const BRACKET_BLOCK_MATH_RE = /(^|\n)\[\s*\n([\s\S]*?)\n\](?=\n|$)/g;
const FENCED_CODE_BLOCK_RE = /(```[\s\S]*?```)/g;
const MATH_HINT_RE = /\\[a-zA-Z]+|[_^]|(?:^|\s)[a-zA-Z]\s*=\s*|\\frac|\\sum|\\int/;

function normalizeMathInText(text) {
  const withEscapedBlockMath = text.replace(
    ESCAPED_BLOCK_MATH_RE,
    (_, equation) => `\n$$\n${equation.trim()}\n$$\n`
  );
  const withEscapedInlineMath = withEscapedBlockMath.replace(
    ESCAPED_INLINE_MATH_RE,
    (_, equation) => `$${equation.trim()}$`
  );

  return withEscapedInlineMath.replace(
    BRACKET_BLOCK_MATH_RE,
    (match, leading, equation) => {
      const trimmedEquation = equation.trim();
      if (!trimmedEquation || !MATH_HINT_RE.test(trimmedEquation)) return match;
      return `${leading}$$\n${trimmedEquation}\n$$`;
    }
  );
}

function normalizeMathDelimiters(markdown) {
  return markdown
    .split(FENCED_CODE_BLOCK_RE)
    .map((part, index) => (index % 2 === 1 ? part : normalizeMathInText(part)))
    .join("");
}

/**
 * Custom list item (Option A from concepts-02): unwrap the first <p> among
 * children so the first line flows on the same line as the list marker.
 * Children can include newline text nodes (from mdast-util-to-hast), so we
 * find the first element with type "p" instead of assuming arr[0] is the p.
 */
function ListItem({ children, ...props }) {
  const arr = React.Children.toArray(children);
  const idx = arr.findIndex(
    (child) =>
      React.isValidElement(child) &&
      typeof child.type === "string" &&
      child.type === "p"
  );
  if (idx === -1) return <li {...props}>{children}</li>;
  const firstP = arr[idx];
  const before = arr.slice(0, idx);
  const after = arr.slice(idx + 1);
  const firstContent =
    firstP.props?.children != null ? firstP.props.children : firstP;
  return (
    <li {...props}>
      {before}
      {firstContent}
      {after}
    </li>
  );
}

function CodeBlockWithCopy({ children, ...props }) {
  const wrapRef = useRef(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const codeEl = wrapRef.current?.querySelector("pre code");
    if (!codeEl) return;
    const text = codeEl.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn("Copy failed:", err);
    }
  };

  return (
    <div ref={wrapRef} className="code-block-wrap">
      <button
        type="button"
        className={`code-block-copy ${copied ? "copied" : ""}`}
        onClick={handleCopy}
        aria-label="Copy code"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
}

/**
 * Renders markdown with syntax highlighting for code blocks.
 * Links open in new tab. No raw HTML (safe).
 */
export default function MarkdownContent({ content, className = "" }) {
  if (!content || typeof content !== "string") return null;
  const normalizedContent = useMemo(
    () => normalizeMathDelimiters(content),
    [content]
  );

  return (
    <div className={`markdown-content ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeUnwrapFirstPInLi,
          rehypeKatex,
          [rehypeHighlight, { detect: true }],
        ]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          li: ListItem,
          pre: ({ children, ...props }) => (
            <CodeBlockWithCopy {...props}>{children}</CodeBlockWithCopy>
          ),
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}
