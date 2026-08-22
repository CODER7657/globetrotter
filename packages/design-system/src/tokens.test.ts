import { describe, expect, it } from 'vitest'
import { flatten, isAlias, resolveAlias, type TokenTree } from './tokens.js'

const TREE: TokenTree = {
  primitive: {
    color: {
      slate: { '200': { $value: 'oklch(0.92 0.01 260)' } },
      sunset: { '500': { $value: 'oklch(0.70 0.17 45)' } },
    },
  },
  semantic: {
    light: {
      border: { $value: '{primitive.color.slate.200}' },
      primary: { $value: '{primitive.color.sunset.500}' },
    },
  },
}

describe('isAlias', () => {
  it('recognises the DTCG curly reference form', () => {
    expect(isAlias('{primitive.color.slate.200}')).toBe(true)
  })

  it('treats a literal colour as not an alias', () => {
    expect(isAlias('oklch(0.92 0.01 260)')).toBe(false)
  })

  it('treats a shadow value containing braces-free text as not an alias', () => {
    expect(isAlias('0 1px 2px 0 oklch(0.19 0.02 260 / 0.05)')).toBe(false)
  })
})

describe('resolveAlias', () => {
  it('follows a reference to its literal value', () => {
    expect(resolveAlias(TREE, '{primitive.color.slate.200}')).toBe('oklch(0.92 0.01 260)')
  })

  it('returns a literal unchanged', () => {
    expect(resolveAlias(TREE, 'oklch(1 0 0)')).toBe('oklch(1 0 0)')
  })

  it('resolves transitively through a chain of aliases', () => {
    const chained: TokenTree = {
      a: { $value: 'oklch(1 0 0)' },
      b: { $value: '{a}' },
      c: { $value: '{b}' },
    }
    expect(resolveAlias(chained, '{c}')).toBe('oklch(1 0 0)')
  })

  it('throws on a reference that points nowhere', () => {
    expect(() => resolveAlias(TREE, '{primitive.color.slate.999}')).toThrow(/unresolved/i)
  })

  it('throws on a reference that stops at a group rather than a leaf', () => {
    expect(() => resolveAlias(TREE, '{primitive.color.slate}')).toThrow(/unresolved/i)
  })
})

describe('flatten', () => {
  it('produces dotted keys mapped to their raw values', () => {
    const flat = flatten(TREE['semantic'] as TokenTree)
    expect(flat.get('light.border')).toBe('{primitive.color.slate.200}')
    expect(flat.get('light.primary')).toBe('{primitive.color.sunset.500}')
    expect(flat.size).toBe(2)
  })

  it('walks nested primitive groups', () => {
    const flat = flatten(TREE['primitive'] as TokenTree)
    expect(flat.get('color.slate.200')).toBe('oklch(0.92 0.01 260)')
    expect(flat.size).toBe(2)
  })
})
