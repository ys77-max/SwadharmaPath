import { FileUp, Paperclip } from 'lucide-react'
import { useRef, useState } from 'react'
import { Empty, ErrorBox, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { api } from '@/lib/api'
import { useAsync } from '@/lib/useAsync'
import { fmtDate } from '@/lib/utils'
import type { TabProps } from './types'

export default function DocumentsTab({ bundle }: TabProps) {
  const c = bundle.candidate
  const { data, error, loading, reload } = useAsync(() => api.documents(c.id), [c.id])
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setErr(null)
    try {
      for (const f of Array.from(files)) await api.uploadDocument(c.id, f)
      await reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Marksheets, certificates and roadmap evidence. Stored privately; links expire after 15 minutes.</p>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        <Button onClick={() => input.current?.click()} disabled={busy}><FileUp /> {busy ? 'Uploading…' : 'Upload'}</Button>
      </div>
      {err && <ErrorBox error={err} />}
      {data!.length === 0 ? (
        <Empty title="No documents yet" icon={<Paperclip className="size-5" />} />
      ) : (
        <Card>
          <Table>
            <THead><TR><TH>Name</TH><TH>Source</TH><TH>Added</TH><TH>Size</TH><TH /></TR></THead>
            <TBody>
              {data!.map((f) => (
                <TR key={f.path}>
                  <TD className="font-semibold text-pine-900">{f.name}</TD>
                  <TD><Badge variant={f.source === 'evidence' ? 'sand' : 'outline'}>{f.source === 'evidence' ? 'Roadmap evidence' : 'Upload'}</Badge></TD>
                  <TD className="text-sm">{fmtDate(f.created_at)}</TD>
                  <TD className="text-sm">{f.size ? `${Math.round(f.size / 1024)} KB` : '—'}</TD>
                  <TD className="text-right"><Button size="sm" variant="outline" onClick={async () => window.open(await api.documentUrl(f.path), '_blank', 'noopener')}>Open</Button></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
