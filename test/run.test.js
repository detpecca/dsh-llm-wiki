/**
 * End-to-end unit tests for the plugin tools against the REAL DSH-Wiki CLI.
 *
 * The fake ctx substitutes only the subprocess service (driving real `python`
 * through file-descriptor stdio); every tool's execute() runs the actual
 * `llm_wiki` Python package, so the JSON contract is verified for real.
 *
 * Env overrides:
 *   LLM_WIKI_PYTHON  — python executable (default: `python`)
 *   DSH_WIKI_ROOT    — DSH-Wiki checkout root (default: sibling dev repo)
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildTools } from '../src/tools.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(here, '..')
const WIKI_ROOT = path.join(PLUGIN_ROOT, 'test', '.wiki')
const PYTHON = process.env.LLM_WIKI_PYTHON ?? 'python'
const DSH_WIKI_ROOT = process.env.DSH_WIKI_ROOT ?? path.resolve(PLUGIN_ROOT, '..', 'dsh-wiki')

const CFG = { wikiPath: WIKI_ROOT, pythonPath: PYTHON, cwd: DSH_WIKI_ROOT }

/** Minimal subprocess-service stand-in: spawn -> one-shot exec -> collected output. */
function fakeSubprocess() {
  return {
    spawn(spec) {
      const tag = Math.random().toString(36).slice(2, 8)
      const outPath = path.join(WIKI_ROOT, `.proc-${tag}.out`)
      const errPath = path.join(WIKI_ROOT, `.proc-${tag}.err`)
      const outFd = openSync(outPath, 'w')
      const errFd = openSync(errPath, 'w')
      let exitCode = 0
      try {
        execFileSync(spec.argv[0], spec.argv.slice(1), {
          cwd: spec.cwd,
          stdio: ['ignore', outFd, errFd],
          ...(spec.env !== undefined ? { env: { ...process.env, ...spec.env } } : {}),
        })
      } catch (err) {
        exitCode = err.status ?? 1
      } finally {
        closeSync(outFd)
        closeSync(errFd)
      }
      const text = readFileSync(outPath, 'utf8')
      const errText = readFileSync(errPath, 'utf8')
      return {
        pid: -1,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: {
          stdout: { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) },
          stderr: { readFrom: () => ({ text: errText, nextOffset: errText.length, lossy: false }) },
        },
        done: Promise.resolve({ exitCode, signal: null }),
        terminate() {},
        waitForExit() {},
      }
    },
  }
}

function buildSampleWiki() {
  const script = `
import sys
sys.path.insert(0, ${JSON.stringify(DSH_WIKI_ROOT)})
from llm_wiki.schema import Page, render_page
from llm_wiki.store import WikiStore

root = ${JSON.stringify(WIKI_ROOT)}
import shutil, os
shutil.rmtree(root, ignore_errors=True)
os.makedirs(root, exist_ok=True)

def page(p, t, aliases=None, tags=None):
    return render_page(Page(path=p, title=t, page_type=p.split("/")[0],
        aliases=aliases or [], tags=tags or [], summary=f"summary of {t}",
        key_facts=["fact one"], related_pages=[], related_sources=[]), today="2026-01-01")

store = WikiStore(root)
store.write("concepts/retrieval", page("concepts/retrieval", "Retrieval", aliases=["检索"], tags=["ai"]))
store.write("entities/paper", page("entities/paper", "LLM-Wiki Paper", tags=["research"]))
store.write("sources/digests/s-001", "digest content\\n")
store.rebuild_all_indices()
print("wiki built")
`
  execFileSync(PYTHON, ['-c', script], { stdio: 'ignore' })
}

let tools

before(() => {
  buildSampleWiki()
  tools = Object.fromEntries(buildTools(CFG, { subprocess: fakeSubprocess() }).map((t) => [t.name, t]))
})

after(() => {
  rmSync(WIKI_ROOT, { recursive: true, force: true })
})

test('registers the six expected tools', () => {
  for (const name of ['wiki_search', 'wiki_read', 'wiki_stats', 'wiki_validate', 'wiki_errorbook', 'wiki_ingest']) {
    assert.ok(tools[name], `missing tool ${name}`)
    assert.equal(typeof tools[name].execute, 'function')
  }
})

test('wiki_search returns scored hits (alias matching works)', async () => {
  const res = await tools.wiki_search.execute({ query: '检索' }, {})
  assert.ok(Array.isArray(res.hits) && res.hits.length >= 1)
  assert.equal(res.hits[0].path, 'concepts/retrieval')
  assert.ok(res.hits[0].score > 0)
})

test('wiki_search respects limit', async () => {
  const res = await tools.wiki_search.execute({ query: 'wiki', limit: 1 }, {})
  assert.ok(res.hits.length <= 1)
})

test('wiki_read batch-reads pages and reports missing ones', async () => {
  const res = await tools.wiki_read.execute({ paths: ['concepts/retrieval', 'missing/page'] }, {})
  assert.equal(typeof res.pages['concepts/retrieval'], 'string')
  assert.match(res.pages['concepts/retrieval'], /## Key Facts/)
  assert.equal(res.pages['missing/page'], '(page not found)')
})

test('wiki_stats reports counts', async () => {
  const res = await tools.wiki_stats.execute({}, {})
  assert.equal(res.pages, 2)
  assert.deepEqual(res.categories, { concepts: 1, entities: 1 })
  assert.equal(res.digests, 1)
  assert.equal(res.errorBookEntries, 0)
})

test('wiki_validate passes on a healthy wiki', async () => {
  const res = await tools.wiki_validate.execute({}, {})
  assert.equal(res.ok, true)
  assert.deepEqual(res.errors, [])
})

test('wiki_validate reports structural errors on a broken page', async () => {
  writeFileSync(path.join(WIKI_ROOT, 'concepts', 'broken.md'), '# Broken\n\nno sections\n', 'utf8')
  try {
    const res = await tools.wiki_validate.execute({}, {})
    assert.equal(res.ok, false)
    assert.ok(res.errors.some((e) => e.page === 'concepts/broken'))
  } finally {
    rmSync(path.join(WIKI_ROOT, 'concepts', 'broken.md'), { force: true })
  }
})

test('wiki_errorbook returns entries (empty here)', async () => {
  const res = await tools.wiki_errorbook.execute({}, {})
  assert.deepEqual(res, { entries: [] })
})
