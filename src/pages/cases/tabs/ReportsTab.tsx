import { Download, FileText, Loader2, Lock } from 'lucide-react'
import { useState } from 'react'
import { ErrorBox, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { api } from '@/lib/api'
import { REPORT_KINDS } from '@/lib/constants'
import type { ReportKind, Visibility } from '@/lib/types'
import { useAsync } from '@/lib/useAsync'
import { fmtDateTime } from '@/lib/utils'
import type { TabProps } from './types'

const VIS_LABEL: Record<Visibility, string> = { counsellor: 'Counsellor only', candidate: 'Candidate', parent: 'Parent', all: 'Candidate + parent' }

export default function ReportsTab({ bundle }: TabProps) {
  const c = bundle.candidate
  const { data, error, loading, reload } = useAsync(() => api.reports(c.id), [c.id])
  const [vis, setVis] = useState<Record<string, Visibility>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} />
  const kinds = (Object.keys(REPORT_KINDS) as ReportKind[]).filter((k) => REPORT_KINDS[k].tracks.includes(c.track) && (k !== 'swadharma' || c.swadharma_opted_in))
  const lockedKind = (k: ReportKind) => k === 'case_file' || k === 'swadharma'
  const defaultVis = (k: ReportKind): Visibility => (lockedKind(k) ? 'counsellor' : k === 'parent' ? 'parent' : 'candidate')

  const generate = async (k: ReportKind) => {
    setBusy(k)
    setErr(null)
    try { await api.requestReport(c.id, k, vis[k] ?? defaultVis(k)); await reload() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const download = async (id: string) => {
    setErr(null)
    try { window.open(await api.reportUrl(id), '_blank', 'noopener') } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Generate</CardTitle>
          <CardDescription>Each generation is a new version; earlier versions are kept. PDFs render in the worker and download through 15-minute signed links.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kinds.map((k) => (
            <div key={k} className="flex flex-col justify-between gap-3 rounded-xl border border-line p-4">
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-pine-900">{REPORT_KINDS[k].label}{lockedKind(k) && <Lock className="size-3.5 text-saffron-600" />}</div>
                <div className="text-xs text-muted">{REPORT_KINDS[k].who}</div>
              </div>
              <div className="flex gap-2">
                <Select className="h-9 text-sm" value={vis[k] ?? defaultVis(k)} disabled={lockedKind(k)} onChange={(e) => setVis({ ...vis, [k]: e.target.value as Visibility })} aria-label="Visible to">
                  {lockedKind(k) ? <option value="counsellor">Counsellor only</option> : (['candidate', 'parent', 'all', 'counsellor'] as Visibility[]).map((v) => <option key={v} value={v}>{VIS_LABEL[v]}</option>)}
                </Select>
                <Button size="sm" variant="secondary" onClick={() => generate(k)} disabled={busy !== null}>{busy === k ? <Loader2 className="animate-spin" /> : <FileText />} Generate</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      {err && <ErrorBox error={err} />}
      <Card>
        <CardHeader className="flex-row items-center justify-between"><CardTitle>Versions</CardTitle><Button size="sm" variant="ghost" onClick={reload}>Refresh</Button></CardHeader>
        <Table>
          <THead><TR><TH>Report</TH><TH>Version</TH><TH>Created</TH><TH>Visible to</TH><TH>Status</TH><TH /></TR></THead>
          <TBody>
            {data!.length === 0 && <TR><TD colSpan={6} className="text-center text-sm text-muted">No reports yet.</TD></TR>}
            {data!.map((r) => (
              <TR key={r.id}>
                <TD className="font-semibold text-pine-900">{REPORT_KINDS[r.kind].label}</TD>
                <TD>v{r.version}</TD>
                <TD className="text-sm">{fmtDateTime(r.created_at)}</TD>
                <TD><Badge variant={r.visible_to === 'counsellor' ? 'lock' : 'default'}>{VIS_LABEL[r.visible_to]}</Badge></TD>
                <TD>{r.pdf_path ? <Badge variant="ok">Ready</Badge> : <Badge variant="warn"><Loader2 className="size-3 animate-spin" /> Rendering</Badge>}</TD>
                <TD className="text-right">{r.pdf_path && <Button size="sm" variant="outline" onClick={() => download(r.id)}><Download /> Download</Button>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  )
}
