import { Archive, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Empty, ErrorBox, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { api } from '@/lib/api'
import type { ArchiveCandidateRow } from '@/lib/types'
import { useAsync } from '@/lib/useAsync'
import { fmtDate, fmtDateTime } from '@/lib/utils'

const monthsToDays = (m: number) => Math.round((m * 365) / 12)
const daysToMonths = (d: number) => Math.round((d * 12) / 365)
const MIN_MONTHS = 1
const MAX_MONTHS = 120

function monthsAgo(m: number) {
  const d = new Date()
  d.setDate(d.getDate() - monthsToDays(m))
  return d.toISOString().slice(0, 10)
}

function NameList({ rows }: { rows: ArchiveCandidateRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted">None.</p>
  return (
    <ul className="max-h-48 space-y-1 overflow-auto text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex justify-between gap-3">
          <span className="text-pine-900">{r.name ?? 'Unnamed'}</span>
          <span className="text-muted">last active {fmtDate(r.last_activity)}</span>
        </li>
      ))}
    </ul>
  )
}

export default function ArchivePage() {
  const settings = useAsync(() => api.archiveSettings(), [])
  const archived = useAsync(() => api.archived(), [])
  const [auto, setAuto] = useState(false)
  const [candMonths, setCandMonths] = useState(24)
  const [leadMonths, setLeadMonths] = useState(12)
  const [candBefore, setCandBefore] = useState(monthsAgo(24))
  const [leadBefore, setLeadBefore] = useState(monthsAgo(12))
  const [preview, setPreview] = useState<{ candidates: ArchiveCandidateRow[]; leads: ArchiveCandidateRow[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const s = settings.data
    if (!s) return
    setAuto(s.auto_archive)
    setCandMonths(daysToMonths(s.candidate_inactive_days))
    setLeadMonths(daysToMonths(s.lead_inactive_days))
    setCandBefore(monthsAgo(daysToMonths(s.candidate_inactive_days)))
    setLeadBefore(monthsAgo(daysToMonths(s.lead_inactive_days)))
  }, [settings.data])

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    setNote(null)
    try {
      await fn()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const validMonths = (m: number) => Number.isInteger(m) && m >= MIN_MONTHS && m <= MAX_MONTHS
  const total = preview ? preview.candidates.length + preview.leads.length : 0

  return (
    <div>
      <PageHeader
        title="Archive"
        subtitle="Move inactive cases and leads out of day-to-day lists. Nothing is deleted: reports, the audit log and consent records stay, and you can restore any time."
      />
      {err && <ErrorBox error={err} className="mb-4" />}
      {note && <div className="mb-4 rounded-lg border border-ok/30 bg-ok/5 p-3 text-sm text-ok" role="status">{note}</div>}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Timeframe</CardTitle>
            <CardDescription>
              A case counts as inactive when nothing has happened for this long: no session, assessment, roadmap update, report or outcome.
              Cases with a session booked, and leads that are paid or active, are never archived.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {settings.loading && !settings.data ? <Loading /> : settings.error ? <ErrorBox error={settings.error} /> : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Candidates inactive for (months)">
                    <Input type="number" min={MIN_MONTHS} max={MAX_MONTHS} value={candMonths} onChange={(e) => setCandMonths(Number(e.target.value))} />
                  </Field>
                  <Field label="Leads inactive for (months)">
                    <Input type="number" min={MIN_MONTHS} max={MAX_MONTHS} value={leadMonths} onChange={(e) => setLeadMonths(Number(e.target.value))} />
                  </Field>
                </div>
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block font-semibold text-pine-900">Archive automatically every night</span>
                    <span className="text-sm text-muted">
                      {settings.data?.last_auto_run_at ? `Last ran ${fmtDateTime(settings.data.last_auto_run_at)}` : 'Off until you turn it on.'}
                    </span>
                  </span>
                  <Switch checked={auto} onCheckedChange={setAuto} aria-label="Archive automatically every night" />
                </label>
                <Button
                  disabled={busy || !validMonths(candMonths) || !validMonths(leadMonths)}
                  onClick={() => act(async () => {
                    await api.saveArchiveSettings({ auto_archive: auto, candidate_inactive_days: monthsToDays(candMonths), lead_inactive_days: monthsToDays(leadMonths) })
                    await settings.reload()
                    setNote('Archive settings saved.')
                  })}
                >
                  Save
                </Button>
                {(!validMonths(candMonths) || !validMonths(leadMonths)) && <p className="text-sm text-danger">Use whole months from {MIN_MONTHS} to {MAX_MONTHS}.</p>}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Archive now</CardTitle>
            <CardDescription>Pick cutoff dates (at least 30 days ago), preview who would move, then confirm.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Candidates last active before">
                <Input type="date" value={candBefore} max={monthsAgo(1)} onChange={(e) => { setCandBefore(e.target.value); setPreview(null) }} />
              </Field>
              <Field label="Leads last active before">
                <Input type="date" value={leadBefore} max={monthsAgo(1)} onChange={(e) => { setLeadBefore(e.target.value); setPreview(null) }} />
              </Field>
            </div>
            <Button variant="outline" disabled={busy || !candBefore || !leadBefore} onClick={() => act(async () => setPreview(await api.archivePreview(candBefore, leadBefore)))}>
              Preview
            </Button>
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-2 text-lg font-bold text-pine-900">Archived</h2>
      {archived.loading && !archived.data ? <Loading /> : archived.error ? <ErrorBox error={archived.error} /> : !archived.data?.length ? (
        <Empty title="Nothing archived" icon={<Archive className="size-5" />} />
      ) : (
        <Table>
          <THead><TR><TH>Name</TH><TH>Type</TH><TH>Archived</TH><TH /></TR></THead>
          <TBody>
            {archived.data.map((r) => (
              <TR key={`${r.entity}-${r.id}`}>
                <TD className="font-semibold text-pine-900">{r.name ?? 'Unnamed'}</TD>
                <TD><Badge variant="outline">{r.entity === 'candidate' ? 'Candidate' : 'Lead'}</Badge></TD>
                <TD className="text-sm">{fmtDate(r.archived_at)}</TD>
                <TD>
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => act(async () => { await api.restoreArchived(r.entity, r.id); await archived.reload(); setNote(`${r.name ?? 'Entry'} restored.`) })}>
                    <RotateCcw /> Restore
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-xl">
          <DialogTitle>{total ? `Archive ${preview?.candidates.length} candidate(s) and ${preview?.leads.length} lead(s)?` : 'Nothing to archive'}</DialogTitle>
          <DialogDescription>
            {total ? 'They leave caseloads, reminders and matching. Nothing is deleted, and you can restore them from this page.' : 'No one has been inactive since before those dates.'}
          </DialogDescription>
          {preview && total > 0 && (
            <div className="mt-4 space-y-3">
              <div><div className="mb-1 text-sm font-semibold text-pine-900">Candidates</div><NameList rows={preview.candidates} /></div>
              <div><div className="mb-1 text-sm font-semibold text-pine-900">Leads</div><NameList rows={preview.leads} /></div>
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <DialogClose asChild><Button variant="ghost">{total ? 'Back' : 'Close'}</Button></DialogClose>
            {total > 0 && (
              <Button variant="danger" disabled={busy}
                onClick={() => act(async () => {
                  const r = await api.archiveInactive(candBefore, leadBefore)
                  setPreview(null)
                  await archived.reload()
                  setNote(`Archived ${r.candidates} candidate(s) and ${r.leads} lead(s).`)
                })}>
                Archive
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
