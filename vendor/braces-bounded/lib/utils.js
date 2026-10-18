'use strict';

exports.isInteger = num => {
  if (typeof num === 'number') {
    return Number.isInteger(num);
  }
  if (typeof num === 'string' && num.trim() !== '') {
    return Number.isInteger(Number(num));
  }
  return false;
};

/**
 * Find a node of the given type
 */

exports.find = (node, type) => node.nodes.find(node => node.type === type);

/**
 * Find a node of the given type
 */

exports.exceedsLimit = (min, max, step = 1, limit) => {
  if (limit === false) return false;
  let a, b;
  if (exports.isInteger(min) && exports.isInteger(max)) {
    a = Number(min); b = Number(max);
    // Avoid stalled IEEE-754 increments even for seemingly short ranges.
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return true;
  } else if (typeof min === 'string' && min.length === 1 && typeof max === 'string' && max.length === 1) {
    a = min.charCodeAt(0); b = max.charCodeAt(0);
  } else return false;
  const stride = Math.abs(Number(step)) || 1;
  if (!Number.isSafeInteger(stride)) return true;
  return Math.floor(Math.abs(b - a) / stride) + 1 > limit;
};

/**
 * Escape the given node with '\\' before node.value
 */

exports.escapeNode = (block, n = 0, type) => {
  const node = block.nodes[n];
  if (!node) return;

  if ((type && node.type === type) || node.type === 'open' || node.type === 'close') {
    if (node.escaped !== true) {
      node.value = '\\' + node.value;
      node.escaped = true;
    }
  }
};

/**
 * Returns true if the given brace node should be enclosed in literal braces
 */

exports.encloseBrace = node => {
  if (node.type !== 'brace') return false;
  if ((node.commas >> 0 + node.ranges >> 0) === 0) {
    node.invalid = true;
    return true;
  }
  return false;
};

/**
 * Returns true if a brace node is invalid.
 */

exports.isInvalidBrace = block => {
  if (block.type !== 'brace') return false;
  if (block.invalid === true || block.dollar) return true;
  if ((block.commas >> 0 + block.ranges >> 0) === 0) {
    block.invalid = true;
    return true;
  }
  if (block.open !== true || block.close !== true) {
    block.invalid = true;
    return true;
  }
  return false;
};

/**
 * Returns true if a node is an open or close node
 */

exports.isOpenOrClose = node => {
  if (node.type === 'open' || node.type === 'close') {
    return true;
  }
  return node.open === true || node.close === true;
};

/**
 * Reduce an array of text nodes.
 */

exports.reduce = nodes => nodes.reduce((acc, node) => {
  if (node.type === 'text') acc.push(node.value);
  if (node.type === 'range') node.type = 'text';
  return acc;
}, []);

/**
 * Flatten an array
 */

exports.flatten = (...args) => {
  const result = [];
  const stack = [...args].reverse();
  let bytes = 0;
  while (stack.length) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      if (stack.length + value.length + result.length > 65536) throw new RangeError('Brace queue exceeds safety limit');
      for (let i = value.length - 1; i >= 0; i--) stack.push(value[i]);
    } else if (value !== undefined) {
      bytes += typeof value === 'string' ? Buffer.byteLength(value) : 0;
      if (result.length >= 10000 || bytes > 8 * 1024 * 1024) throw new RangeError('Brace expansion exceeds safety limit');
      result.push(value);
    }
  }
  return result;
};
