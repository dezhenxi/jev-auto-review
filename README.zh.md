---
description: "面向 DeepSeek Harness Auto 权限预设的 Jev 级联：常规的审查调用交给 TypeSafe 的 System One 模型，拿不准的一律留给语言模型审查者。"
---

# jev-auto-review

[English](README.md) | 中文

`@deepseek-ai/dsh-experimental-jev-auto-review` 在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 自带的 [Auto review](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/experimental/auto-review) 审查者前面加了一个便宜的裁判。它识别审查者在 `llm/stream` waterfall 上发出的模型调用，并在待执行动作属于部署认可的、常规的项目内读取时，改由 [TypeSafe](https://typesafe.ai) 的 System One 模型作答。其余所有调用——工具不在名单里、概率偏低、没有凭据、服务故障、被取消——都原样交给审查者。它从不拒绝，也不裁决 medium 或 high，因此审查者的策略、输入与 fail-closed 行为全部保持不变。

## 目录

- [为什么需要它](#why)
- [安装](#install)
- [配置](#configure)
- [工作原理](#how-it-works)
- [开发](#development)
- [模型体验](#model-experience)
- [已知限制](#known-limitations)

<a id="why"></a>
## 为什么需要它

Auto review 对语言模型放行的调用，以"每次工具调用前都问一次模型该动作是否被授权"替代人工审批。这是一次完整的大模型请求：一个 27 步、30 次工具调用的轮次就要多付 30 次审查请求，而审查者自己的文档就写明它没有缓存、没有重试、没有截断，也没有独立的小输出预算。

这些调用绝大多数是平凡的。项目内的 `read`、`glob`、`grep` 正属于审查者策略中"无需额外授权即必须允许"的 low 风险类。本插件用 System One 模型——一个快速、便宜、不生成文本的分类器——来回答这一类，其余全部留给审查者。

级联刻意收得很窄：

| 本插件可以 | 本插件绝不 |
| --- | --- |
| 对部署列出的工具给出 `{"risk":"low","decision":"allow"}` | 拒绝任何调用 |
| 把所有拿不准的情况交给审查者 | 授予 `medium` 或 `high` |
| 只转发部署选中的请求段 | 修改审查者的提示词、解析器或策略 |

<a id="install"></a>
## 安装

涉及两层：你的 harness 随附的 Auto review 插件，以及回答它常规调用的本级联。本仓库自带构建产物，因此直接用仓库地址安装即可：

```sh
dsh plugin --profile web add https://github.com/dezhenxi/jev-auto-review
```

同一个地址也可以粘进 Web 界面的 **插件 → 添加插件**。git 安装不会运行构建脚本、也不需要任何审批，因为仓库里提交了 `lib/` 产物。

再补上 Auto review 层，取你正在运行的 harness 版本：

```sh
dsh plugin --profile web add @deepseek-ai/dsh-experimental-auto-review@next
```

两个包都声明了 `dsh.bundle.patch`，因此 CLI 会把各自的补丁追加为一个 profile 层。之后在输入框或 `/permission` 选择器里选中 **Auto review**；两层本身都不会切换正在运行的会话。

要改源码时改用检出安装。每次改源码都必须重新构建并提交 `lib/`，否则仓库会发布过期代码：

```sh
git clone https://github.com/dezhenxi/jev-auto-review.git
cd jev-auto-review
pnpm install
pnpm run build

# Auto review 层，来自你正在运行的 harness 检出
dsh plugin --profile web add /path/to/deepseek-harness/packages/experimental/auto-review
dsh plugin --profile web add /path/to/jev-auto-review
```

Windows 下改用绝对路径，例如 `dsh plugin --profile web add "E:\DeepSeek\jev-auto-review"`。

用同一条 CLI 卸载：

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-experimental-jev-auto-review
```

## 支持的 DSH 版本

| DSH | 状态 |
| --- | --- |
| **0.2.0-rc.2** | 已支持，且由本仓库自己的套件覆盖：开发依赖就跟在这条线上，因此 85 个用例全部对着 `@deepseek-ai/dsh-experimental-auto-review@0.2.0-rc.2` 真包运行（不是打桩），逐文件覆盖率 100%。运行时的接缝也核过：`llm/stream` 仍是同一个 waterfall、签名未变，`GenerateOptions` 仍带请求匹配器读取的每个字段，`sessionTelemetry.emit` 与 `SessionTelemetryRecord` 结构未变。 |
| **0.1.7-rc.1 / 0.1.7-rc.2** | 已支持。开发依赖迁到 0.2.0 之前，同样这 85 个用例对着这条线全过，且下面那三个接缝在两代中完全一致。 |
| 其他版本 | 未验证。peer 不匹配会直接拦住安装；`dsh plugin allow-version <spec> --accept-risk` 可以强行越过该检查，风险自负。 |

这个范围盯的是三个接缝，而不是整个 harness：级联作答所依赖的 `llm/stream` waterfall、用于计数的可选 `sessionTelemetry` 服务，以及 `@deepseek-ai/dsh-experimental-auto-review` 渲染出的审查请求。**改动审查者请求文本的那个版本，才是需要同步更新本插件的版本。**

<a id="configure"></a>
## 配置

级联出厂即**惰性**：它自己的补丁行带一个空的 `allowTools`，因此在部署点名自己信任的工具之前，装上这一层不会代答任何调用。在 profile 的 `cordis.patch.yml`（Web profile 为 `~/.dsh/profiles/web/cordis.patch.yml`）中按 id 覆盖该行：

```yaml
- id: jev-auto-review
  name: "@deepseek-ai/dsh-experimental-jev-auto-review"
  config:
    allowTools:
      - read
      - glob
      - grep
    minProbability: 0.98
```

两个值都必须显式给出，因为可信工具名单与阈值都无法脱离你自己的 trace 数据来定。其余字段都有明确默认值：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `apiKey` | `$TYPESAFE_API_KEY` | TypeSafe 凭据。没有它时插件在加载期警告一次并且不作答。 |
| `baseURL` | `https://api.typesafe.ai` | 端点基址，其后追加 `/v1/systemone`。 |
| `model` | `jev-latest` | System One 模型 id。 |
| `allowTools` | —（必填） | 允许级联自行作答的工具名。 |
| `minProbability` | —（必填） | `noul` 为 yes 且不低于此概率时跳过审查者。 |
| `timeoutMs` | `800` | 单次 System One 调用的端到端预算。 |
| `cache` | `false` | 对完全相同的待执行动作复用结论。 |
| `cacheMaxEntries` | `512` | 记忆结论条数上限。 |
| `stateSections` | `["environment","pending-action"]` | 作为 state 转发出去的审查请求段。 |

`minProbability` 卡的是模型自己"这是常规读取"的概率，不是正确率承诺。请用你自己的流量标定；从这个 README 抄来的值只是猜测。

<a id="how-it-works"></a>
## 工作原理

插件只注册一个全局 `llm/stream` 监听器，别无其它。这条 waterfall 是 harness 中每次模型请求的文档化扩展点，而审查者的请求正是其中之一：

```
工具调用
  └─ tools/pre-execute 链条（hooks、工作区变更、后台任务、auto-review）   ← 未改动
        └─ auto-review 监听器
              ├─ 从会话面组装审查者提示词
              └─ ctx.llm.stream(审查请求)
                    └─ llm/stream waterfall
                          ├─ harness 流语法不变式（包裹）
                          ├─ jev-auto-review 监听器              ← 唯一新增点
                          │     ├─ 不是审查请求        → next()
                          │     ├─ 工具不在名单        → next()
                          │     ├─ 问 Jev，概率够高    → 合成 allow 流
                          │     └─ 其余一切            → next()
                          └─ 真实语言模型适配器
              ├─ deny  → 拒绝（未改动）
              └─ allow → await next()   ← 所有下游门禁照常执行
```

这个位置带来两个性质：

- **审查者保留自己的流水线。** 策略、五段式快照、解析器、拒绝文案、fail-closed 处理与 Auto 预设全部仍在 Auto review 包里。本插件只改变"由谁做那一次推理"。
- **不短路任何东西。** 因为审查者允许时会自己 `await next()`，与它并列注册的 hook 桥、工作区变更跟踪、后台任务门禁全部照常运行。若改在 `tools/pre-execute` 上加监听器，这些都会被跳过——这正是本插件不那样做的原因。

识别刻意严格：请求必须同时满足 `system` 提示词以 `REVIEW_POLICY` 开头**且**包含其首句、`temperature: 0`、恰好一条 user 消息且恰好一个 text 块、没有任何工具 schema。误判会用一句话替换掉无关的模型回答，因此任何解析失败都弃权，绝不猜。

发给 TypeSafe 的请求只带一个问题（`noul`），state 只含你选中的段。客户端认识的所有失败——没有 key、传输错误、超时、取消、非 2xx、响应体不是 JSON、答案不是 `noul` 或落在 `[0, 1]` 之外——都归一为"由审查者决定"。

<a id="development"></a>
## 开发

```sh
pnpm install
pnpm run typecheck     # tsc --noEmit
pnpm test              # 72 个测试
pnpm run test:coverage # src/ 逐文件 100%
pnpm run build         # lib/（ESM + 声明文件）
```

测试里包含一套同进程级联用例，它驱动**已发布**的 Auto review 包并断言审查者请求次数；还有一套组合用例，用测试专用 `cordis.yml` 通过真实 Loader 启动整条组合链。级联用例同时也是识别标记的漂移探测器：一旦审查者改了它渲染的段标题或策略文本，这些用例会失败，而不是静默地把所有调用退回审查者。

<a id="model-experience"></a>
## 模型体验

### 常规调用快速通路

#### 模型看到什么

System One 模型收到一个 `noul` 问题，以及作为 state 的、部署选中的段——默认是审查者的 `ENVIRONMENT` 与 `PENDING_ACTION` 两段，键名为 `cwd` 与 `pending_action`。它看不到对话历史、看不到工具 schema、也看不到主 agent 的任何指令，返回的是概率而不是文本。

#### Token 影响

每次作答只花很小的 state 对象的输入 token，输出免费。被作答的调用完全不消耗语言模型请求，这正是全部收益；部署可以用 `timeoutMs` 限制开销、用 `cache` 避免重复提问。

#### KV Cache 影响

问题与其评分标准是固定文本，因此每个请求都共享前缀。级联不向主 agent 的请求添加任何内容，因此不会干扰其缓存。

### 审查者升级

#### 模型看到什么

审查者收到的请求与未安装本插件时完全一致：固定的 `REVIEW_POLICY`，以及它从会话推导出的环境、带来源的项目指令、过滤后的历史与待执行动作。级联只转发审查者的问题并读取它的答案，不增、不删、不重排。

#### Token 影响

每次升级调用一次语言模型请求，与审查者自身的契约相同。升级前级联发起的那次 System One 调用是唯一的额外开销，由 `timeoutMs` 限定上限。

#### KV Cache 影响

与单独运行审查者时完全相同，因为该请求逐字节就是审查者为自身构造的那一个。

<a id="known-limitations"></a>
## 已知限制

- 没有 Auto review，本级联就是惰性的：它代答的是审查者的模型调用，而 Auto 预设只在该包被组合、且某个会话选中它时才存在。
- 装上的这一层出厂即惰性：补丁行的 `allowTools` 为空，因此必须先按 id 覆盖该行，才会有调用走快速通路。
- 只有 `low + allow` 这一条路径可达。拒绝、medium 授权以及所有拿不准的情况都留给语言模型审查者，因此本插件不会减少会话看到的拒绝次数。
- 对审查者请求文本的依赖是本包无法用类型表达的耦合：识别读的是审查者渲染的段标题与策略标记。审查者一旦改动渲染方式，所有调用会回到审查者手里——级联测试通过驱动已发布的包来发现这一点。
- `allowTools` 与 `minProbability` 属于你的判断。一个并非真正只读的工具，或者一个定得过低的阈值，都会放行审查者本会质疑的操作。
- System One 模型是第三方托管服务。配置选中的段会离开你的主机，这正是默认只转发环境与待执行动作的原因；选择 `filtered-history` 会连带送出保留下来的对话事实。
- 结论缓存默认关闭，且以工作目录加待执行动作为键，而不是以会话为键：开启后，共享这两者的不同会话之间可能复用同一个结论。
- Auto 下的进程内子代理会审查自己的调用，并以同样条件经过本级联；进程外子代理保留各自的权限体系。
- 本插件针对 DeepSeek Harness `0.1.7-rc.2` 开发。harness 发布的是预发布版本，换用其它运行时可能拒绝声明的 peer 范围。

## 致谢

DeepSeek Harness 及其 Auto review 层是 DeepSeek 的 MIT 许可作品；本插件是独立的附加组件，组合在它们之上，未修改其中任何文件。TypeSafe 的 System One 评测契约——端点、问题类型、答案形态与错误状态码——见 [docs.typesafe.ai/api](https://docs.typesafe.ai/api)。
