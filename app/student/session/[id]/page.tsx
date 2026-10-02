"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useRouter, useParams } from "next/navigation"
import {
  doc,
  addDoc,
  collection,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore"
import { onAuthStateChanged } from "firebase/auth"
import { auth, db } from "@/lib/firebase"
import { Wifi, LogOut } from "lucide-react"

// ─── Types ─────────────────────────────────────────────────────────────────────

type SignalType = "got_it" | "slightly_lost" | "confused" | "interesting"

type Session = {
  id: string
  title: string
  courseCode: string
  joinCode: string
  status: "active" | "ended"
  startedAt?: { toMillis: () => number } // Firestore Timestamp
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const RESET_INTERVAL_MS = 2 * 60 * 1000 // 2 minutes

const SIGNALS: {
  key: SignalType
  emoji: string
  label: string
  sublabel: string
  color: string
  bg: string
  border: string
  activeBg: string
}[] = [
  {
    key: "got_it",
    emoji: "✅",
    label: "Got it",
    sublabel: "Following along clearly",
    color: "text-emerald-400",
    bg: "bg-emerald-500/5",
    border: "border-emerald-500/20",
    activeBg: "bg-emerald-500/20 border-emerald-500/60",
  },
  {
    key: "slightly_lost",
    emoji: "🤔",
    label: "Slightly lost",
    sublabel: "Could use a slower pace",
    color: "text-amber-400",
    bg: "bg-amber-500/5",
    border: "border-amber-500/20",
    activeBg: "bg-amber-500/20 border-amber-500/60",
  },
  {
    key: "confused",
    emoji: "❓",
    label: "Confused",
    sublabel: "Need this explained again",
    color: "text-red-400",
    bg: "bg-red-500/5",
    border: "border-red-500/20",
    activeBg: "bg-red-500/20 border-red-500/60",
  },
  {
    key: "interesting",
    emoji: "🔥",
    label: "Interesting",
    sublabel: "Want to explore this more",
    color: "text-violet-400",
    bg: "bg-violet-500/5",
    border: "border-violet-500/20",
    activeBg: "bg-violet-500/20 border-violet-500/60",
  },
]

// ─── Helper: compute current round + secondsLeft from session startedAt ────────
// All students share the same clock because they all derive round from
// the session's startedAt timestamp stored in Firestore — not from when
// they personally joined.
function computeRoundState(startedAtMs: number): {
  roundNumber: number
  secondsLeft: number
} {
  const elapsed = Date.now() - startedAtMs
  const roundNumber = Math.floor(elapsed / RESET_INTERVAL_MS) + 1
  const msIntoCurrentRound = elapsed % RESET_INTERVAL_MS
  const secondsLeft = Math.ceil(
    (RESET_INTERVAL_MS - msIntoCurrentRound) / 1000
  )
  return { roundNumber, secondsLeft }
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function StudentSessionPage() {
  const router = useRouter()
  const params = useParams()
  const sessionId = params.id as string

  const [user, setUser] = useState<any>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [activeSignal, setActiveSignal] = useState<SignalType | null>(null)
  const [sending, setSending] = useState(false)
  const [loadingSession, setLoadingSession] = useState(true)

  // Round state — derived from session.startedAt, not local timers
  const [roundNumber, setRoundNumber] = useState(1)
  const [secondsLeft, setSecondsLeft] = useState(RESET_INTERVAL_MS / 1000)
  const [tappedThisRound, setTappedThisRound] = useState(false)

  // Refs for use inside intervals/callbacks without stale closures
  const userRef = useRef<any>(null)
  const roundNumberRef = useRef(1)
  const activeSignalRef = useRef<SignalType | null>(null)
  const startedAtMsRef = useRef<number | null>(null)

  useEffect(() => { userRef.current = user }, [user])
  useEffect(() => {
    roundNumberRef.current = roundNumber
  }, [roundNumber])
  useEffect(() => {
    activeSignalRef.current = activeSignal
  }, [activeSignal])

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) { router.push("/login"); return }
      setUser(u)
    })
    return () => unsub()
  }, [])

  // ── Watch session doc ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return
    const unsub = onSnapshot(doc(db, "sessions", sessionId), (snap) => {
      if (!snap.exists()) { router.push("/student/join"); return }
      const data = snap.data()
      const sessionData = { id: snap.id, ...data } as Session
      setSession(sessionData)
      setLoadingSession(false)

      // Sync startedAt ref so the tick interval can use it
      if (data.startedAt) {
        startedAtMsRef.current = data.startedAt.toMillis()
      }
    })
    return () => unsub()
  }, [sessionId])

  // ── Master tick — runs every second, derives everything from startedAt ──────
  // This means a student joining mid-session immediately lands on the
  // correct round and sees the correct countdown — no drift, no mismatch.
  useEffect(() => {
    if (!session || session.status === "ended") return

    const tick = () => {
      const startedAtMs = startedAtMsRef.current
      if (!startedAtMs) return

      const { roundNumber: newRound, secondsLeft: newSeconds } =
        computeRoundState(startedAtMs)

      setSecondsLeft(newSeconds)

      // When round number changes, reset per-round UI state
      setRoundNumber((prevRound) => {
        if (newRound !== prevRound) {
          // New round just started — clear signal and tapped flag
          setActiveSignal(null)
          activeSignalRef.current = null
          setTappedThisRound(false)
        }
        return newRound
      })

      roundNumberRef.current = newRound
    }

    // Run once immediately so UI doesn't wait a second on mount
    tick()

    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [session?.status, session?.startedAt])

  // ── Write signal ────────────────────────────────────────────────────────────
  const writeSignal = useCallback(
    async (signal: SignalType, round: number) => {
      const u = userRef.current
      if (!u || !sessionId) return
      setSending(true)
      try {
        await addDoc(collection(db, "signals"), {
          sessionId,
          studentId: u.uid,
          signal,
          round,
          timestamp: serverTimestamp(),
        })
      } catch (e) {
        console.error("Failed to write signal:", e)
      } finally {
        setSending(false)
      }
    },
    [sessionId]
  )

  // ── Tap handler ─────────────────────────────────────────────────────────────
  const sendSignal = async (signal: SignalType) => {
    if (!session || session.status === "ended") return
    setActiveSignal(signal)
    setTappedThisRound(true)
    await writeSignal(signal, roundNumberRef.current)
  }

  const handleLeave = () => router.push("/student/join")

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (loadingSession) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return null

  const isEnded = session.status === "ended"
  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const countdownLabel = `${mins}:${secs.toString().padStart(2, "0")}`
  const countdownPct = (secondsLeft / (RESET_INTERVAL_MS / 1000)) * 100

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0f1117] text-white flex flex-col">

      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
            <Wifi className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">{session.title}</p>
            <p className="text-white/30 text-xs">{session.courseCode}</p>
          </div>
        </div>
        <button
          onClick={handleLeave}
          className="text-white/30 hover:text-white transition-colors flex items-center gap-1.5 text-xs"
        >
          <LogOut className="w-3.5 h-3.5" />
          Leave
        </button>
      </header>

      {/* Session ended banner */}
      {isEnded && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-3 text-center">
          <p className="text-amber-400 text-sm font-medium">
            This session has ended. Thanks for participating!
          </p>
        </div>
      )}

      <div className="flex-1 flex flex-col justify-center px-6 py-8 max-w-lg mx-auto w-full space-y-6">

        {/* Heading + countdown */}
        <div className="text-center space-y-3">
          <h1 className="text-xl font-bold tracking-tight">
            How are you following?
          </h1>

          {!isEnded && (
            <>
              <p className="text-white/30 text-sm">
                {!tappedThisRound
                  ? "Tap to signal — you can change it anytime this round"
                  : "Signal sent — tap again anytime to update"}
              </p>

              {/* Countdown ring */}
              <div className="flex flex-col items-center gap-1 pt-1">
                <div className="relative w-14 h-14">
                  <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                    <circle
                      cx="28" cy="28" r="24"
                      fill="none"
                      stroke="rgba(255,255,255,0.05)"
                      strokeWidth="4"
                    />
                    <circle
                      cx="28" cy="28" r="24"
                      fill="none"
                      stroke={tappedThisRound ? "#8b5cf6" : "rgba(255,255,255,0.15)"}
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 24}`}
                      strokeDashoffset={`${2 * Math.PI * 24 * (1 - countdownPct / 100)}`}
                      className="transition-all duration-1000"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs font-semibold tabular-nums text-white/50">
                      {countdownLabel}
                    </span>
                  </div>
                </div>
                <p className="text-white/20 text-xs">
                  Round {roundNumber} · resets in {countdownLabel}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Signal buttons */}
        <div className="space-y-3">
          {SIGNALS.map((signal) => {
            const isActive = activeSignal === signal.key
            return (
              <button
                key={signal.key}
                onClick={() => sendSignal(signal.key)}
                disabled={isEnded}
                className={`
                  w-full flex items-center gap-4 px-5 py-4 rounded-2xl border
                  transition-all duration-200 text-left
                  disabled:cursor-not-allowed disabled:opacity-50
                  ${isActive
                    ? `${signal.activeBg} scale-[1.02] shadow-lg`
                    : `${signal.bg} ${signal.border} hover:scale-[1.01] hover:border-white/20`
                  }
                `}
              >
                <span className="text-3xl leading-none">{signal.emoji}</span>
                <div className="flex-1">
                  <p className={`font-semibold text-base ${isActive ? signal.color : "text-white"}`}>
                    {signal.label}
                  </p>
                  <p className="text-white/30 text-xs mt-0.5">{signal.sublabel}</p>
                </div>
                {isActive && (
                  <div className={`w-2.5 h-2.5 rounded-full ${signal.color.replace("text-", "bg-")} animate-pulse`} />
                )}
              </button>
            )
          })}
        </div>

        {/* Status line */}
        <div className="text-center h-5">
          {activeSignal ? (
            <p className="text-white/30 text-xs">
              Sending{" "}
              <span className="text-white/60 font-medium">
                {SIGNALS.find((s) => s.key === activeSignal)?.label}
              </span>
              {" "}· Anonymous · Resets in {countdownLabel}
            </p>
          ) : (
            <p className="text-white/20 text-xs">
              {roundNumber > 1
                ? "New round — tap to signal again"
                : "No signal sent yet"}
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 px-6 py-4 text-center">
        <p className="text-white/15 text-xs">
          🔒 Your professor sees room totals only — never individual responses
        </p>
      </footer>
    </div>
  )
}