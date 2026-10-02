"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { collection, query, where, onSnapshot, addDoc, serverTimestamp } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"
import { onAuthStateChanged } from "firebase/auth"
import { nanoid } from "nanoid"
import { Plus, LogOut, BookOpen, Users, Clock, ChevronRight, Wifi } from "lucide-react"

type Session = {
  id: string
  title: string
  courseCode: string
  joinCode: string
  status: "active" | "ended"
  createdAt: any
  participantCount: number
  aiSummary: string | null
}

export default function AdminDashboard() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [title, setTitle] = useState("")
  const [courseCode, setCourseCode] = useState("")
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        router.push("/login")
        return
      }
      setUser(u)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!user) return

    const q = query(
      collection(db, "sessions"),
      where("adminId", "==", user.uid)
    )

    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as Session))
        .sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds)
      setSessions(data)
      setLoading(false)
    })

    return () => unsub()
  }, [user])

  const createSession = async () => {
    if (!title.trim() || !courseCode.trim()) return
    setCreating(true)

    const joinCode = nanoid(6).toUpperCase()

    const docRef = await addDoc(collection(db, "sessions"), {
      adminId: user.uid,
      title: title.trim(),
      courseCode: courseCode.trim().toUpperCase(),
      joinCode,
      status: "active",
      createdAt: serverTimestamp(),
      endedAt: null,
      aiSummary: null,
      participantCount: 0,
    })

    setCreating(false)
    setShowModal(false)
    setTitle("")
    setCourseCode("")
    router.push(`/admin/session/${docRef.id}`)
  }

  const activeSessions = sessions.filter((s) => s.status === "active")
  const pastSessions = sessions.filter((s) => s.status === "ended")

  const handleSignOut = async () => {
    await auth.signOut()
    router.push("/login")
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
            <Wifi className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-lg tracking-tight">PulseBoard</span>
        </div>
        <div className="flex items-center gap-4">
          <img
            src={user?.photoURL}
            alt={user?.displayName}
            className="w-8 h-8 rounded-full"
          />
          <button
            onClick={handleSignOut}
            className="text-white/50 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-10">
        {/* Top row */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-white/40 text-sm mt-1">
              {user?.displayName} · Admin
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 transition-colors px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>
        </div>

        {/* Active sessions */}
        {activeSessions.length > 0 && (
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">
              Live Now
            </p>
            {activeSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                onClick={() => router.push(`/admin/session/${session.id}`)}
                live
              />
            ))}
          </section>
        )}

        {/* Past sessions */}
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/30">
            Past Sessions
          </p>
          {pastSessions.length === 0 ? (
            <div className="rounded-xl border border-white/10 px-6 py-10 text-center">
              <p className="text-white/30 text-sm">
                No past sessions yet. Start one and end it to see it here.
              </p>
            </div>
          ) : (
            pastSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                onClick={() => router.push(`/admin/session/${session.id}`)}
              />
            ))
          )}
        </section>
      </main>

      {/* Create session modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-[#1a1d27] border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-5">
            <h2 className="text-lg font-semibold">New Session</h2>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-white/40 font-medium uppercase tracking-wider">
                  Session Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Cell Division — Week 4"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-white/40 font-medium uppercase tracking-wider">
                  Course Code
                </label>
                <input
                  type="text"
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  placeholder="e.g. BIO201"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => {
                  setShowModal(false)
                  setTitle("")
                  setCourseCode("")
                }}
                className="flex-1 py-2.5 rounded-lg border border-white/10 text-sm text-white/60 hover:text-white hover:border-white/20 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createSession}
                disabled={!title.trim() || !courseCode.trim() || creating}
                className="flex-1 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
              >
                {creating ? "Creating..." : "Create Session"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SessionRow({
  session,
  onClick,
  live = false,
}: {
  session: Session
  onClick: () => void
  live?: boolean
}) {
  const date = session.createdAt?.toDate?.()
  const formatted = date
    ? date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : ""

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-white/10 hover:border-violet-500/40 bg-white/[0.02] hover:bg-white/[0.05] transition-all px-5 py-4 flex items-center gap-4 group"
    >
      {/* Course badge */}
      <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
        <BookOpen className="w-4 h-4 text-violet-400" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm truncate">{session.title}</p>
          {live && (
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-white/30">
          <span>{session.courseCode}</span>
          {session.participantCount > 0 && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {session.participantCount}
              </span>
            </>
          )}
          {formatted && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatted}
              </span>
            </>
          )}
        </div>
      </div>

      <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
    </button>
  )
}