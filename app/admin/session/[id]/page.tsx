"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter, useParams } from "next/navigation"
import {
  doc,
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore"
import { onAuthStateChanged } from "firebase/auth"
import { auth, db } from "@/lib/firebase"
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts"
import {
  Wifi,
  StopCircle,
  Copy,
  Check,
  ArrowLeft,
  TrendingUp,
} from "lucide-react"

// ─── Types ─────────────────────────────────────────────────────────────────────

type SignalType = "got_it" | "slightly_lost" | "confused" | "interesting"

type SignalCounts = {
  got_it: number
  slightly_lost: number
  confused: number
  interesting: number
}

type Session = {
  id: string
  adminId: string
  title: string
  courseCode: string
  joinCode: string
  status: "active" | "ended"
  createdAt: any
  startedAt: any
  endedAt: any
  aiSummary: string | null
  participantCount: number
}

type SignalDoc = {
  studentId: string
  signal: SignalType
  round: number
  timestamp: any
}

type RoundSnapshot = {
  round: number
  got_it: number
  slightly_lost: number
  confused: number
  interesting: number
  total: number
  confusion: number
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const RESET_INTERVAL_MS = 2 * 60 * 1000

const SIGNAL_CONFIG: Record<SignalType, { label: string; color: string; emoji: string }> = {
  got_it:        { label: "Got it",        color: "#22c55e", emoji: "✅" },
  slightly_lost: { label: "Slightly lost", color: "#f59e0b", emoji: "🤔" },
  confused:      { label: "Confused",      color: "#ef4444", emoji: "❓" },
  interesting:   { label: "Interesting",   color: "#8b5cf6", emoji: "🔥" },
}

const EMPTY_COUNTS: SignalCounts = {
  got_it: 0,
  slightly_lost: 0,
  confused: 0,
  interesting: 0,
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getRoomState(counts: SignalCounts, total: number) {
  if (total === 0) return "waiting"
  const pct = (counts.confused + counts.slightly_lost) / total
  if (pct > 0.5) return "red"
  if (pct > 0.25) return "yellow"
  return "green"
}

type RoomState = "waiting" | "green" | "yellow" | "red"

const ROOM_STATE_CONFIG: Record<RoomState, { label: string; color: string; dot: string }> = {
  waiting: { label: "Waiting for students",  color: "text-white/40",    dot: "bg-white/20"    },
  green:   { label: "Room is following",     color: "text-emerald-400", dot: "bg-emerald-400" },
  yellow:  { label: "Some confusion",        color: "text-amber-400",   dot: "bg-amber-400"   },
  red:     { label: "Significant confusion", color: "text-red-400",     dot: "bg-red-400"     },
}

// ─── Latest signal per student per round ───────────────────────────────────────

function aggregateSignals(docs: SignalDoc[]) {
  const maxRound = docs.reduce((m, d) => Math.max(m, d.round ?? 1), 1)
  const latestPerStudent = new Map<string, SignalType>()

  docs
    .filter((d) => (d.round ?? 1) === maxRound)
    .sort((a, b) => (a.timestamp?.toMillis?.() ?? 0) - (b.timestamp?.toMillis?.() ?? 0))
    .forEach((d) => latestPerStudent.set(d.studentId, d.signal))

  const counts = { ...EMPTY_COUNTS }
  latestPerStudent.forEach((s) => { if (counts[s] !== undefined) counts[s]++ })

  return { counts, uniqueStudents: latestPerStudent.size, currentRound: maxRound }
}

// ─── Build per-round snapshots from raw signal docs ────────────────────────────

function buildRoundSnapshots(docs: SignalDoc[]): RoundSnapshot[] {
  const byRound = new Map<number, SignalDoc[]>()
  docs.forEach((d) => {
    const r = d.round ?? 1
    if (!byRound.has(r)) byRound.set(r, [])
    byRound.get(r)!.push(d)
  })

  return Array.from(byRound.keys())
    .sort((a, b) => a - b)
    .map((round) => {
      const latestPerStudent = new Map<string, SignalType>()
      byRound.get(round)!
        .sort((a, b) => (a.timestamp?.toMillis?.() ?? 0) - (b.timestamp?.toMillis?.() ?? 0))
        .forEach((d) => latestPerStudent.set(d.studentId, d.signal))

      const counts = { ...EMPTY_COUNTS }
      latestPerStudent.forEach((s) => { if (counts[s] !== undefined) counts[s]++ })
      const total = latestPerStudent.size

      return {
        round,
        ...counts,
        total,
        confusion: total > 0
          ? Math.round(((counts.confused + counts.slightly_lost) / total) * 100)
          : 0,
      }
    })
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function AdminSessionPage() {
  const router = useRouter()
  const params = useParams()
  const sessionId = params.id as string

  const [user, setUser] = useState<any>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [signalCounts, setSignalCounts] = useState<SignalCounts>(EMPTY_COUNTS)
  const [participantCount, setParticipantCount] = useState(0)
  const [currentRound, setCurrentRound] = useState(1)
  const [roundSnapshots, setRoundSnapshots] = useState<RoundSnapshot[]>([])
  const [ending, setEnding] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loadingSession, setLoadingSession] = useState(true)
  const [summaryLoading, setSummaryLoading] = useState(false)

  const allSignalDocsRef = useRef<SignalDoc[]>([])
  const roundSnapshotsRef = useRef<RoundSnapshot[]>([])
  const signalCountsRef = useRef(signalCounts)
  const currentRoundRef = useRef(currentRound)

  useEffect(() => { signalCountsRef.current = signalCounts }, [signalCounts])
  useEffect(() => { currentRoundRef.current = currentRound }, [currentRound])
  useEffect(() => { roundSnapshotsRef.current = roundSnapshots }, [roundSnapshots])

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) { router.push("/login"); return }
      setUser(u)
    })
    return () => unsub()
  }, [])

  // ── Session doc ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return
    const unsub = onSnapshot(doc(db, "sessions", sessionId), (snap) => {
      if (!snap.exists()) { router.push("/admin/dashboard"); return }
      setSession({ id: snap.id, ...snap.data() } as Session)
      setLoadingSession(false)
    })
    return () => unsub()
  }, [sessionId])

  // ── Live signal aggregation ─────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || !session) return
    const q = query(collection(db, "signals"), where("sessionId", "==", sessionId))
    const unsub = onSnapshot(q, (snapshot) => {
      const docs: SignalDoc[] = snapshot.docs.map((d) => ({
        studentId: d.data().studentId as string,
        signal: d.data().signal as SignalType,
        round: (d.data().round as number) ?? 1,
        timestamp: d.data().timestamp,
      }))

      allSignalDocsRef.current = docs

      const { counts, uniqueStudents, currentRound } = aggregateSignals(docs)
      const perRound = buildRoundSnapshots(docs)

      setSignalCounts(counts)
      setParticipantCount(uniqueStudents)
      setCurrentRound(currentRound)
      setRoundSnapshots(perRound)

      updateDoc(doc(db, "sessions", sessionId), {
        participantCount: uniqueStudents,
      }).catch(() => {})
    })
    return () => unsub()
  }, [sessionId, session?.status])

  // ── Snapshot writer at round boundaries ────────────────────────────────────
  useEffect(() => {
    if (!sessionId || session?.status !== "active" || !session?.startedAt) return

    const startedAtMs = session.startedAt.toMillis()

    const writeRoundSnapshot = async (round: number) => {
      const docs = allSignalDocsRef.current
      const roundDocs = docs.filter((d) => (d.round ?? 1) === round)
      const latestPerStudent = new Map<string, SignalType>()
      roundDocs
        .sort((a, b) => (a.timestamp?.toMillis?.() ?? 0) - (b.timestamp?.toMillis?.() ?? 0))
        .forEach((d) => latestPerStudent.set(d.studentId, d.signal))
      const counts = { ...EMPTY_COUNTS }
      latestPerStudent.forEach((s) => { if (counts[s] !== undefined) counts[s]++ })
      await addDoc(collection(db, "sessions", sessionId, "snapshots"), {
        timestamp: serverTimestamp(),
        round,
        ...counts,
        total: latestPerStudent.size,
      }).catch(() => {})
    }

    const elapsed = Date.now() - startedAtMs
    const msIntoCurrentRound = elapsed % RESET_INTERVAL_MS
    const msUntilNextBoundary = RESET_INTERVAL_MS - msIntoCurrentRound
    let roundAtLastWrite = Math.floor(elapsed / RESET_INTERVAL_MS) + 1

    const timeout = setTimeout(() => {
      writeRoundSnapshot(roundAtLastWrite)
      roundAtLastWrite++
      const interval = setInterval(() => {
        writeRoundSnapshot(roundAtLastWrite)
        roundAtLastWrite++
      }, RESET_INTERVAL_MS)
      return () => clearInterval(interval)
    }, msUntilNextBoundary)

    return () => clearTimeout(timeout)
  }, [sessionId, session?.status, session?.startedAt])

  // ── End session ─────────────────────────────────────────────────────────────
  const handleEndSession = async () => {
    if (!session || ending) return
    setEnding(true)
    setSummaryLoading(true)

    const allDocs = allSignalDocsRef.current
    const allRoundSnapshots = buildRoundSnapshots(allDocs)

    // Write final Firestore snapshot for current round
    const round = currentRoundRef.current
    const roundDocs = allDocs.filter((d) => (d.round ?? 1) === round)
    const latestPerStudent = new Map<string, SignalType>()
    roundDocs
      .sort((a, b) => (a.timestamp?.toMillis?.() ?? 0) - (b.timestamp?.toMillis?.() ?? 0))
      .forEach((d) => latestPerStudent.set(d.studentId, d.signal))
    const counts = { ...EMPTY_COUNTS }
    latestPerStudent.forEach((s) => { if (counts[s] !== undefined) counts[s]++ })

    await addDoc(collection(db, "sessions", sessionId, "snapshots"), {
      timestamp: serverTimestamp(),
      round,
      ...counts,
      total: latestPerStudent.size,
    }).catch(() => {})

    await updateDoc(doc(db, "sessions", sessionId), {
      status: "ended",
      endedAt: serverTimestamp(),
    })

    // Build snapshots for API — fall back to live counts if no rounds recorded
    const currentCounts = signalCountsRef.current
    const currentTotal = Object.values(currentCounts).reduce((a, b) => a + b, 0)

    const snapshotsForApi = allRoundSnapshots.length > 0
      ? allRoundSnapshots.map((s) => ({
          round: s.round,
          got_it: s.got_it,
          slightly_lost: s.slightly_lost,
          confused: s.confused,
          interesting: s.interesting,
          total: s.total,
        }))
      : [{
          round: 1,
          got_it: currentCounts.got_it,
          slightly_lost: currentCounts.slightly_lost,
          confused: currentCounts.confused,
          interesting: currentCounts.interesting,
          total: currentTotal,
        }]

    console.log("snapshotsForApi:", JSON.stringify(snapshotsForApi, null, 2))
    console.log("allSignalDocsRef length:", allSignalDocsRef.current.length)
    console.log("signalCountsRef:", signalCountsRef.current)

    try {
      await fetch("/api/generate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          snapshots: snapshotsForApi,
          sessionTitle: session.title,
          courseCode: session.courseCode,
        }),
      })
    } catch (e) {
      console.error("Summary generation failed:", e)
    }

    setSummaryLoading(false)
    setEnding(false)
  }
  // ── Copy join code ──────────────────────────────────────────────────────────
  const handleCopy = () => {
    if (!session) return
    navigator.clipboard.writeText(session.joinCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ─── Derived ────────────────────────────────────────────────────────────────

  const total = Object.values(signalCounts).reduce((a, b) => a + b, 0)
  const roomState = getRoomState(signalCounts, total) as RoomState
  const roomConfig = ROOM_STATE_CONFIG[roomState]

  const pieData = (Object.keys(SIGNAL_CONFIG) as SignalType[])
    .map((key) => ({ name: SIGNAL_CONFIG[key].label, value: signalCounts[key], color: SIGNAL_CONFIG[key].color }))
    .filter((d) => d.value > 0)

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loadingSession) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return null

  const isEnded = session.status === "ended"

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">

      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/admin/dashboard")} className="text-white/40 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
            <Wifi className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">{session.title}</p>
            <p className="text-white/30 text-xs">{session.courseCode}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {!isEnded && <span className="text-white/30 text-xs">Round {currentRound}</span>}
          <div className={`flex items-center gap-2 text-sm font-medium ${roomConfig.color}`}>
            <span className={`w-2 h-2 rounded-full ${roomConfig.dot} ${roomState === "green" ? "animate-pulse" : ""}`} />
            {roomConfig.label}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">

        {/* Join code + student count */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.02] p-6 flex flex-col gap-2">
            <p className="text-xs uppercase tracking-widest text-white/30 font-semibold">Join Code</p>
            <div className="flex items-center gap-4">
              <span className="text-6xl font-black tracking-widest text-white">{session.joinCode}</span>
              {!isEnded && (
                <button onClick={handleCopy} className="text-white/30 hover:text-white transition-colors">
                  {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
                </button>
              )}
            </div>
            {!isEnded && <p className="text-xs text-white/30">Students go to the app and enter this code</p>}
          </div>
          <div className="sm:w-48 rounded-2xl border border-white/10 bg-white/[0.02] p-6 flex flex-col gap-1 justify-center">
            <p className="text-xs uppercase tracking-widest text-white/30 font-semibold">Students</p>
            <p className="text-5xl font-black">{participantCount}</p>
            <p className="text-xs text-white/30">
              {total > 0 ? `${total} signals this round` : "No signals yet"}
            </p>
          </div>
        </div>

        {/* Signal distribution */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-widest text-white/30 font-semibold">Live Signal Distribution</p>
            {!isEnded && <span className="text-xs text-white/20">Round {currentRound} · updates live</span>}
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="w-48 h-48 shrink-0">
              {total === 0 ? (
                <div className="w-full h-full rounded-full border-4 border-white/5 flex items-center justify-center">
                  <p className="text-white/20 text-xs text-center px-4">Waiting for signals</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", fontSize: "12px" }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="flex-1 w-full space-y-3">
              {(Object.keys(SIGNAL_CONFIG) as SignalType[]).map((key) => {
                const config = SIGNAL_CONFIG[key]
                const count = signalCounts[key]
                const pct = total > 0 ? Math.round((count / total) * 100) : 0
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-white/70">
                        <span>{config.emoji}</span>{config.label}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {count}
                        <span className="text-white/30 font-normal ml-1 text-xs">{total > 0 ? `${pct}%` : ""}</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: config.color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Confusion trend */}
        {roundSnapshots.length > 1 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-white/30" />
              <p className="text-xs uppercase tracking-widest text-white/30 font-semibold">Confusion Across Rounds</p>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={roundSnapshots}>
                <XAxis dataKey="round" tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 11 }} tickLine={false} axisLine={false} label={{ value: "round", position: "insideBottomRight", fill: "rgba(255,255,255,0.2)", fontSize: 10 }} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                <Tooltip contentStyle={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", fontSize: "12px" }} formatter={(v) => [`${v}%`, "Confusion"]} labelFormatter={(l) => `Round ${l}`} />
                <Line type="monotone" dataKey="confusion" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: "#ef4444" }} activeDot={{ r: 5, fill: "#ef4444" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* AI Summary */}
        {isEnded && (
          <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-6 space-y-4">
            <p className="text-xs uppercase tracking-widest text-violet-400 font-semibold">AI Insight Report</p>
            {summaryLoading || !session.aiSummary ? (
              <div className="flex items-center gap-3 text-white/40 text-sm">
                <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                Generating insights...
              </div>
            ) : (
              <div className="space-y-4">
                {session.aiSummary
                  .split("\n\n")
                  .filter((p) => p.trim().length > 0)
                  .map((paragraph, i) => (
                    <p key={i} className="text-white/70 text-sm leading-relaxed">
                      {paragraph.trim()}
                    </p>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* End session */}
        {!isEnded && (
          <div className="flex justify-end pb-8">
            <button
              onClick={handleEndSession}
              disabled={ending}
              className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 text-red-400 hover:text-red-300 transition-all px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <StopCircle className="w-4 h-4" />
              {ending ? "Ending session..." : "End Session"}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}