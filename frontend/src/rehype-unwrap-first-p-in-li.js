/**
 * Rehype plugin: unwrap the first <p> inside each <li> so the first line of
 * list item content flows on the same line as the list marker (fixes
 * marker-on-own-line without relying on React component children structure).
 *
 * Mutates the HAST in place. Runs after mdast-util-to-hast (so loose list
 * items have <p> children) and before hast-util-to-jsx-runtime.
 */
export function rehypeUnwrapFirstPInLi() {
  return (tree) => {
    visit(tree, (node) => {
      if (
        node.type === "element" &&
        node.tagName === "li" &&
        Array.isArray(node.children) &&
        node.children.length > 0
      ) {
        const idx = node.children.findIndex(
          (c) => c.type === "element" && c.tagName === "p"
        );
        if (idx !== -1) {
          const p = node.children[idx];
          const before = node.children.slice(0, idx);
          const after = node.children.slice(idx + 1);
          node.children = [
            ...before,
            ...(p.children || []),
            ...after,
          ];
        }
      }
    });
  };
}

/** Simple recursive visitor (no unist-util-visit dependency). */
function visit(node, fn) {
  if (!node) return;
  fn(node);
  if (node.children) {
    for (const child of node.children) {
      visit(child, fn);
    }
  }
}
