/**
 * The three-layer discipline, enforced.
 *
 * Semantics must be aliases, primitives must be literals, nothing may be raw
 * hex, and both themes must expose the same names. Without this, "components
 * reference semantic only" is a convention people remember or forget.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { flatten, isAlias, loadTokens, type TokenTree } from './tokens.js'

const tokens = loadTokens(fileURLToPath(new URL('../tokens.json', import.meta.url)))
const semantic = flatten(tokens['semantic'] as TokenTree)
const primitive = flatten(tokens['primitive'] as TokenTree)

function themeNames(theme: string): string[] {
  return [...semantic.keys()]
    .filter((key) => key.startsWith(`${theme}.`))
    .map((key) => key.slice(theme.length + 1))
    .sort()
}

describe('token layering', () => {
  it('has no literal values in the semantic layer', () => {
    const literals = [...semantic].filter(([, value]) => !isAlias(value))
    expect(literals).toEqual([])
  })

  it('has no aliases in the primitive layer', () => {
    const aliases = [...primitive].filter(([, value]) => isAlias(value))
    expect(aliases).toEqual([])
  })

  it('uses no raw hex anywhere', () => {
    for (const [name, value] of [...semantic, ...primitive]) {
      expect(value, `${name} contains a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })

  it('defines the same token names in both themes', () => {
    expect(themeNames('light')).toEqual(themeNames('dark'))
  })

  it('every semantic alias points at the primitive layer', () => {
    for (const [name, value] of semantic) {
      expect(value, `${name} should alias a primitive`).toMatch(/^\{primitive\./)
    }
  })

  it('keeps ring independent of primary in the light theme', () => {
    expect(semantic.get('light.ring')).not.toBe(semantic.get('light.primary'))
  })
})
