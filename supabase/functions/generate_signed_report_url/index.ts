// generate_signed_report_url — returns a 15-minute signed URL for a report PDF.
// Visibility is decided by RLS: the report is looked up with the caller's own
// JWT, so a candidate only gets a URL for a report the policies let them see
// (e.g. a Swadharma report only after it has been released).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { corsHeaders, json } from '../_shared/cors.ts'

const URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const TTL_SECONDS = 15 * 60

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'not signed in' }, 401)
  const { report_id: reportId } = await req.json().catch(() => ({}))
  if (!reportId) return json({ error: 'report_id is required' }, 400)

  const asUser = createClient(URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: user } = await asUser.auth.getUser()
  if (!user.user) return json({ error: 'not signed in' }, 401)

  const { data: report, error } = await asUser.from('reports').select('id, kind, version, pdf_path').eq('id', reportId).maybeSingle()
  if (error) return json({ error: error.message }, 500)
  if (!report) return json({ error: 'report not found' }, 404) // also when RLS hides it
  if (!report.pdf_path) return json({ error: 'report is still being generated' }, 409)

  const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: signed, error: sErr } = await admin.storage.from('reports').createSignedUrl(report.pdf_path, TTL_SECONDS, {
    download: `swadharmapath-${report.kind}-v${report.version}.pdf`,
  })
  if (sErr) return json({ error: sErr.message }, 500)

  await asUser.from('audit_log').insert({ actor: user.user.id, action: 'report_download', entity: 'reports', entity_id: report.id, detail: { kind: report.kind, version: report.version } })
  return json({ url: signed.signedUrl, expires_in: TTL_SECONDS })
})
