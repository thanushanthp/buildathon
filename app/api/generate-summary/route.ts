import { GoogleGenerativeAI } from "@google/generative-ai"
import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"

// ─── Firebase Admin init ────────────────────────────────────────────────────────

function getAdminDb() {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    })
  }
  return getFirestore()
}

// ─── Types ──────────────────────────────────────────────────────────────────────

type Snapshot = {
  round?: number
  got_it: number
  slightly_lost: number
  confused: number
  interesting: number
  total: number
}

type RequestBody = {
  sessionId: string
  snapshots: Snapshot[]
  sessionTitle: string
  courseCode: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

// ─── Build prompt ──────────────────────────────────────────────────────────────

function buildPrompt(
  courseCode: string,
  sessionTitle: string,
  snapshots: Snapshot[]
): string {
  const n = snapshots.length
  let totalConfusion = 0
  let peakConfusionIdx = 0
  let peakConfusionPct = 0
  let peakInterestIdx = 0
  let peakInterestPct = 0
  const lines: string[] = []

  snapshots.forEach((s, i) => {
    const label = s.round != null ? `Round ${s.round}` : `Round ${i + 1}`
    const confPct = s.total > 0 ? (s.confused + s.slightly_lost) / s.total : 0
    const intPct  = s.total > 0 ? s.interesting / s.total : 0

    totalConfusion += confPct
    if (confPct > peakConfusionPct) { peakConfusionPct = confPct; peakConfusionIdx = i }
    if (intPct  > peakInterestPct)  { peakInterestPct  = intPct;  peakInterestIdx  = i }

    lines.push(
      `${label}: got_it=${s.got_it}, slightly_lost=${s.slightly_lost}, confused=${s.confused}, interesting=${s.interesting}, total_students=${s.total}`
    )
  })

  const avgConfusionPct = Math.round((totalConfusion / n) * 100)
  const peakConfusionLabel = snapshots[peakConfusionIdx].round != null
    ? `Round ${snapshots[peakConfusionIdx].round}` : `Round ${peakConfusionIdx + 1}`
  const peakInterestLabel = snapshots[peakInterestIdx].round != null
    ? `Round ${snapshots[peakInterestIdx].round}` : `Round ${peakInterestIdx + 1}`

  const totalStudents = Math.max(...snapshots.map(s => s.total))

  return `You are an expert teaching assistant writing a post-session feedback report for a university professor.

Session details:
- Course: ${courseCode}
- Topic: "${sessionTitle}"
- Total rounds recorded: ${n} (each round = 2 minutes of live feedback)
- Total students: ${totalStudents}
- Average confusion rate: ${avgConfusionPct}%
- Round with most confusion: ${peakConfusionLabel} (${Math.round(peakConfusionPct * 100)}% of students confused or lost)
- Round with most interest: ${peakInterestLabel} (${Math.round(peakInterestPct * 100)}% found it interesting)

Signal data per round:
${lines.join("\n")}

IMPORTANT: Write a complete, detailed post-session report with exactly 4 paragraphs separated by blank lines. Do NOT truncate or summarize — write the full report. Do NOT use bullet points, headers, or asterisks. Do NOT echo back the data format above.

Paragraph 1 — Overall engagement: Describe how engaged and focused the class was. Mention total students, how confusion levels looked across rounds, and whether the session went well overall.

Paragraph 2 — Confusion analysis: Identify which rounds had the most confusion and interpret what that likely means about the content pacing or difficulty. Give a specific pedagogical interpretation even if only one round of data exists.

Paragraph 3 — Interest and momentum: Describe which parts of the session generated curiosity or interest signals, and what that tells the professor about the material. If interest was low, explain what that might mean and how to build it.

Paragraph 4 — Concrete recommendation: Give one specific, actionable recommendation for the next class based on the data. Name what to revisit, how to approach it (e.g. worked example, pair discussion, quick recap poll), and why the data supports this.

Write warmly and professionally, as a thoughtful colleague reviewing the session. Reference the actual numbers and round labels from the data above.`
}
// ─── Route handler ───────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body: RequestBody = await req.json()
    const { sessionId, snapshots, sessionTitle, courseCode } = body

    if (!sessionId || !sessionTitle || !courseCode) {
      return Response.json({ error: "Missing required fields" }, { status: 400 })
    }

    const db = getAdminDb()

    // ── No data edge case — write immediately and return ──────────────────────
    if (!snapshots || snapshots.length === 0) {
      await db.collection("sessions").doc(sessionId).update({
        aiSummary:
          "The session ended before any round snapshots were recorded. " +
          "Run the session for at least one full 2-minute round to generate insights.",
      })
      return Response.json({ success: true })
    }

    // ── Build prompt (single pass, no blocking work) ───────────────────────────
    const prompt = buildPrompt(courseCode, sessionTitle, snapshots)

    // ── Call Gemini ───────────────────────────────────────────────────────────
    // generateContent is faster than streaming for short outputs because
    // there is no chunked-response overhead. We do NOT await the Firestore
    // write — we fire it and return immediately so the client unblocks.
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({
      model: "gemini-3.6-flash",        // fastest publicly available model
      generationConfig: {
        maxOutputTokens: 1024,           // hard cap — stops the model padding
        temperature: 0.5,              // lower = less rambling = faster finish
      },
    })

    const result = await model.generateContent(prompt)
    const summary = result.response.text().trim()

    // ── Write to Firestore + respond in parallel ──────────────────────────────
    // We don't await the DB write before sending the HTTP response.
    // The onSnapshot listener on the admin page will pick up the change
    // the moment Firestore commits — typically within 200–400 ms.
    const writePromise = db.collection("sessions").doc(sessionId).update({
      aiSummary: summary,
    })

    // Return to the caller immediately; Firestore write finishes in background.
    // waitUntil keeps the serverless function alive long enough for the write.
    // If your runtime doesn't support waitUntil, just await writePromise instead.
    try {
      // @ts-ignore — available in Next.js edge & Node runtimes via AsyncContext
      const ctx = (globalThis as any).__requestContext
      if (ctx?.waitUntil) {
        ctx.waitUntil(writePromise)
      } else {
        await writePromise
      }
    } catch {
      await writePromise
    }

    return Response.json({ success: true, summary })

  } catch (error) {
    console.error("generate-summary error:", error)
    return Response.json({ error: "Failed to generate summary" }, { status: 500 })
  }
}