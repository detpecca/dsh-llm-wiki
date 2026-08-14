# dsh-llm-wiki

DeepSeek Harness 插件：让 agent 直接管理 **LLM-Wiki** 个人知识库——检索、阅读、统计、校验、修复、错误本、入库，共 7 个工具。

`@detpecca/dsh-llm-wiki` 是一个**薄适配层**，不重复实现任何检索/编译逻辑：

```
DSH agent ──调用工具──▶ 本插件（ToolDefinition × 7）
                          │ ctx.subprocess.spawn
                          ▼
                python -m llm_wiki --wiki <路径> <子命令> --json
                          │
                          ▼
              DSH-Wiki 引擎（检索打分 / 算法 1 编译 / 校验修复的唯一权威）
                          │
                          ▼
                     你的 Wiki 目录
```

- 每个工具通过 DSH 的 `subprocess` 服务调用 [DSH-Wiki](https://github.com/detpecca/DSH-Wiki) 引擎 CLI 的 `--json` 通道；
- Wiki 自己的**结构化信号检索**（页名/别名/标签/摘要加权打分）和**论文算法 1 编译流程**保持唯一权威；
- 插件本体**零运行时依赖**（纯 ESM，无构建步骤），Node ≥ 18。

## 前置要求

1. 已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh` 命令可用，或有其仓库 checkout）；
2. Python ≥ 3.10（供引擎使用）；
3. （可选）一个 OpenAI 兼容的 LLM API key——只有 `wiki_ingest` 和 `wiki_fix {finalize:true}` 需要。

## 🚀 快速开始

**两条命令，不需要克隆任何仓库。**

### 1. 安装 Python 引擎（DSH-Wiki）

```bash
pip install git+https://github.com/detpecca/DSH-Wiki.git
# 唯一运行时依赖是 pyyaml
```

### 2. 安装本插件

```bash
dsh plugin --profile web add @detpecca/dsh-llm-wiki
```

> 还没发布 npm 时，直接从 GitHub 装（本插件无构建步骤，git 安装即可用）：
> `dsh plugin --profile web add github:detpecca/dsh-llm-wiki`

### 3. 配置知识库路径

安装默认指向 `./wiki`。把实际路径写进 profile 的 `cordis.patch.yml`
（`$DSH_HOME/profiles/<name>/cordis.patch.yml`，`$DSH_HOME` 默认为 `~/.dsh`），
按 id 覆盖并**重述全部键**（patch 是整行替换，不是深合并）：

```yaml
- id: llm-wiki
  config:
    wikiPath: D:/path/to/your/wiki   # 你的知识库根目录
    pythonPath: python               # python 可执行文件（引擎已装进它的 site-packages）
    cwd: ''                          # 留空用宿主 cwd；llm_wiki 需可从 cwd 导入（pip 装过即可）
    # —— 以下三项可选：wiki_ingest / wiki_fix finalize 的 LLM 配置，显式配置优先于环境变量 ——
    llmWikiBaseUrl: https://api.moonshot.cn/v1
    llmWikiApiKey: sk-xxx            # 或改用环境变量 LLM_WIKI_API_KEY
    llmWikiModel: kimi-k2-0711-preview
```

**重启 DSH** 后，agent 即可调用全部 7 个工具。

### Windows：一键安装脚本

在插件仓库里直接跑（本地无引擎 checkout 时自动从 GitHub 装）：

```powershell
.\scripts\install.ps1 -WikiPath D:\你的知识库 -ApiKey sk-xxx
```

脚本自动完成：uv 建 venv → 装引擎 → `dsh plugin add` → 把配置（含 key）写进
profile 的 `cordis.patch.yml`。详情 `Get-Help .\scripts\install.ps1`。

### 知识库初始化

知识库为空时，可以让 agent 直接 `wiki_ingest` 你的第一份笔记，或先用引擎 CLI 编译：

```bash
python -m llm_wiki --wiki ./wiki ingest my_notes.txt
```

（`--wiki` 必须放在子命令之前。更多 CLI 用法见
[DSH-Wiki README](https://github.com/detpecca/DSH-Wiki#readme)。）

### 卸载

```bash
dsh plugin --profile web remove @detpecca/dsh-llm-wiki
```

## 工具参考

| 工具 | 作用 | 需要 LLM key？ |
|---|---|---|
| `wiki_search` | 结构化信号打分检索（CJK 分词） | 否 |
| `wiki_read` | 批量读页 / 目录索引，跟随 `[[wikilink]]` | 否 |
| `wiki_stats` | 页面/分类/digest/错误本统计 | 否 |
| `wiki_validate` | 4 类确定性结构校验 | 否 |
| `wiki_fix` | 确定性修复；`finalize:true` 追加 LLM 修复轮 | 否（finalize 需 key） |
| `wiki_errorbook` | 查看 Error Book（自我纠错记录） | 否 |
| `wiki_ingest` | 把源文本编译入库（算法 1 全流程） | 是 |

### `wiki_search` — 检索（第一跳）

- 参数：`query`（必填；实体名/别名匹配最好）、`limit`（默认 10）
- 返回：`{ hits: [{ path, score, aliases, tags, summary }] }`，`score` 是整数权重
  累加（页名 8 > 别名 6 > 标签 4 > 摘要 2 > 正文 1），越高越强，非相似度

### `wiki_read` — 批量读页

- 参数：`paths`（必填，数组）：wiki 相对路径、不带 `.md`，如 `concepts/retrieval`、
  目录索引 `concepts/_index`、根索引 `index`、digest `sources/digests/s-001`
- 返回：`{ pages: { path: content } }`；缺失页值为 `(page not found)`，
  不安全路径值为 `(invalid or unreadable path)`
- 页面正文含 `[[wikilink]]`，多跳问题让 agent 跟随链接继续读

### `wiki_stats` — 统计

- 返回：`{ pages, categories: {分类: 数量}, digests, errorBookEntries }`

### `wiki_validate` — 结构校验（只读）

- 返回：`{ ok, errors: [{ type, page, detail }] }`
- 4 类确定性检查：悬空链接 / 不完整页面 / 畸形来源引用 / 索引不一致
- 第 5 类 `unseen_overwrite` 是编译期检查，只在 `wiki_ingest` 内部触发，不在本工具
- 有错误时引擎 exit 1，插件已按"结果而非失败"处理，放心调用

### `wiki_fix` — 修复（wiki_validate 的搭档）

- 参数：`finalize`（默认 `false`）
  - `false`：只跑确定性修复——重建目录/全局索引、补双向 `[[wikilink]]` 回链，
    无需 LLM key；
  - `true`：追加论文 §3.3 定稿流程（3 轮 代码↔LLM 修复 + 跨页一致性扫描 +
    Error Book Verify & Close），较慢且需 LLM key
- 返回：`{ codeFixes, finalized, repaired, closedErrorEntries, openErrorEntries }`
- 典型闭环：`wiki_validate` 发现问题 → `wiki_fix` → 再 `wiki_validate` 确认

### `wiki_errorbook` — 错误记录本（只读）

- 返回：`{ entries: [...] }`，条目含 id / status / type / page / occurrences /
  constraint_rule 等

### `wiki_ingest` — 编译入库

- 参数：`file`（必填）：源文本文件路径，相对 DSH 宿主 cwd 解析
- 返回：`{ source, passages, written, pages, openErrorEntries, skipped }`
- 需要 LLM 配置（见下）；建议跑完后接 `wiki_validate` 确认健康

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `wikiPath` | `./wiki` | wiki 根目录（含 `index.md`） |
| `pythonPath` | `python` | python 可执行文件 |
| `cwd` | `''`（宿主 cwd） | 子进程工作目录；`llm_wiki` 包需可导入 |
| `llmWikiBaseUrl` | `''`（回落环境变量） | ingest/finalize 的 OpenAI 兼容端点 |
| `llmWikiApiKey` | `''`（回落环境变量） | ingest/finalize 的 API key |
| `llmWikiModel` | `''`（回落环境变量） | ingest/finalize 的模型名 |

LLM 配置的优先级：每个键独立判断——`cordis.patch.yml` 里的显式值 >
环境变量 `LLM_WIKI_BASE_URL` / `LLM_WIKI_API_KEY` / `LLM_WIKI_MODEL` > 不设置
（此时 `wiki_ingest` / finalize 会以清晰错误失败）。查询类工具**不需要**第二套
LLM key——遍历推理由 DSH 宿主的 agent 模型自己完成。

## 使用示例（对 agent 说）

- 「把 `D:\notes\transformer.md` 收录进我的知识库，然后校验一下」
- 「我知识库里关于注意力机制都讲了什么？给出依据页面」
- 「检查一下知识库结构有没有问题，有就修好」
- 「错误本里最近记录了什么？为什么会反复出现？」

## 故障排查

| 症状 | 原因与处理 |
|---|---|
| `No module named 'llm_wiki'` | 引擎没装进 `pythonPath` 指向的解释器。按快速开始第 1 步安装；插件报错信息里也自带此提示 |
| `wiki_ingest` 报缺 API key | 配 `llmWikiApiKey` 或环境变量 `LLM_WIKI_API_KEY`；查询类工具不受影响 |
| 改动了 wiki 但搜索/统计没变化 | 重启 DSH 使配置生效；若是手动编辑了 wiki 文件，跑 `wiki_fix` 重建索引（建议始终通过工具修改 wiki） |
| `wiki_validate` 报错但 `wiki_fix` 修不掉 | 结构性问题之外的错误（如坏链接改写）需要 `wiki_fix {finalize:true}`（需 LLM key） |
| 子进程输出被截断 | stdout 上限 2MB、stderr 200KB，正常检索/入库不会触及 |

## 开发与测试

```bash
# 真实驱动 Python CLI 的端到端测试（10 个用例）
LLM_WIKI_PYTHON="path/to/python.exe" DSH_WIKI_ROOT="path/to/DSH-Wiki" node --test test/run.test.js
```

- `LLM_WIKI_PYTHON`：装了 `pyyaml` 的 python（默认 `python`）
- `DSH_WIKI_ROOT`：DSH-Wiki 引擎 checkout 根目录（默认 `../dsh-wiki`）

## 相关仓库

- [DSH-Wiki](https://github.com/detpecca/DSH-Wiki) — 本插件调用的 Python 引擎
  （CLI 参考、wiki 目录结构、论文映射见其 README）；
- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — 宿主；
- [LLM-Wiki](https://github.com/detpecca/LLM-Wiki) — 论文
  《Retrieval as Reasoning: Self-Evolving Agent-Native Retrieval via LLM-Wiki》的原始实现。

## 许可证

MIT（见 `LICENSE`）。
