// score_instrument — called by the assessment_completed trigger (pg_net, service
// role) or by the candidate's client for instant results. Scores one session
// with the shared scorer and writes assessment_results. Profile building,
// matching and reports stay in the worker.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { corsHeaders, json } from '../_shared/cors.ts'
import { ageBand, SCORING_VERSION, scoreSession, type Section } from '../_shared/scoring.ts'

const URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let sessionId: string | undefined
  try {
    sessionId = (await req.json()).session_id
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (!sessionId) return json({ error: 'session_id is required' }, 400)

  const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } })
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')

  const { data: session, error: sErr } = await admin
    .from('assessment_sessions')
    .select('id, candidate_id, instrument_id, status, responses, completed_at, candidates(user_id, dob, track)')
    .eq('id', sessionId)
    .maybeSingle()
  if (sErr) return json({ error: sErr.message }, 500)
  if (!session) return json({ error: 'session not found' }, 404)

  // Service role (the database trigger) may score anything; a user only their own session.
  if (token !== SERVICE_KEY) {
    const userClient = createClient(URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } })
    const { data: u } = await userClient.auth.getUser()
    const cand = session.candidates as unknown as { user_id: string } | null
    if (!u.user || u.user.id !== cand?.user_id) return json({ error: 'forbidden' }, 403)
  }
  if (session.status !== 'completed') return json({ error: 'session is not completed' }, 409)

  // Idempotent: a retry after a successful score returns the existing result.
  const { data: existing } = await admin
    .from('assessment_results')
    .select('id, percentiles, derived, validity_flags')
    .eq('candidate_id', session.candidate_id)
    .eq('instrument_id', session.instrument_id)
    .gte('scored_at', session.completed_at)
    .limit(1)
    .maybeSingle()
  if (existing) return json({ result: existing, cached: true })

  const { data: inst, error: iErr } = await admin
    .from('instruments')
    .select('items, scoring_spec, norms, track_variant')
    .eq('id', session.instrument_id)
    .single()
  if (iErr) return json({ error: iErr.message }, 500)

  const cand = session.candidates as unknown as { dob: string | null }
  const { _meta, ...responses } = (session.responses ?? {}) as Record<string, { a: unknown; rt?: number }>
  void _meta
  let out
  try {
    out = scoreSession({
      items: inst.items as { sections: Section[] },
      scoring_spec: inst.scoring_spec,
      norms: inst.norms,
      responses,
      ageBand: ageBand(cand?.dob ?? null),
      variant: inst.track_variant,
    })
  } catch (e) {
    return json({ error: `scoring failed: ${(e as Error).message}` }, 422)
  }

  const { data: row, error: wErr } = await admin
    .from('assessment_results')
    .insert({ candidate_id: session.candidate_id, instrument_id: session.instrument_id, ...out, scoring_version: SCORING_VERSION })
    .select('id, percentiles, derived, validity_flags')
    .single()
  if (wErr) return json({ error: wErr.message }, 500)
  return json({ result: row })
})
