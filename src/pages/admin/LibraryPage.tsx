import { Download, RefreshCw, Sparkles, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Empty, ErrorBox, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { detectCsv, MAX_CSV_BYTES, toCsv } from '@/lib/libraryCsv'
import type { LibraryEntity, LibraryRow, RefreshRun, RefreshScope } from '@/lib/types'
import { useAsync } from '@/lib/useAsync'
import { daysUntil, fmtDate, fmtDateTime } from '@/lib/utils'

export const REVIEW_DAYS = 90
const OPEN: RefreshRun['status'][] = ['queued', 'running', 'review']

export const SCOPE_LABEL: Record<RefreshScope, string> = { all: 'Careers and streams', careers: 'Careers', streams: 'Streams' }
export const SOURCE_LABEL: Record<RefreshRun['source'], string> = { ai: 'AI draft', csv: 'CSV upload', scheduled: 'Quarterly (AI)' }

export function RunStatus({ status }: { status: RefreshRun['status'] }) {
  const map: Record<RefreshRun['status'], [string, 'default' | 'warn' | 'ok' | 'danger' | 'outline' | 'sand']> = {
    queued: ['Queued', 'sand'], running: ['Checking sources…', 'sand'], review: ['Ready to review', 'warn'],
    applied: ['Applied', 'ok'], failed: ['Failed', 'danger'], cancelled: ['Cancelled', 'outline'],
  }
  const [label, variant] = map[status]
  return <Badge variant={variant}>{label}</Badge>
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function Reviewed({ on }: { on?: string | null }) {
  const age = on ? -(daysUntil(on) ?? 0) : null
  if (age === null) return <Badge variant="warn">Never reviewed</Badge>
  return age > REVIEW_DAYS ? <Badge variant="warn">{fmtDate(on)}</Badge> : <span className="text-sm text-muted">{fmtDate(on)}</span>
}

function LibraryList({ entity, rows }: { entity: LibraryEntity; rows: LibraryRow[] }) {
  if (!rows.length) return <Empty title="Nothing in the library yet" />
  return (
    <Table>
      <THead>
        <TR>
          <TH>Name</TH>
          <TH>{entity === 'career' ? 'Family' : 'Board'}</TH>
          {entity === 'career' && <TH>Outlook</TH>}
          <TH>Last reviewed</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD className="font-semibold text-pine-900">{r.name}</TD>
            <TD className="text-sm">{String((entity === 'career' ? r.family : r.board) ?? '—')}</TD>
            {entity === 'career' && <TD className="text-sm capitalize">{String(r.outlook ?? '—')}</TD>}
            <TD><Reviewed on={r.last_reviewed} /></TD>
          </TR>
        ))}
      </TBody>
    </Table>
  )
}

export default function LibraryPage({ tab = 'career' }: { tab?: LibraryEntity }) {
  const navigate = useNavigate()
  const careers = useAsync(() => api.libraryRows('career'), [])
  const streams = useAsync(() => api.libraryRows('stream'), [])
  const runs = useAsync(() => api.refreshRuns(), [])
  const [scope, setScope] = useState<RefreshScope>('all')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const open = runs.data?.find((r) => OPEN.includes(r.status))

  // The worker picks a run up within a minute; refresh the list while it works.
  const reloadRuns = runs.reload
  const polling = !!open && open.status !== 'review'
  useEffect(() => {
    if (!polling) return
    const t = setInterval(reloadRuns, 10_000)
    return () => clearInterval(t)
  }, [polling, reloadRuns])

  async function start(source: 'ai' | 'csv', s: RefreshScope, csv?: string) {
    setBusy(true)
    setErr(null)
    try {
      const id = await api.requestLibraryRefresh(s, source, csv)
      navigate(`/admin/library/runs/${id}`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function exportCsv(entity: LibraryEntity) {
    setErr(null)
    try {
      const rows = await api.libraryRows(entity)
      download(`swadharmapath-${entity === 'career' ? 'careers' : 'streams'}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(entity, rows))
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function upload(f: File | undefined) {
    if (file.current) file.current.value = ''
    if (!f) return
    if (f.size > MAX_CSV_BYTES) return setErr('That file is larger than 2 MB. Upload the careers and streams files separately.')
    const text = await f.text()
    const kind = detectCsv(text)
    if ('error' in kind) return setErr(kind.error)
    await start('csv', kind.entity === 'career' ? 'careers' : 'streams', text)
  }

  return (
    <div>
      <PageHeader
        title="Careers & streams library"
        subtitle={`What counsellors and matching use. Review it every quarter; entries not reviewed in ${REVIEW_DAYS} days are flagged.`}
      />
      {err && <ErrorBox error={err} className="mb-4" />}

      {open && (
        <Card className="mb-6 border-saffron-400/60 bg-saffron-400/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
            <div>
              <div className="flex items-center gap-2 font-bold text-pine-900">
                {SOURCE_LABEL[open.source]} · {SCOPE_LABEL[open.scope]} <RunStatus status={open.status} />
              </div>
              <p className="text-sm text-muted">
                {open.status === 'review'
                  ? `${open.summary.proposals ?? 0} suggested change(s) are waiting for you.`
                  : 'The worker is checking each entry. This page updates on its own; you can leave it.'}
              </p>
            </div>
            <Button asChild variant={open.status === 'review' ? 'default' : 'outline'}>
              <Link to={`/admin/library/runs/${open.id}`}>{open.status === 'review' ? 'Review changes' : 'Open'}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sparkles className="size-5 text-saffron-500" /> Refresh with AI</CardTitle>
            <CardDescription>
              Checks every entry against current Indian sources (exam bodies, regulators, labour data) and drafts changes with citations.
              Nothing changes until you approve it. Also runs on its own on 1 January, April, July and October.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Select aria-label="What to refresh" value={scope} onChange={(e) => setScope(e.target.value as RefreshScope)} className="w-auto">
              {(Object.keys(SCOPE_LABEL) as RefreshScope[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
            </Select>
            <Button onClick={() => start('ai', scope)} disabled={busy || !!open}>
              <RefreshCw /> Refresh now
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Correct by spreadsheet</CardTitle>
            <CardDescription>
              Download the library, edit it in Excel or Google Sheets, and upload it. Leave a cell empty to keep it; clear the id to add a new
              entry. You review the changes before they apply.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => exportCsv('career')}><Download /> Careers CSV</Button>
            <Button variant="outline" onClick={() => exportCsv('stream')}><Download /> Streams CSV</Button>
            <Button variant="secondary" onClick={() => file.current?.click()} disabled={busy || !!open}><Upload /> Upload edited CSV</Button>
            <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-2 text-lg font-bold text-pine-900">Refresh history</h2>
      {runs.loading && !runs.data ? <Loading /> : runs.error ? <ErrorBox error={runs.error} /> : !runs.data?.length ? (
        <Empty title="No refreshes yet">Click Refresh now, or upload an edited CSV.</Empty>
      ) : (
        <Table className="mb-8">
          <THead>
            <TR><TH>Started</TH><TH>Source</TH><TH>Scope</TH><TH>Status</TH><TH>Result</TH><TH /></TR>
          </THead>
          <TBody>
            {runs.data.map((r) => (
              <TR key={r.id}>
                <TD className="text-sm">{fmtDateTime(r.created_at)}</TD>
                <TD className="text-sm">{SOURCE_LABEL[r.source]}</TD>
                <TD className="text-sm">{SCOPE_LABEL[r.scope]}</TD>
                <TD><RunStatus status={r.status} /></TD>
                <TD className="max-w-xs truncate text-sm text-muted">
                  {r.status === 'failed' ? r.error : r.status === 'applied' ? `${r.summary.applied ?? 0} applied` : r.summary.proposals != null ? `${r.summary.proposals} suggested` : ''}
                </TD>
                <TD><Link className="text-sm font-semibold text-pine-700 hover:underline" to={`/admin/library/runs/${r.id}`}>Open</Link></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="career">Careers {careers.data && `(${careers.data.length})`}</TabsTrigger>
          <TabsTrigger value="stream">Streams {streams.data && `(${streams.data.length})`}</TabsTrigger>
        </TabsList>
        <TabsContent value="career">
          {careers.loading && !careers.data ? <Loading /> : careers.error ? <ErrorBox error={careers.error} /> : <LibraryList entity="career" rows={careers.data ?? []} />}
        </TabsContent>
        <TabsContent value="stream">
          {streams.loading && !streams.data ? <Loading /> : streams.error ? <ErrorBox error={streams.error} /> : <LibraryList entity="stream" rows={streams.data ?? []} />}
        </TabsContent>
      </Tabs>
    </div>
  )
}
