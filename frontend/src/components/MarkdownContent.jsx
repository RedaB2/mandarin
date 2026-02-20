import React, { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { rehypeUnwrapFirstPInLi } from "../rehype-unwrap-first-p-in-li";
import "highlight.js/styles/github-dark.min.css";

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

  return (
    <div className={`markdown-content ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeUnwrapFirstPInLi, [rehypeHighlight, { detect: true }]]}
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
        {content}
      </ReactMarkdown>
    </div>
  );
}
