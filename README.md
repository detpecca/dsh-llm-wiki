# dsh-llm-wiki

DeepSeek Harness 插件：让 agent 直接管理 **LLM-Wiki** 个人知识库（检索、阅读、统计、校验、错误本、入库）。

`@detpecca/dsh-llm-wiki` 是一个**薄适配层**——不重复实现任何检索/编译逻辑：

- 每个工具通过 DSH 的 `subprocess` 服务调用 [DSH-Wiki](https://github.com/detpecca/DSH-Wiki)（LLM-Wiki 的 Python 引擎，带 `--json` 输出）的 CLI；
- Wiki 自己的**结构化信号检索引擎**（页名/别名/标签/摘要加权打分）和**论文算法 1 编译流程**保持唯一权威；
- 插件本体**零运行时依赖**（纯 ESM，无构建步骤）。

## 工具

| 工具 | 作用 | 需要 LLM key？ |
|---|---|---|
| `wiki_search` | 结构化信号打分检索（CJK 分词） | 否 |
| `wiki_read` | 批量读页 / 目录索引，跟随 `[[wikilink]]` | 否 |
| `wiki_stats` | 页面/分类/digest/错误本统计 | 否 |
| `wiki_validate` | 5 类确定性结构校验 | 否 |
| `wiki_errorbook` | 查看 Error Book（自我纠错记录） | 否 |
| `wiki_ingest` | 把源文本编译入库（算法 1 全流程） | 是（编译本质要调 LLM） |

## 🚀 快速开始（给使用者）

**总共两条安装命令，不需要克隆任何仓库。**

### 1. 安装 Python 引擎（DSH-Wiki）

```bash
pip install git+https://github.com/detpecca/DSH-Wiki.git
# 唯一运行时依赖是 pyyaml
```

### 2. 安装 DSH 插件

```bash
dsh plugin --profile web add @detpecca/dsh-llm-wiki
```

> 还没发布 npm 时，也可以直接从 GitHub 装（本插件无构建步骤，git 安装即可用）：
> `dsh plugin --profile web add github:detpecca/dsh-llm-wiki`

### 3. 配置你的知识库路径

安装默认指向 `./wiki`。把实际路径写进 profile 的 `cordis.patch.yml`
（`$DSH_HOME/profiles/<name>/cordis.patch.yml`），按 id 覆盖并**重述全部键**：

```yaml
- id: llm-wiki
  config:
    wikiPath: D:/path/to/your/wiki   # 你的知识库根目录
    pythonPath: python               # 你的 python 可执行文件
    cwd: ''                          # 留空则用 DSH 宿主 cwd（llm_wiki 需可导入）
    # —— 以下三项可选：wiki_ingest 的 LLM 配置，显式配置优先于环境变量 ——
    llmWikiBaseUrl: https://api.moonshot.cn/v1
    llmWikiApiKey: sk-xxx            # 或改用环境变量 LLM_WIKI_API_KEY
    llmWikiModel: kimi-k2-0711-preview
```

重启后，`wiki_search` / `wiki_read` 等工具即可被 agent 调用。遍历策略（搜索→阅读→跟
链接→充分性检查→作答）由 DSH 的 agent 模型执行，**不需要**为查询配置第二套 LLM key。

### Windows 用户：一键安装脚本

本地有 DSH-Wiki 引擎 checkout（或想从 GitHub 装）时，在插件仓库里直接跑：

```powershell
.\scripts\install.ps1 -WikiPath D:\你的知识库 -ApiKey sk-xxx
```

脚本自动完成：uv 建 venv → 装引擎 → `dsh plugin add` → 把配置（含 key）写进
profile 的 `cordis.patch.yml`。详情 `Get-Help .\scripts\install.ps1`。

### （可选）入库需要 LLM key

`wiki_ingest` 走 Wiki 自己的编译流程（LLM 把文本改写成结构化页面）。两种配置方式，
**显式配置优先**：

1. **写进 `cordis.patch.yml`**（推荐，随 profile 私有保存）：见上方 `llmWiki*` 三项；
2. **或用环境变量**（`LLM_WIKI_BASE_URL` / `LLM_WIKI_API_KEY` / `LLM_WIKI_MODEL`），
   插件会把它们转发给子进程。

若知识库还是空的，先用引擎自己编译一份：

```bash
python -m llm_wiki ingest my_notes.txt --wiki ./wiki
```

### 卸载

```bash
dsh plugin --profile web remove @detpecca/dsh-llm-wiki
```

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `wikiPath` | `./wiki` | wiki 根目录（含 `index.md`） |
| `pythonPath` | `python` | python 可执行文件 |
| `cwd` | `''`（宿主 cwd） | 子进程工作目录；`llm_wiki` 包需可导入 |
| `llmWikiBaseUrl` | `''`（回落环境变量） | ingest 的 OpenAI 兼容端点 |
| `llmWikiApiKey` | `''`（回落环境变量） | ingest 的 API key |
| `llmWikiModel` | `''`（回落环境变量） | ingest 的模型名 |

## 开发与测试

```bash
LLM_WIKI_PYTHON="path/to/python.exe" node --test test/   # 调真实 Python CLI
```

## 开源

- 仓库：`github.com/detpecca/dsh-llm-wiki`（话题 `dsh-plugin`）
- 许可证：MIT

## 致谢

检索算法与编译流程来自 [LLM-Wiki](https://github.com/detpecca/LLM-Wiki)
（论文《Retrieval as Reasoning: Self-Evolving Agent-Native Retrieval via LLM-Wiki》的实现）。
