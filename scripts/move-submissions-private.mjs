/**
 * One-time move: makes existing contact messages and WhatsApp requests private.
 *
 * Sanity documents whose ID contains a dot (e.g. "private.<random id>") can't be
 * read without a token, even in a public dataset. This copies every existing
 * contactSubmission and subscriber document to a "private." ID, with all its
 * fields (status, admin notes, dates), then deletes the old public copy and any
 * unpublished draft of it. Each document moves in one transaction, so it's never
 * lost or duplicated.
 *
 * Dry run (default) only lists what would move:
 *   node --env-file=.env.local scripts/move-submissions-private.mjs
 * Apply:
 *   node --env-file=.env.local scripts/move-submissions-private.mjs --apply
 *
 * Needs SANITY_PROJECT_ID, SANITY_DATASET (default "production") and SANITY_WRITE_TOKEN.
 */
const projectId = process.env.SANITY_PROJECT_ID
const dataset = process.env.SANITY_DATASET || 'production'
const token = process.env.SANITY_WRITE_TOKEN
const apply = process.argv.includes('--apply')
const API = `https://${projectId}.api.sanity.io/v2025-02-19/data`

if (!projectId || !token) {
  console.error('Missing SANITY_PROJECT_ID or SANITY_WRITE_TOKEN. Run with: node --env-file=.env.local ...')
  process.exit(1)
}

const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

async function query(groq) {
  const url = new URL(`${API}/query/${dataset}`)
  url.searchParams.set('query', groq)
  url.searchParams.set('perspective', 'raw') // see drafts too, so nothing is left behind
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`Query failed (${res.status}): ${await res.text()}`)
  return (await res.json()).result
}

async function mutate(mutations) {
  const res = await fetch(`${API}/mutate/${dataset}`, { method: 'POST', headers, body: JSON.stringify({ mutations }) })
  if (!res.ok) throw new Error(`Change failed (${res.status}): ${await res.text()}`)
  return res.json()
}

// Published documents of the two types that still have a public ID
const docs = await query(
  `*[_type in ["contactSubmission", "subscriber"] && !(_id in path("private.**")) && !(_id in path("drafts.**")) && !(_id in path("versions.**"))]`,
)
// Drafts of those documents (unpublished edits in Studio)
const draftIds = new Set(
  await query(`*[_type in ["contactSubmission", "subscriber"] && _id in path("drafts.**")]._id`),
)

const label = { contactSubmission: 'Contact message', subscriber: 'WhatsApp request' }
console.log(`${docs.length} document(s) to make private${apply ? '' : ' (dry run, nothing changed)'}:`)

let moved = 0
for (const doc of docs) {
  const { _id, _rev, _createdAt, _updatedAt, ...fields } = doc
  const newId = `private.${crypto.randomUUID()}`
  const draftId = `drafts.${_id}`
  console.log(`- ${label[doc._type] ?? doc._type} from ${fields.submittedAt ?? _createdAt ?? 'unknown date'}${draftIds.has(draftId) ? ' (has an unpublished draft, which is dropped)' : ''}`)
  if (!apply) continue

  const mutations = [{ create: { ...fields, _id: newId } }, { delete: { id: _id } }]
  if (draftIds.has(draftId)) mutations.push({ delete: { id: draftId } })
  await mutate(mutations)
  moved++
}

if (apply) {
  const left = await query(
    `count(*[_type in ["contactSubmission", "subscriber"] && !(_id in path("private.**")) && !(_id in path("drafts.private.**"))])`,
  )
  console.log(`\nMoved ${moved}. Still public: ${left}.`)
}
