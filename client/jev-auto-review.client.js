/**
 * jev-auto-review — 客户端半边
 *
 * 把插件的 volatile 配置渲染进插件管理页的行配置入口：
 *   · 侧栏「插件」→ 已安装 → 本插件 → 行 jev-auto-review → 配置
 *   · 九个可调字段在 Settings 表单投影中即时生效，无需重启
 *   · stats / statsPath 是普通字段，不在本表单中，修改它们需要重启插件
 *
 * 注册通道（官方 web-search 伴随页同款）：
 *   configForms.whileServed([entryId]) → slots.inject('plugins.row.config')
 *   key 为 `<包名>#<行id>`，只有注册存在时行上才出现「配置」入口。
 */
window.__ModuleLoader__.load({
  id: '@deepseek-ai/dsh-experimental-jev-auto-review',
  factory: function (require) {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement

    const PACKAGE = '@deepseek-ai/dsh-experimental-jev-auto-review'
    const ROW_ID = 'jev-auto-review'
    const SLOT_KEY = `${PACKAGE}#${ROW_ID}`
    const NS = 'pluginManager.jevAutoReview'
    /** Loader 行 id 即 Settings 命名空间。 */
    const ENTRY_NS = ROW_ID

    const inject = ['slots', 'locale', 'configForms']

    const FIELDS = [
      { name: 'apiKey', kind: 'secret', label: 'fieldApiKey' },
      { name: 'baseURL', kind: 'text', label: 'fieldBaseURL' },
      { name: 'model', kind: 'text', label: 'fieldModel' },
      { name: 'minProbability', kind: 'slider', label: 'fieldMinProbability', min: 0, max: 1, step: 0.01 },
      { name: 'timeoutMs', kind: 'number', label: 'fieldTimeoutMs', min: 1, integer: true },
      { name: 'cache', kind: 'boolean', label: 'fieldCache' },
      { name: 'cacheMaxEntries', kind: 'number', label: 'fieldCacheMaxEntries', min: 1, integer: true },
      { name: 'stateSections', kind: 'sections', label: 'fieldStateSections' },
      { name: 'allowTools', kind: 'lines', label: 'fieldAllowTools' },
    ]

    const SECTIONS = [
      { id: 'environment', label: 'sectionEnvironment' },
      { id: 'project-instructions', label: 'sectionProjectInstructions' },
      { id: 'filtered-history', label: 'sectionFilteredHistory' },
      { id: 'pending-action', label: 'sectionPendingAction' },
    ]

    /** 字段提示行的词典键：hint 加首字母大写的字段名。 */
    const hintKey = name => `hint${name[0].toUpperCase()}${name.slice(1)}`

    const zh = {
      title: 'Jev 级联审查配置',
      summary: '常规只读调用由 TypeSafe System One 模型直接放行；此处修改即时生效，无需重启。',
      loading: '正在读取配置…',
      unavailable: '配置暂不可读，插件可能未激活。',
      notWritable: '当前 profile 不接受表单编辑，请改用 cordis.patch.yml。',
      saved: '已保存，即时生效。',
      saveFailed: '保存失败：值被拒绝或已被他人修改，已重新读取。',
      fieldApiKey: 'TypeSafe API Key',
      fieldBaseURL: '端点基址',
      fieldModel: 'System One 模型',
      fieldMinProbability: '放行阈值',
      fieldTimeoutMs: '单次调用预算（毫秒）',
      fieldCache: '结论缓存',
      fieldCacheMaxEntries: '缓存条数上限',
      fieldStateSections: '转发的请求段',
      fieldAllowTools: '快速通路工具名单',
      sectionEnvironment: 'environment（环境）',
      sectionProjectInstructions: 'project-instructions（项目指令）',
      sectionFilteredHistory: 'filtered-history（过滤历史）',
      sectionPendingAction: 'pending-action（待执行动作，必须保留）',
      hintApiKey: '留空时读取启动环境变量 TYPESAFE_API_KEY；输入新值即覆盖。',
      hintBaseURL: '程序自动追加 /v1/systemone，默认 https://api.typesafe.ai。',
      hintModel: '默认 jev-latest。',
      hintMinProbability: 'System One 回答为是的概率达到该值才跳过审查者，默认 0.98。',
      hintTimeoutMs: '超时则升级给审查者，默认 800。',
      hintCache: '对完全相同的待执行动作复用结论。',
      hintCacheMaxEntries: '默认 512，仅在开启缓存时生效。',
      hintStateSections: '至少保留 pending-action；filtered-history 最大最敏感，按需开启。',
      hintAllowTools: '每行一个工具名，只放真正只读的工具（如 read、glob、grep）；清空即全量审查。',
      numberInvalid: '请输入有效数值。',
    }

    const en = {
      title: 'Jev auto review configuration',
      summary: 'Routine read-only calls are answered by the TypeSafe System One model; edits here apply immediately, no restart.',
      loading: 'Loading configuration…',
      unavailable: 'Configuration is temporarily unreadable; the plugin may be inactive.',
      notWritable: 'This profile does not accept form edits; use cordis.patch.yml instead.',
      saved: 'Saved; applies immediately.',
      saveFailed: 'Save failed: the value was rejected or changed elsewhere; reloaded.',
      fieldApiKey: 'TypeSafe API key',
      fieldBaseURL: 'Endpoint base',
      fieldModel: 'System One model',
      fieldMinProbability: 'Answer threshold',
      fieldTimeoutMs: 'Per-call budget (ms)',
      fieldCache: 'Verdict cache',
      fieldCacheMaxEntries: 'Cache size bound',
      fieldStateSections: 'Forwarded sections',
      fieldAllowTools: 'Fast-path tool list',
      sectionEnvironment: 'environment',
      sectionProjectInstructions: 'project-instructions',
      sectionFilteredHistory: 'filtered-history',
      sectionPendingAction: 'pending-action (must stay selected)',
      hintApiKey: 'Empty reads $TYPESAFE_API_KEY from the launch environment; a new value overrides it.',
      hintBaseURL: '/v1/systemone is appended; default https://api.typesafe.ai.',
      hintModel: 'Default jev-latest.',
      hintMinProbability: 'A noul yes at or above this probability skips the reviewer; default 0.98.',
      hintTimeoutMs: 'A timeout escalates to the reviewer; default 800.',
      hintCache: 'Reuse a verdict for an identical pending action.',
      hintCacheMaxEntries: 'Default 512; only in effect while the cache is on.',
      hintStateSections: 'Keep at least pending-action; filtered-history is the largest and most sensitive.',
      hintAllowTools: 'One tool name per line, genuinely read-only tools only (read, glob, grep); empty means every call goes to the reviewer.',
      numberInvalid: 'Enter a valid number.',
    }

    /** One field label + hint block. */
    function FieldLabel(props) {
      return h('div', { style: { marginBottom: 4 } },
        h('label', { htmlFor: props.id, style: { display: 'block', fontWeight: 600, fontSize: 13 } }, props.t(props.label)),
        props.hint === undefined ? null
          : h('p', { style: { margin: '2px 0 0', fontSize: 12, opacity: 0.7 } }, props.t(props.hint)),
      )
    }

    const STATUS_STYLE = { margin: '0 0 8px', fontSize: 12 }

    /** One editable field block, closed over its own entry. */
    function FieldBlock(props) {
      const { entry, draft, baseline, disabled, t, onDraft, onCommit } = props
      const id = `jev-config-${entry.name}`

      if (entry.kind === 'secret' || entry.kind === 'text') {
        return h('div', null,
          h(FieldLabel, { id, t, label: entry.label, hint: hintKey(entry.name) }),
          h('input', {
            id,
            type: entry.kind === 'secret' ? 'password' : 'text',
            disabled,
            value: draft === undefined || draft === null ? '' : String(draft),
            placeholder: entry.kind === 'secret' ? t('hintApiKey') : undefined,
            spellCheck: false,
            style: { width: '100%', boxSizing: 'border-box' },
            onChange: event => { onDraft(event.target.value) },
            onBlur: event => {
              const next = event.target.value
              /* 未变更不写；密钥留空不覆盖已配置的值（清空请改 patch 文件） */
              if (next === baseline) return
              if (entry.kind === 'secret' && next.length === 0) return
              onCommit(next)
            },
            onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur() },
          }),
        )
      }

      if (entry.kind === 'slider') {
        const numeric = typeof draft === 'number' && Number.isFinite(draft) ? draft : 0.98
        return h('div', null,
          h(FieldLabel, { id, t, label: entry.label, hint: hintKey(entry.name) }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('input', {
              id,
              type: 'range',
              min: entry.min,
              max: entry.max,
              step: entry.step,
              value: numeric,
              disabled,
              style: { flex: 1 },
              onChange: event => { onDraft(Number(event.target.value)) },
              onMouseUp: event => { onCommit(Number(event.target.value)) },
              onTouchEnd: event => { onCommit(Number(event.target.value)) },
              onKeyUp: event => { onCommit(Number(event.target.value)) },
            }),
            h('code', null, numeric.toFixed(2)),
          ),
        )
      }

      if (entry.kind === 'number') {
        const text = draft === undefined || draft === null ? '' : String(draft)
        return h('div', null,
          h(FieldLabel, { id, t, label: entry.label, hint: hintKey(entry.name) }),
          h('input', {
            id,
            type: 'number',
            min: entry.min,
            step: entry.integer ? 1 : 'any',
            value: text,
            disabled,
            style: { width: 180, boxSizing: 'border-box' },
            onChange: event => { onDraft(event.target.value) },
            onBlur: event => {
              const raw = Number(event.target.value)
              if (event.target.value === '' || !Number.isFinite(raw) || raw < entry.min) {
                onCommit(undefined, 'numberInvalid')
                return
              }
              const next = entry.integer ? Math.trunc(raw) : raw
              if (next === baseline) return
              onCommit(next)
            },
            onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur() },
          }),
        )
      }

      if (entry.kind === 'boolean') {
        return h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 8 } },
          h('input', {
            id,
            type: 'checkbox',
            checked: draft === true,
            disabled,
            style: { marginTop: 3 },
            onChange: event => { onCommit(event.target.checked) },
          }),
          h('div', null,
            h('label', { htmlFor: id, style: { fontWeight: 600, fontSize: 13 } }, t(entry.label)),
            h('p', { style: { margin: '2px 0 0', fontSize: 12, opacity: 0.7 } }, t(hintKey(entry.name))),
          ),
        )
      }

      if (entry.kind === 'sections') {
        const selected = Array.isArray(draft) ? draft : []
        const blocks = [h(FieldLabel, { key: 'label', id, t, label: entry.label, hint: hintKey(entry.name) })]
        SECTIONS.forEach((section, index) => {
          const checked = selected.indexOf(section.id) >= 0
          /* pending-action 与最后一个选中项不可取消：提交也会被 Host 校验拒绝 */
          const locked = section.id === 'pending-action' || (checked && selected.length === 1)
          blocks.push(h('label', {
            key: section.id,
            style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: index === 0 ? 4 : 0 },
          },
            h('input', {
              type: 'checkbox',
              checked,
              disabled: disabled || locked,
              onChange: () => {
                const next = checked
                  ? selected.filter(name => name !== section.id)
                  : selected.concat([section.id])
                onCommit(next)
              },
            }),
            t(section.label),
          ))
        })
        return h('div', null, blocks)
      }

      /* lines：allowTools，每行一个工具名 */
      return h('div', null,
        h(FieldLabel, { id, t, label: entry.label, hint: hintKey(entry.name) }),
        h('textarea', {
          id,
          rows: 4,
          disabled,
          value: Array.isArray(draft) ? draft.join('\n') : '',
          spellCheck: false,
          style: { width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' },
          onChange: event => { onDraft(event.target.value.split('\n')) },
          onBlur: event => {
            const next = event.target.value.split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0)
            const before = Array.isArray(baseline) ? baseline : []
            if (next.length === before.length && next.every((line, index) => line === before[index])) return
            onCommit(next)
          },
        }),
      )
    }

    /**
     * 行配置视图。`view: 'summary'` 渲染一句话；`view: 'page'` 渲染表单。
     * `props.form` 是插件管理页的 ConfigPageForm：{ state: 快照, mutate }。
     * 快照值每次页面渲染直接读取，保存后的新值随宿主重渲染到达。
     */
    function JevConfigView(props) {
      const { t } = props
      if (props.view === 'summary') {
        return h('div', { style: { fontSize: 13, opacity: 0.85 } }, t('summary'))
      }

      const form = props.form
      if (form === undefined) return h('p', { style: STATUS_STYLE }, t('loading'))
      const snapshot = form.state
      if (snapshot === undefined) return h('p', { style: STATUS_STYLE }, t('loading'))
      if (snapshot.status === 'loading') return h('p', { style: STATUS_STYLE }, t('loading'))
      if (snapshot.status === 'unavailable') return h('p', { style: STATUS_STYLE }, t('unavailable'))

      const value = snapshot.value
      if (value === undefined || typeof value !== 'object') return h('p', { style: STATUS_STYLE }, t('loading'))
      const disabled = snapshot.writable === false

      /* 草稿按 revision 重建；一次外部保存会覆盖未提交的本地编辑 */
      const draftsRef = React.useRef(undefined)
      if (draftsRef.current === undefined || draftsRef.current.revision !== snapshot.revision) {
        const fresh = {}
        FIELDS.forEach(field => { fresh[field.name] = value[field.name] })
        draftsRef.current = { revision: snapshot.revision, values: fresh }
      }
      const drafts = draftsRef.current.values
      const force = React.useState(0)[1]
      const statusPair = React.useState('')

      const commit = (name, next, failure) => {
        if (disabled) return
        if (failure !== undefined) {
          statusPair[1](failure)
          return
        }
        Promise.resolve(form.mutate([{ op: 'set', path: [name], value: next }], undefined))
          .then(ok => { statusPair[1](ok ? 'saved' : 'saveFailed') })
      }

      const children = []
      if (statusPair[0] !== '') {
        children.push(h('p', { key: 'status', role: 'status', style: STATUS_STYLE }, t(statusPair[0])))
      }
      if (disabled) {
        children.push(h('p', { key: 'writable', role: 'status', style: STATUS_STYLE }, t('notWritable')))
      }
      FIELDS.forEach((entry, index) => {
        children.push(h('div', { key: entry.name, style: { margin: index === 0 ? '0 0 14px' : '14px 0' } },
          h(FieldBlock, {
            entry,
            draft: drafts[entry.name],
            baseline: value[entry.name],
            disabled,
            t,
            onDraft: next => { draftsRef.current.values[entry.name] = next; force(current => current + 1) },
            onCommit: (next, failure) => { commit(entry.name, next, failure) },
          }),
        ))
      })

      return h('div', null, children)
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'jev-auto-review: dictionaries')

      ctx.effect(() => ctx.configForms.whileServed([ENTRY_NS], () => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
        name: 'plugins.row.config',
        key: SLOT_KEY,
        locale: NS,
        inject: () => ({ t }),
      }, JevConfigView))), 'jev-auto-review: row configuration page')
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
