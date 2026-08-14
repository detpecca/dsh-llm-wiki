/**
 * Model-facing tools for the LLM-Wiki knowledge base.
 *
 * The descriptions embed the wiki's traversal strategy (paper §3.2): search
 * first, read, follow [[wikilinks]] for multi-hop questions, read a directory
 * index (`<category>/_index`) to browse, and ground every answer in pages.
 */

import { runCli } from './runner.js'

const RENDER = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]

function parseJson(text, label) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`llm-wiki ${label}: CLI returned non-JSON output: ${text.slice(0, 300)}`)
  }
}

/**
 * @param {{ pythonPath: string, wikiPath: string, cwd: string }} cfg - resolved config.
 * @param {object} ctx - plugin context (for `ctx.subprocess`).
 * @returns {object[]} ToolDefinition objects ready for `ctx.tools.register`.
 */
export function buildTools(cfg, ctx) {
  const cli = (args, opts = {}) => runCli(ctx, cfg, args, opts)

  return [
    {
      name: 'wiki_search',
      description:
        'Search the LLM-Wiki knowledge base with its structured-signal scorer '
        + '(page name, aliases, tags and summary weighted before page content; '
        + 'CJK-aware tokenization). Returns candidate pages with path, score, '
        + 'aliases, tags and one-line summary; score is an integer weight sum '
        + '(higher = stronger match), not a similarity. Use this for the first '
        + 'hop of any question, then wiki_read the promising pages. For multi-hop '
        + 'questions, follow the [[wikilinks]] you see in page content.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description: 'Search terms; entity names and aliases match best.',
        },
        limit: {
          type: 'number',
          description: 'Maximum candidate pages to return (default 10).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            hits: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  path: { type: 'string', required: true },
                  score: { type: 'number', required: true },
                  aliases: { type: 'array', items: { type: 'string' } },
                  tags: { type: 'array', items: { type: 'string' } },
                  summary: { type: 'string' },
                },
              },
            },
          },
        },
        render: RENDER,
      },
      async execute(args, exec) {
        const limit = args.limit ?? 10
        const text = await cli(['search', String(args.query), '--limit', String(limit), '--json'], {
          signal: exec?.signal,
        })
        return { hits: parseJson(text, 'search') }
      },
    },
    {
      name: 'wiki_read',
      description:
        'Batch-read pages from the LLM-Wiki knowledge base (the wiki_read '
        + 'primitive). Paths are relative to the wiki root without the .md '
        + 'extension, e.g. "concepts/retrieval" or a directory index '
        + '"concepts/_index". Page content contains [[wikilinks]] to related '
        + 'pages — follow them for multi-hop questions. A missing page returns '
        + '"(page not found)" for that path; unsafe paths return an error note.',
      parameters: {
        paths: {
          type: 'array',
          required: true,
          description: 'Wiki-relative page or index paths to read.',
          items: { type: 'string' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            pages: { type: 'object', required: true, additionalProperties: { type: 'string' } },
          },
        },
        render: RENDER,
      },
      async execute(args, exec) {
        const text = await cli(['read', ...args.paths.map(String), '--json'], {
          signal: exec?.signal,
        })
        return { pages: parseJson(text, 'read') }
      },
    },
    {
      name: 'wiki_stats',
      description:
        'Summary statistics of the LLM-Wiki knowledge base: total page count, '
        + 'page count per category, digest count, and the number of error-book '
        + 'entries. Useful before searching a large wiki or after an ingest.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            pages: { type: 'number', required: true },
            categories: { type: 'object', required: true },
            digests: { type: 'number', required: true },
            errorBookEntries: { type: 'number', required: true },
          },
        },
        render: RENDER,
      },
      async execute(_args, exec) {
        const text = await cli(['stats', '--json'], { signal: exec?.signal })
        return parseJson(text, 'stats')
      },
    },
    {
      name: 'wiki_validate',
      description:
        'Run the 4 deterministic structural checks on the LLM-Wiki knowledge '
        + 'base (dangling links, incomplete pages, malformed source refs, index '
        + 'inconsistency). Returns ok:true when clean, plus a list of '
        + '{type, page, detail} errors otherwise. Run this after wiki_ingest to '
        + 'confirm the wiki is healthy. The unseen-overwrite check is '
        + 'compile-time only: it runs inside wiki_ingest, not in this tool.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            errors: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  type: { type: 'string' },
                  page: { type: 'string' },
                  detail: { type: 'string' },
                },
              },
            },
          },
        },
        render: RENDER,
      },
      async execute(_args, exec) {
        // validate exits 1 when errors exist — that is a result, not a failure.
        const text = await cli(['validate', '--json'], {
          signal: exec?.signal,
          acceptExitCodes: [0, 1],
        })
        return parseJson(text, 'validate')
      },
    },
    {
      name: 'wiki_fix',
      description:
        'Repair the LLM-Wiki knowledge base. The deterministic pass (always '
        + 'runs) rebuilds directory/global indices and adds missing '
        + 'bidirectional [[wikilinks]]. With finalize:true it also runs the LLM '
        + 'repair rounds — 3 code-fix <-> LLM-fix cycles plus a cross-page '
        + 'consistency sweep — which is slow and requires the wiki LLM key to be '
        + 'configured. Returns the code fixes applied, pages the LLM repaired, '
        + 'and error-book entries closed / remaining open. Run this after '
        + 'wiki_validate reports errors.',
      parameters: {
        finalize: {
          type: 'boolean',
          description: 'Also run the LLM repair rounds (needs LLM key). Default false.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            codeFixes: { type: 'array', items: { type: 'string' } },
            finalized: { type: 'boolean' },
            repaired: { type: 'array', items: { type: 'string' } },
            closedErrorEntries: { type: 'number' },
            openErrorEntries: { type: 'number' },
          },
        },
        render: RENDER,
      },
      async execute(args, exec) {
        const cmdArgs = ['fix', '--json']
        if (args.finalize) cmdArgs.push('--finalize')
        const text = await cli(cmdArgs, { signal: exec?.signal })
        return parseJson(text, 'fix')
      },
    },
    {
      name: 'wiki_errorbook',
      description:
        'Show the LLM-Wiki Error Book: the persistent self-correction store '
        + '(Discover -> Attribute -> Constrain -> Inject -> Verify & Close). '
        + 'Each entry carries id, type, page, phenomenon, root cause, constraint '
        + 'rule, status and occurrence count. Useful to understand why the wiki '
        + 'recently repaired or flagged pages.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            entries: {
              type: 'array',
              required: true,
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        render: RENDER,
      },
      async execute(_args, exec) {
        const text = await cli(['errorbook', '--json'], { signal: exec?.signal })
        return parseJson(text, 'errorbook')
      },
    },
    {
      name: 'wiki_ingest',
      description:
        'Compile a source text file into the LLM-Wiki knowledge base — the '
        + 'paper Algorithm 1 pipeline (SelectPages -> compile -> validate -> '
        + 'Error Book -> repair). The file path is resolved against the DSH host '
        + 'cwd. Requires the wiki\'s own LLM environment variables '
        + '(LLM_WIKI_BASE_URL, LLM_WIKI_API_KEY, LLM_WIKI_MODEL) to be set in the '
        + 'host environment — compilation is inherently LLM-driven. Returns a '
        + 'report of written page paths, skipped passages, new wiki size and '
        + 'open error-book entries.',
      parameters: {
        file: {
          type: 'string',
          required: true,
          description: 'Path to the source text file to compile into the wiki.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            source: { type: 'string' },
            passages: { type: 'number' },
            written: { type: 'array', items: { type: 'string' } },
            pages: { type: 'number' },
            openErrorEntries: { type: 'number' },
            skipped: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: { id: { type: 'string' }, reason: { type: 'string' } },
              },
            },
          },
        },
        render: RENDER,
      },
      async execute(args, exec) {
        const text = await cli(['ingest', String(args.file), '--json'], {
          signal: exec?.signal,
        })
        return parseJson(text, 'ingest')
      },
    },
  ]
}
