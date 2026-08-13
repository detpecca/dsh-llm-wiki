# dsh-llm-wiki

DeepSeek Harness 插件：让 agent 直接管理 **LLM-Wiki** 个人知识库（检索、阅读、统计、校验、错误本、入库）。

`@detpecca/dsh-llm-wiki` 是一个**薄适配层**——不重复实现任何检索/编译逻辑：

- 每个工具通过 DSH 的 `subprocess` 服务调用 [DSH-Wiki](https://github.com/detpecca/DSH-Wiki)（LLM-Wiki 的 Python 包，带 `--json` 输出）的 CLI；
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

## 前置条件

1. 安装 Python 包 **DSH-Wiki**（带 `--json` 接口的分支，`pyyaml` 是唯一运行时依赖）：

   ```bash
   pip install -e D:/path/to/DSH-Wiki
   # 或 python -m venv .venv && .venv/Scripts/pip install pyyaml
   ```

2. 准备一个已编译的 wiki 目录（`index.md` + 分类页面）。没有的话先用 Wiki 自己的 CLI 编译：

   ```bash
   python -m llm_wiki ingest my_notes.txt --wiki ./wiki
   ```

## 安装与挂载

把包加进你的 DSH 部署（如 `$DSH_HOME/profiles/<name>/package.json` 依赖），然后在
`cordis.yml`（或用户 patch 层 `cordis.patch.yml`）加一行：

```yaml
- insert:
    - id: llm-wiki
      name: '@detpecca/dsh-llm-wiki'
      config:
        wikiPath: D:/path/to/wiki        # 必填：wiki 根目录
        pythonPath: python               # 可选：python 可执行文件（默认 python）
        cwd: D:/path/to/DSH-Wiki         # 可选：子进程工作目录（llm_wiki 包需可导入）
```

挂载后，`wiki_search` / `wiki_read` 等工具即可被 agent 调用。遍历策略（搜索→阅读→跟
链接→充分性检查→作答）由 DSH 的 agent 模型执行，**不需要**再为查询配置第二套 LLM key。

### 入库（wiki_ingest）需要什么

`wiki_ingest` 走 Wiki 自己的编译流程（LLM 把文本改写成结构化页面），需要在 DSH 宿主
环境设置：

```bash
export LLM_WIKI_BASE_URL="https://api.moonshot.cn/v1"   # 任意 OpenAI 兼容端点
export LLM_WIKI_API_KEY="sk-..."
export LLM_WIKI_MODEL="kimi-k2-0711-preview"
```

插件会把这些变量显式转发给子进程（DSH 的 env 清理默认会丢弃含凭据名的变量）。

## 开发与测试

```bash
# 单元测试（会调用真实 python + DSH-Wiki CLI；可用环境变量覆盖路径）
LLM_WIKI_PYTHON="path/to/python.exe" node --test test/
```

## 开源

- 仓库：`github.com/detpecca/dsh-llm-wiki`（话题标签 `dsh-plugin`）
- 许可证：MIT

## 致谢

检索算法与编译流程来自 [LLM-Wiki](https://github.com/detpecca/LLM-Wiki)
（论文《Retrieval as Reasoning: Self-Evolving Agent-Native Retrieval via LLM-Wiki》的实现）。
