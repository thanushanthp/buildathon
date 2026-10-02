"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { collection, query, where, getDocs } from "firebase/firestore"
import { onAuthStateChanged } from "firebase/auth"
import { auth, db } from "@/lib/firebase"
import { Wifi, ArrowRight } from "lucide-react"

export default function JoinPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) { router.push("/login"); return }
      setUser(u)
    })
    return () => unsub()
  }, [])

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase()
    if (trimmed.length !== 6) {
      setError("Code must be 6 characters")
      return
    }

    setLoading(true)
    setError("")

    try {
      const q = query(
        collection(db, "sessions"),
        where("joinCode", "==", trimmed),
        where("status", "==", "active")
      )
      const snap = await getDocs(q)

      if (snap.empty) {
        setError("Session not found or already ended")
        setLoading(false)
        return
      }

      const sessionId = snap.docs[0].id
      router.push(`/student/session/${sessionId}`)
    } catch (e) {
      setError("Something went wrong. Try again.")
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleJoin()
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
          <Wifi className="w-4 h-4 text-white" />
        </div>
        <span className="font-semibold text-lg tracking-tight">PulseBoard</span>
      </header>

      {/* Center content */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-8">

          {/* Heading */}
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-black tracking-tight">Join a session</h1>
            <p className="text-white/40 text-sm">
              Enter the 6-character code your professor shared
            </p>
          </div>

          {/* Code input */}
          <div className="space-y-3">
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase().slice(0, 6))
                setError("")
              }}
              onKeyDown={handleKeyDown}
              placeholder="ABC123"
              maxLength={6}
              autoFocus
              className="w-full text-center text-4xl font-black tracking-[0.3em] bg-white/5 border border-white/10 rounded-2xl px-6 py-6 text-white placeholder:text-white/10 focus:outline-none focus:border-violet-500 transition-colors uppercase"
            />

            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}

            <button
              onClick={handleJoin}
              disabled={loading || code.trim().length !== 6}
              className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors py-4 rounded-2xl text-base font-semibold"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  Join Session
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {/* Anonymous note */}
          <p className="text-center text-white/20 text-xs">
            🔒 Your signals are always anonymous
          </p>
        </div>
      </div>
    </div>
  )
}