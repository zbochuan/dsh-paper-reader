// dsh-paper-reader — browser half.
//
// Registers a PDF renderer for dsh's right-sidebar document preview. It takes
// precedence over the built-in PDF renderer (priority "extension"), and the
// preview's own dropdown can still switch back to the built-in one. The viewer
// itself lives in reader/viewer.js, served by the host half under /paper-reader;
// questions are posted to /paper-reader/api/ask, which sends them into the
// session that owns the sidebar tab.

window.__ModuleLoader__.load({
  // Must equal the npm package name: the loader expects registration under it.
  id: '@zbochuan/dsh-paper-reader',
  factory: (require) => {
    const React = require('react')
    const { useEffect, useRef, useState } = React
    const h = React.createElement

    const BASE = '/paper-reader'
    const BODY_ID = '@zbochuan/dsh-paper-reader/pdf'

    /** `dsh-resource://file/session/<sessionId>/<path>` → { sessionId, path } */
    function parseAddress(address) {
      const m = /^dsh-resource:\/\/file\/session\/([^/]+)\/(.+)$/.exec(String(address || ''))
      if (!m) return null
      const dec = (s) => {
        try {
          return decodeURIComponent(s)
        } catch {
          return s
        }
      }
      return { sessionId: dec(m[1]), path: m[2].split('/').map(dec).join('/') }
    }

    function ensureStyles() {
      if (document.getElementById('dpr-viewer-css')) return
      const link = document.createElement('link')
      link.id = 'dpr-viewer-css'
      link.rel = 'stylesheet'
      link.href = `${BASE}/static/viewer.css`
      document.head.appendChild(link)
    }

    async function ask(file, q) {
      if (!file) throw new Error('这个文件不在会话的工作区里，没法发送到对话')
      const res = await fetch(`${BASE}/api/ask`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...q, sessionId: file.sessionId, file: file.path }),
      })
      let body = {}
      try {
        body = await res.json()
      } catch {}
      if (!res.ok) throw new Error(body.error || `发送失败（HTTP ${res.status}）`)
    }

    function PaperPdfBody(props) {
      const { tab } = props.useTabInfo()
      const data = props.content && props.content.kind === 'bytes' ? props.content.data : undefined
      const address = props.resourceAddress
      const ref = useRef(null)
      const [error, setError] = useState('')

      useEffect(() => {
        if (!data || !ref.current || (tab.signal && tab.signal.aborted)) return
        ensureStyles()
        let disposed = false
        let handle
        const file = parseAddress(address)
        import(/* @vite-ignore */ `${BASE}/static/viewer.js`)
          .then((m) => {
            if (disposed) return
            handle = m.mountViewer(ref.current, {
              data,
              pdfjsUrl: `${BASE}/vendor/pdf.min.mjs`,
              workerUrl: `${BASE}/vendor/pdf.worker.min.mjs`,
              storageKey: `dpr.highlights.${address}`,
              askTargetLabel: '对话',
              ask: (q) => ask(file, q),
            })
          })
          .catch((err) => {
            console.error('[dsh-paper-reader] viewer failed to load', err)
            if (!disposed) setError('论文伴读加载失败，可以在上方下拉框切回默认的 PDF 预览。')
          })
        return () => {
          disposed = true
          if (handle) handle.dispose()
        }
      }, [data, address, tab.signal])

      if (!data) return h('p', { role: 'alert', style: { padding: '16px', fontSize: '13px' } }, '无法读取这个 PDF。')
      return h(
        React.Fragment,
        null,
        error ? h('p', { role: 'alert', style: { padding: '16px', fontSize: '13px' } }, error) : null,
        h('div', { ref, 'data-dsh-plugin': 'dsh-paper-reader' }),
      )
    }

    return {
      inject: ['slots', 'documentPreviews'],
      apply(ctx) {
        try {
          ctx.effect(() =>
            ctx.documentPreviews.register({
              id: BODY_ID,
              extensions: ['pdf'],
              binaryExtensions: ['pdf'],
              priority: 'extension',
              title: () => '论文伴读',
              loading: 'bytes-complete',
              wrap: false,
            }),
          )
          ctx.effect(() =>
            ctx.slots.inject('sidebar.right.tab.document', () =>
              ctx.slots.register({ name: 'sidebar.right.tab.document', key: BODY_ID }, PaperPdfBody),
            ),
          )
        } catch (e) {
          console.error('[dsh-paper-reader] client apply failed:', e)
        }
      },
    }
  },
})
