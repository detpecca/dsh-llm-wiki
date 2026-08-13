/**
 * Child-process runner: one `python -m llm_wiki --json` invocation per tool
 * call, driven through the DSH `subprocess` service (collect-mode stdout).
 */

/** Env vars the wiki's own LLM pipeline reads (ingest only). */
const LLM_WIKI_ENV = ['LLM_WIKI_BASE_URL', 'LLM_WIKI_API_KEY', 'LLM_WIKI_MODEL']

function ingestEnv() {
  const env = {}
  for (const key of LLM_WIKI_ENV) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

/**
 * Run one CLI subcommand and return the trimmed stdout text.
 *
 * @param {object} ctx - plugin context exposing `ctx.subprocess`.
 * @param {{ pythonPath: string, wikiPath: string, cwd: string }} cfg - resolved config.
 * @param {string[]} args - subcommand args AFTER `--wiki` (e.g. `['search', 'x', '--json']`).
 * @param {{ env?: Record<string, string>, signal?: AbortSignal, acceptExitCodes?: number[] }} opts
 * @returns {Promise<string>} stdout text.
 */
export async function runCli(ctx, cfg, args, opts = {}) {
  const subprocess = ctx.subprocess
  if (subprocess === undefined) {
    throw new Error('llm-wiki: subprocess service is unavailable in this runtime')
  }
  const env = opts.env ?? ingestEnv()
  const handle = subprocess.spawn({
    argv: [cfg.pythonPath, '-m', 'llm_wiki', '--wiki', cfg.wikiPath, ...args],
    cwd: cfg.cwd || process.cwd(),
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 2_000_000 },
      stderr: { maxBytes: 200_000 },
    },
    graceMs: 5_000,
  })
  const outcome = await handle.done
  const out = handle.collected.stdout?.readFrom(0)
  const accepted = opts.acceptExitCodes ?? [0]
  if (!accepted.includes(outcome.exitCode ?? -1)) {
    const err = handle.collected.stderr?.readFrom(0)
    const detail = (err?.text ?? '').trim()
    let hint = ''
    if (detail.includes("No module named 'llm_wiki'") || detail.includes('No module named llm_wiki')) {
      hint = ' (the llm_wiki Python package is not importable — install the DSH-Wiki engine: '
        + 'pip install git+https://github.com/detpecca/DSH-Wiki.git)'
    }
    throw new Error(
      `llm-wiki ${args[0] ?? ''} failed (exit ${outcome.exitCode})${detail ? `: ${detail}` : ''}${hint}`,
    )
  }
  return (out?.text ?? '').trim()
}
