/**
 * DTCG-shaped token tree: loading, alias resolution, flattening.
 *
 * The three-layer rule lives here. Semantic tokens hold `{curly.path}`
 * references into the primitive layer and nothing else, which is what lets
 * layering be tested rather than merely documented.
 */

import { readFileSync } from 'node:fs'

export interface TokenLeaf {
  readonly $value: string
}

export interface TokenTree {
  readonly [key: string]: TokenTree | TokenLeaf
}

const ALIAS_PATTERN = /^\{([A-Za-z0-9_.-]+)\}$/

export function isAlias(value: string): boolean {
  return ALIAS_PATTERN.test(value)
}

function isLeaf(node: TokenTree | TokenLeaf): node is TokenLeaf {
  return typeof (node as TokenLeaf)['$value'] === 'string'
}

export function loadTokens(path: string): TokenTree {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Token file is not an object: ${path}`)
  }
  return parsed as TokenTree
}

/**
 * Resolve a value to its literal, following alias chains. A non-alias is
 * returned unchanged, so this is safe to call on every value.
 */
export function resolveAlias(tree: TokenTree, value: string, seen: readonly string[] = []): string {
  const match = ALIAS_PATTERN.exec(value)
  if (match === null) return value

  const path = match[1]
  if (path === undefined) {
    throw new Error(`Unresolved token reference: ${value}`)
  }
  if (seen.includes(path)) {
    throw new Error(`Circular token reference: ${[...seen, path].join(' -> ')}`)
  }

  let node: TokenTree | TokenLeaf | undefined = tree
  for (const segment of path.split('.')) {
    if (node === undefined || isLeaf(node)) {
      throw new Error(`Unresolved token reference: ${value}`)
    }
    node = node[segment]
  }
  if (node === undefined || !isLeaf(node)) {
    throw new Error(`Unresolved token reference: ${value}`)
  }
  return resolveAlias(tree, node['$value'], [...seen, path])
}

/** Flatten a group into dotted keys mapped to their raw (unresolved) values. */
export function flatten(group: TokenTree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, node] of Object.entries(group)) {
    if (key.startsWith('$')) continue
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (isLeaf(node)) {
      out.set(path, node['$value'])
    } else {
      for (const [childKey, childValue] of flatten(node, path)) {
        out.set(childKey, childValue)
      }
    }
  }
  return out
}
