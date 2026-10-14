'use strict';
// Check before recursive upstream walkers. Parent/prev are intentionally not
// traversed: parsed ASTs contain those back-references by design.
module.exports = ast => {
  const pending = [[ast, 0]];
  const seen = new Set();
  let bytes = 0;
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (!node || typeof node !== 'object') throw new TypeError('Invalid brace AST');
    if (depth > 64 || seen.size >= 65536 || seen.has(node)) throw new RangeError('Brace AST exceeds safety limits');
    seen.add(node);
    bytes += typeof node.value === 'string' ? Buffer.byteLength(node.value) : 0;
    if (bytes > 8 * 1024 * 1024) throw new RangeError('Brace AST bytes exceed safety limits');
    const parents = new Set();
    for (let link = node; link; link = link.parent) {
      if (typeof link !== 'object' || parents.has(link) || parents.size > 64) throw new RangeError('Brace parent chain exceeds safety limits');
      parents.add(link);
    }
    if (typeof node.value === 'string' && node.value.length > 65536) throw new RangeError('Brace value too long');
    if (node.nodes) {
      if (!Array.isArray(node.nodes) || node.nodes.length > 65536) throw new RangeError('Invalid brace AST children');
      if (pending.length + seen.size + node.nodes.length > 65536) throw new RangeError('Brace AST exceeds safety limits');
      for (const child of node.nodes) pending.push([child, depth + 1]);
    }
  }
};
