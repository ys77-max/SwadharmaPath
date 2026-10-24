# Admin guide

For agency administrators. Your home page is **/admin**. Navigation: Dashboard | Leads | Counsellors | Library | Instruments | Templates | Archive.

> Last updated 2026-10-24. Procedures are in the [Operations SOPs](../sops/operations-sops.md) and [Technical SOPs](../sops/technical-sops.md).

## 1. Dashboard (/admin)

| Widget | Source | Meaning |
|---|---|---|
| Funnel | `v_funnel` | Leads by stage and track, total and last 30 days |
| Revenue | lead stage `paid` | Manual paid flag in V1 |
| Counsellor utilisation | `v_counsellor_utilisation` | Active candidates, sessions and attended minutes in 30 days |
| Report turnaround | `v_tat` | Days from last completed assessment to first candidate-facing report; pending count |
| NPS | survey responses | Net promoter score |
| Outcomes | `v_outcomes` | Per 6/12/24-month checkpoint: count, % in top 5, average satisfaction |

## 2. Leads (/admin/leads)

Pipeline board with stages **new → contacted → discovery → paid → active → completed** (or **lost**).

1. Open a new lead and assign a counsellor.
2. Set the next follow-up date.
3. Move the card as the conversation progresses. Mark **paid** when payment is received (manual flag).
4. Convert to a candidate: create the candidate account, link the lead, assign the counsellor and, for minors, link the parent account.

The public form is rate-limited: the same phone or email can submit 3 times an hour, and the whole form accepts 30 enquiries a minute.

## 3. Users and roles

- There is no public sign-up screen. Every new account starts as a candidate until an admin changes its role.
- To create a counsellor or admin, add or invite the user in Supabase (**Authentication → Users → Add user**) and then change their role. Only an admin can change a role, and the change is enforced in the database.

### 3.1 Demo cases
For training and testing, the technical owner can load demo cases: a demo counsellor, six candidates from Class 9 to mid-career with completed assessments, and two fresh test candidates whose assessments you take yourself ([SOP-T9](../sops/technical-sops.md#sop-t9-demo-cases)). They show in **Cases** like real ones; their names start with "Demo" or "Test". Ask for them to be removed before real families start.

## 4. Counsellors (/admin/counsellors)
Caseload and report SLA per counsellor. Reassign candidates when someone is overloaded or on leave.

## 5. Careers & streams library (/admin/careers, /admin/streams)

The library holds about 150 careers across all 15 families (professional, government, creative, vocational and skilled trades) and stream options for CBSE, CISCE (ISC), state boards, NIOS, IB and Cambridge, plus the polytechnic and ITI routes after Class 10. Early explorers only see the streams of the board on their case, plus polytechnic and ITI.

The **Library** page lists every career and stream with its **last reviewed** date. Entries never reviewed, or not reviewed in 90 days, are flagged in amber. Seed content is marked "seed – verify before launch" and should be reviewed with the first refresh.

### 5.1 Refresh with AI (quarterly, one click)

1. Choose what to refresh: **Careers and streams**, **Careers** or **Streams**.
2. Click **Refresh now**. You land on the review page; the check takes about 15 to 30 minutes for the full library. You can leave the page; admins get a notification when it is ready (or if it failed).
3. The system checks each entry against current Indian sources (exam bodies, regulators, labour data) and suggests changes with a short reason and links to its sources. Only fields that would change are shown.
4. This also runs on its own on **1 January, April, July and October**. If the AI key is not set up, you get a reminder instead.

### 5.2 Correct by spreadsheet (CSV)

1. Click **Careers CSV** or **Streams CSV** to download the current library.
2. Edit it in Excel or Google Sheets. Keep the heading row. Lists are separated with semicolons (for example `English; Physics; Chemistry`). Salary band, minimum aptitude and pathways are JSON; leave them alone unless you are comfortable editing JSON.
3. An **empty cell keeps the current value**. To add a new career or stream, add a row with an **empty id**; a new career needs at least name, family, RIASEC code and outlook.
4. Click **Upload edited CSV** (2 MB maximum). The page recognises whether it is the careers or streams file. Rows with problems are listed under "Notes from the check" and skipped; the rest become suggested changes.

### 5.3 Review and apply

On the review page (`/admin/library/runs/…`):

1. For each suggestion, compare **Now** and **Suggested**, read the reason and open the sources if needed.
2. Click **Approve** or **Reject**. Click again to undo. **Approve all** approves everything still undecided.
3. Click **Apply N approved** and confirm. Approved changes are written, every entry in the refresh is marked **reviewed today** (whether it changed or not), and undecided suggestions are skipped.
4. Candidates' career and stream matches are then recalculated within a few minutes. Counsellors' pinned, hidden, added and published choices are kept.
5. **Cancel refresh** closes a run without changing anything. Only one refresh can be open at a time.

Every request, cancellation and apply is recorded in the audit log, and the sources are saved on each changed entry.

## 7. Instruments (/admin/instruments)
Manage versions, upload norms and **activate** an instrument version. Only active versions are served. Test items, scoring keys and norms are never sent to candidates' browsers. See [SOP-O9](../sops/operations-sops.md#sop-o9-instrument-version-change).

## 8. Templates (/admin/templates)
Roadmap templates and session-note templates (by ICCC stage).

## 9. Archive (/admin/archive)

Archiving moves inactive candidates and leads out of caseloads, reminders, matching and lead lists. **Nothing is deleted**: reports, sessions, consent, Swadharma records and the audit log stay as they are, and you can restore any time.

### 9.1 Set the timeframe

1. Under **Timeframe**, enter how many months without activity count as inactive, separately for candidates (default 24) and leads (default 12). Use 1 to 120 months.
2. Activity means sign-up, an assessment, a session, a roadmap update, a report or an outcome (for leads: creation or the follow-up date).
3. Turn on **Archive automatically every night** if you want the system to archive with this timeframe at 02:30 IST. It is off until you turn it on. Click **Save**.

### 9.2 Archive now

1. Under **Archive now**, pick the cutoff dates (they must be at least 30 days ago). They start from your timeframe.
2. Click **Preview** to see exactly who would move and when each was last active.
3. Click **Archive** to confirm.

Candidates with a session booked, and leads that are **paid** or **active**, are never archived.

### 9.3 Restore

The **Archived** list shows everything archived and when. Click **Restore** to bring a candidate or lead back; they reappear in caseloads and lists straight away. An archived candidate cannot start an assessment until restored.

## 10. Audit
Admins can read the audit log (consents, disclaimer acceptances, Swadharma releases, library refreshes, archiving and restores). No one, including admins, can edit or delete audit entries or Swadharma releases.
