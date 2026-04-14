import { describe, it, expect } from 'vitest'
import { slugify, slugToName, normalizeForMatch, conceptsMatch } from '../../../src/utils/slug.js'

describe('slugify', () => {
  it('converts concept name to slug', () => {
    expect(slugify('Dependency Injection')).toBe('dependency-injection')
    expect(slugify('Event Loop')).toBe('event-loop')
    expect(slugify('CQRS Pattern')).toBe('cqrs-pattern')
  })

  it('handles special characters', () => {
    expect(slugify('React Hooks (useState)')).toBe('react-hooks-usestate')
  })

  it('trims whitespace', () => {
    expect(slugify('  test  ')).toBe('test')
  })
})

describe('slugToName', () => {
  it('converts slug to display name', () => {
    expect(slugToName('dependency-injection')).toBe('Dependency Injection')
    expect(slugToName('event-loop')).toBe('Event Loop')
  })
})

describe('normalizeForMatch', () => {
  it('strips separators and lowercases', () => {
    expect(normalizeForMatch('Dependency Injection')).toBe('dependencyinjection')
    expect(normalizeForMatch('dependency-injection')).toBe('dependencyinjection')
    expect(normalizeForMatch('dependency_injection')).toBe('dependencyinjection')
  })
})

describe('conceptsMatch', () => {
  it('matches exact same name', () => {
    expect(conceptsMatch('event-loop', 'event-loop')).toBe(true)
  })

  it('matches same concept different case', () => {
    expect(conceptsMatch('Dependency Injection', 'dependency injection')).toBe(true)
  })

  it('does not match different concepts', () => {
    expect(conceptsMatch('event-loop', 'promise-chain')).toBe(false)
  })
})
