---
description: "Jev-first cascade for the DeepSeek Harness Auto permission preset: a TypeSafe System One model answers the routine reviewed calls and the language-model reviewer keeps every uncertain one."
---

# jev-auto-review

English | [中文](README.zh.md)

`@deepseek-ai/dsh-experimental-jev-auto-review` puts a cheap judge in front of the [Auto review](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/experimental/auto-review) reviewer that ships with the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It recognizes the reviewer's model call on the `llm/stream` waterfall and answers it from a [TypeSafe](https://typesafe.ai) System One model when the pending action is an ordinary project-local read of a tool the deployment approves. Every other call — an unapproved tool, a low probability, a missing credential, a service failure, a cancellation — delegates to the reviewer unchanged. It never denies and never answers medium or high risk, so the reviewer keeps its policy, its input, and its fail-closed behavior.

## Table of Contents

- [Why](#why)
- [Install](#install)
- [Configure](#configure)
- [How it works](#how-it-works)
- [Development](#development)
- [Model Experience](#model-experience)
- [Known Limitations](#known-limitations)

## Why

Auto review replaces human approval for the calls a language model clears, by asking that model before **every** tool call whether the pending action is authorized. That is a large language-model request per call: a 27-step turn with 30 tool calls pays 30 extra reviewer requests, and the reviewer's own documentation states it does so without caching, retries, truncation, or a small output budget.

Most of those calls are trivial. `read`, `glob`, and `grep` inside the project are exactly the "low risk" class the reviewer's own policy says must be allowed without further authorization. This plugin answers that class with a System One model — a fast, cheap, non-generating classifier — and leaves everything else to the reviewer.

The cascade is deliberately narrow:

| The cascade may | The cascade never |
| --- | --- |
| answer `{"risk":"low","decision":"allow"}` for a tool the deployment lists | deny a call |
| delegate every uncertain case to the reviewer | grant `medium` or `high` |
| forward only the request sections the deployment selects | change the reviewer's prompt, parser, or policy |

## Install

Two layers are involved: the Auto review plugin your harness ships, and this cascade that answers its routine calls. The cascade ships built, so a repository URL installs it as-is:

```sh
dsh plugin --profile web add https://github.com/dezhenxi/jev-auto-review
```

The same URL pastes into **Plugins → Add plugin** in the Web UI. A git install runs no build script and needs no approval, because the repository commits its `lib/` output.

Add the Auto review layer too, from the harness version you run:

```sh
dsh plugin --profile web add @deepseek-ai/dsh-experimental-auto-review@next
```

Both packages declare `dsh.bundle.patch`, so the CLI appends each patch as a profile layer. Select **Auto review** in the composer or the `/permission` picker afterwards; neither layer switches a live session on its own.

Install from a checkout when you are changing the source. Rebuild and commit `lib/` with every source change, or the repository ships stale code:

```sh
git clone https://github.com/dezhenxi/jev-auto-review.git
cd jev-auto-review
pnpm install
pnpm run build

# Auto review, from the harness checkout you already run
dsh plugin --profile web add /path/to/deepseek-harness/packages/experimental/auto-review
dsh plugin --profile web add /path/to/jev-auto-review
```

On Windows, pass absolute paths instead, for example `dsh plugin --profile web add "E:\DeepSeek\jev-auto-review"`.

Remove a layer with the same CLI:

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-experimental-jev-auto-review
```

## Supported DSH versions

| DSH | State |
| --- | --- |
| **0.2.0-rc.2** | Supported. Every seam this plugin uses was checked against the running release: `llm/stream` is still the same waterfall with the same signature, `GenerateOptions` still carries the fields the request matcher reads, and `sessionTelemetry.emit` plus `SessionTelemetryRecord` are unchanged. The declared peer range covers it. |
| **0.1.7-rc.1 / 0.1.7-rc.2** | Supported. The test suite — 85 cases at per-file 100% coverage — runs against this line, and it drives `@deepseek-ai/dsh-experimental-auto-review` for real rather than stubbing it. |
| Anything else | Unverified. A peer mismatch blocks installation; `dsh plugin allow-version <spec> --accept-risk` overrides that check, and the risk is yours. |

The range tracks three seams rather than the whole harness: the `llm/stream` waterfall the cascade answers on, the optional `sessionTelemetry` service it counts verdicts into, and the review request `@deepseek-ai/dsh-experimental-auto-review` renders. A release that changes the reviewer's request text is the one that needs a matching plugin update.

## Configure

The cascade ships **inert**: its own patch row carries an empty `allowTools`, so installing the layer answers no call until a deployment names the tools it trusts. Override the row by id in the profile's `cordis.patch.yml` (`~/.dsh/profiles/web/cordis.patch.yml` for the Web profile):

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

Both configured values are required, because neither a trusted tool list nor a threshold is defensible without your own trace data. Every other field has a documented default:

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKey` | `$TYPESAFE_API_KEY` | TypeSafe credential. Without one the plugin warns once at load and answers nothing. |
| `baseURL` | `https://api.typesafe.ai` | Endpoint base; `/v1/systemone` is appended. |
| `model` | `jev-latest` | System One model id. |
| `allowTools` | — (required) | Tool names the cascade may answer on its own. |
| `minProbability` | — (required) | Probability at or above which a `noul` yes skips the reviewer. |
| `timeoutMs` | `800` | End-to-end budget for one System One call. |
| `cache` | `false` | Reuse a verdict for an identical pending action. |
| `cacheMaxEntries` | `512` | Bound on remembered verdicts. |
| `stateSections` | `["environment","pending-action"]` | Sections of the reviewer's request forwarded as state. |

`minProbability` is a threshold on the model's own probability that the action is a routine read, not a promise of correctness. Calibrate it against your own traffic; a value copied from this README is a guess.

## How it works

The plugin registers one global `llm/stream` listener and nothing else. That waterfall is the documented seam around every model request in the harness, and the reviewer's request is one of them:

```
tool call
  └─ tools/pre-execute chain (hooks, workspace changes, jobs, auto-review)   ← untouched
        └─ auto-review listener
              ├─ reviewer prompt assembled from the session surface
              └─ ctx.llm.stream(review request)
                    └─ llm/stream waterfall
                          ├─ harness stream-grammar invariant (wraps)
                          ├─ jev-auto-review listener              ← the only addition
                          │     ├─ not a review request      → next()
                          │     ├─ tool not in allowTools    → next()
                          │     ├─ ask Jev; probability high → synthesized allow stream
                          │     └─ anything else             → next()
                          └─ the real language-model adapter
              ├─ deny  → denial (unchanged)
              └─ allow → await next()   ← every downstream gate still runs
```

Two properties fall out of that placement:

- **The reviewer keeps its pipeline.** Policy, five-section snapshot, parser, denial text, fail-closed handling, and the Auto preset all stay in the Auto review package. This plugin only changes who answers one inference.
- **Nothing is short-circuited.** Because the reviewer itself calls `next()` when it allows, the hook bridges, workspace-change tracking, and background-job gates registered alongside it keep running. Adding a listener to `tools/pre-execute` instead would have skipped them, which is why this plugin does not.

Recognition is deliberately strict: the request must carry a `system` prompt opening with `REVIEW_POLICY` **and** its first sentence, `temperature: 0`, exactly one user message with exactly one text block, and no tool schemas. A wrong match would replace an unrelated response, so every parse failure abstains rather than guessing.

The TypeSafe request carries one `noul` question and, as its state, only the sections you select. Every failure the client knows about — no key, transport, timeout, cancellation, a status outside 2xx, a body that is not JSON, an answer that is not a `noul` or falls outside `[0, 1]` — resolves to "the reviewer decides".

## Development

```sh
pnpm install
pnpm run typecheck     # tsc --noEmit
pnpm test              # 72 tests
pnpm run test:coverage # per-file 100% on src/
pnpm run build         # lib/ (ESM + declarations)
```

The suites include an in-process cascade suite that drives the **published** Auto review package and asserts the reviewer's request count, and a composition suite that boots a test-only `cordis.yml` through the real Loader. The cascade suite is also the drift detector for the recognition markers: if the reviewer changes the headings or policy text it renders, those tests fail rather than silently returning every call to the reviewer.

## Model Experience

### Routine-call fast path

#### What the model sees

The System One model receives one `noul` question and, as its state, the sections the deployment selected — by default the reviewer's `ENVIRONMENT` and `PENDING_ACTION` sections under the keys `cwd` and `pending_action`. It sees no conversation history, no tool schemas, and no instruction from the main agent, and it returns a probability rather than text.

#### Token effect

Input tokens for one small state object per answered call, and free output. The answered call spends no language-model request at all, which is the entire saving; a deployment can bound the spend with `timeoutMs` and avoid repeat questions with `cache`.

#### KV Cache effect

The question and its criteria are fixed text, so every request shares a prefix. The cascade adds nothing to the main agent's request and therefore cannot disturb its cache.

### Reviewer escalation

#### What the model sees

The reviewer receives exactly the request it would have sent without this plugin installed: its fixed `REVIEW_POLICY` and the environment, sourced project instructions, filtered history, and pending action it derives from the session. The cascade forwards the reviewer's question and reads its answer; it adds, removes, and reorders nothing.

#### Token effect

One language-model request per escalated call, unchanged from the reviewer's own contract. A System One call that the cascade started before escalating is the only added cost, bounded by `timeoutMs`.

#### KV Cache effect

Identical to the reviewer running alone, because the request is byte-for-byte the one the reviewer built for itself.

## Known Limitations

- The cascade is inert without Auto review: it answers the reviewer's model call, and the Auto preset only exists while that package is composed and a session selects it.
- The installed layer ships inert: its patch row carries an empty `allowTools`, so you must override the row by id before any call takes the fast path.
- Only `low + allow` is reachable. Denials, medium-risk grants, and every uncertain case stay with the language-model reviewer, so this plugin cannot reduce the number of denials a session sees.
- The dependency on the reviewer's request text is a coupling this package cannot type: recognition reads the section headings and policy markers the reviewer renders. A reviewer rendering change returns every call to the reviewer, which the cascade suite detects by driving the published package.
- `allowTools` and `minProbability` are your judgment. A tool that is not genuinely read-only, or a threshold set low, authorizes work the reviewer would have questioned.
- The System One model is a third-party hosted service. The configured sections leave your host, which is why the default forwards only the environment and the pending action; selecting `filtered-history` sends your retained conversation facts as well.
- Verdict caching is off by default and keys on the working directory plus the pending action, not on a session: an enabled cache can reuse a verdict across sessions that share both.
- In-process children under Auto review their own calls and pass through this cascade on the same terms; out-of-process children keep their native permission systems.
- Developed against DeepSeek Harness `0.1.7-rc.2`. The harness publishes prereleases, so a different runtime may refuse the declared peer ranges.

## Acknowledgements

The DeepSeek Harness and its Auto review layer are MIT-licensed work by DeepSeek; this plugin is an independent add-on that composes over them and changes none of their files. TypeSafe's System One evaluation contract — endpoint, question types, answer shapes, and error statuses — is documented at [docs.typesafe.ai/api](https://docs.typesafe.ai/api).
