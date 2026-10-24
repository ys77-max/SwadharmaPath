-- Test fixtures (run as postgres after the migration).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test', '{"full_name":"Asha Admin","role":"admin"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test',    '{"full_name":"Chitra Counsellor"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@test',    '{"full_name":"Kabir Counsellor"}'),
  ('00000000-0000-0000-0000-0000000000d1', 'minor@test', '{"full_name":"Meera Minor"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'adult@test', '{"full_name":"Arjun Adult"}'),
  ('00000000-0000-0000-0000-0000000000e1', 'parent@test','{"full_name":"Priya Parent","role":"parent"}');

-- self-signup can't claim admin: the trigger made them a candidate; promote here
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.users set role = 'counsellor' where id in ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2');

insert into public.candidates (id, user_id, track, board, dob, counsellor_id, parent_user_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', 'early_explorer', 'CBSE',
   current_date - interval '14 years', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000d2', 'student', 'CBSE',
   current_date - interval '19 years', '00000000-0000-0000-0000-0000000000c1', null);

insert into public.birth_details (candidate_id, birth_date, birth_time, time_certainty, birth_place, lat, lng, tz, consent_given_by, consent_at, consent_text_version)
values ('10000000-0000-0000-0000-000000000002', current_date - interval '19 years', '06:30', 'exact', 'Pune', 18.52, 73.85, 'Asia/Kolkata',
        '00000000-0000-0000-0000-0000000000d2', now(), 'v1');
update public.candidates set swadharma_opted_in = true where id = '10000000-0000-0000-0000-000000000002';

insert into public.swadharma_charts (candidate_id, ayanamsa, d1, computed_at, engine_version)
values ('10000000-0000-0000-0000-000000000002', 'lahiri', '{"lagna":"Leo"}', now(), 'test');
insert into public.swadharma_scores (id, candidate_id, career_family, points, components, confidence)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Engineering & Technology', 72, '{"d10":18}', 'high');

insert into public.career_matches (candidate_id, career_id, fit_score, breakdown, rank, visible_to_candidate)
select '10000000-0000-0000-0000-000000000002', id, 80 - rn, jsonb_build_object('interest', 30, 'swadharma', 55), rn, rn <= 3
from (select id, row_number() over (order by name) as rn from public.careers) c where rn <= 5;

insert into public.sessions (candidate_id, counsellor_id, scheduled_at, mode, iccc_stage, notes_private, summary_for_candidate)
values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1', now() - interval '2 days', 'video', 'know_self',
        'PRIVATE: family pressure towards medicine', 'We explored your interests.');

insert into public.roadmaps (id, candidate_id, template, status)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'ug', 'published');
insert into public.roadmap_items (id, roadmap_id, kind, title, due_date, owner) values
  ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'task', 'Shortlist 5 colleges', current_date + 10, 'candidate'),
  ('31000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'exam', 'Register for CUET', current_date - 3, 'candidate');

insert into public.profile_summary (candidate_id, interest_vector, narrative)
values ('10000000-0000-0000-0000-000000000002', array[0.2,0.9,0.4,0.3,0.5,0.6], '{"strengths":["Curious"]}');
