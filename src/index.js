/**
 * @detpecca/dsh-llm-wiki — DeepSeek Harness plugin for LLM-Wiki knowledge bases.
 *
 * Thin adapter: each tool shells out to the `llm_wiki` Python package (the
 * LLM-Wiki engine, which speaks --json), so the wiki's own retrieval algorithm
 * and compile pipeline stay the single source of truth.  The plugin itself
 * has zero runtime dependencies.
 */

import { buildTools } from './tools.js'

export const name = 'llm-wiki'

/** Hard dependencies: tool registry + subprocess spawning. */
export const inject = ['tools', 'subprocess']

const DEFAULTS = {
  /** Root directory of the compiled wiki (where index.md lives). */
  wikiPath: './wiki',
  /** Python executable used to run `python -m llm_wiki`. */
  pythonPath: 'python',
  /**
   * Working directory for child processes. Relative paths resolve against
   * the DSH host's cwd; the `llm_wiki` package must be importable from here
   * (pip-installed, or the LLM-Wiki checkout root).
   */
  cwd: '',
  /**
   * Explicit LLM configuration for wiki_ingest (the compile pipeline).
   * These override the LLM_WIKI_* environment variables when set, so the
   * API key can live in cordis.patch.yml instead of the process env.
   */
  llmWikiBaseUrl: '',
  llmWikiApiKey: '',
  llmWikiModel: '',
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {Partial<typeof DEFAULTS> & object} config - row config from cordis.yml.
 */
export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config ?? {}) }
  if (!cfg.wikiPath) {
    throw new Error('llm-wiki: config.wikiPath is required (the compiled wiki root directory)')
  }
  for (const tool of buildTools(cfg, ctx)) {
    ctx.tools.register(tool)
  }
}
