import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SelectionModel } from '../src/selection'

const ids = ['a', 'b', 'c', 'd', 'e']

function model(): SelectionModel {
  const m = new SelectionModel()
  m.reset(ids)
  return m
}

test('toggle selects and deselects', () => {
  const m = model()
  m.onCheckbox('a', true, false)
  assert.equal(m.has('a'), true)
  m.onCheckbox('a', false, false)
  assert.equal(m.has('a'), false)
})

test('shift-click selects the inclusive range from last click', () => {
  const m = model()
  m.onCheckbox('b', true, false)
  m.onCheckbox('d', true, true)
  assert.deepEqual(m.selectedIds(), ['b', 'c', 'd'])
})

test('shift-click range works in reverse order', () => {
  const m = model()
  m.onCheckbox('d', true, false)
  m.onCheckbox('b', true, true)
  assert.deepEqual(m.selectedIds(), ['b', 'c', 'd'])
})

test('shift-click can also deselect a range', () => {
  const m = model()
  m.selectAll()
  m.onCheckbox('b', false, false)
  m.onCheckbox('d', false, true)
  assert.deepEqual(m.selectedIds(), ['a', 'e'])
})

test('selectAll and clear', () => {
  const m = model()
  m.selectAll()
  assert.equal(m.size, 5)
  m.clear()
  assert.equal(m.size, 0)
})

test('reset prunes selections that no longer exist', () => {
  const m = model()
  m.selectAll()
  m.reset(['a', 'b', 'x'])
  assert.deepEqual(m.selectedIds(), ['a', 'b'])
})

test('selectedIds follows playlist order, not click order', () => {
  const m = model()
  m.onCheckbox('e', true, false)
  m.onCheckbox('a', true, false)
  assert.deepEqual(m.selectedIds(), ['a', 'e'])
})

test('shift-click without a previous click falls back to plain set', () => {
  const m = model()
  m.onCheckbox('c', true, true)
  assert.deepEqual(m.selectedIds(), ['c'])
})
