"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
} from "firebase/auth"
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"
import { Wifi } from "lucide-react"

// ─── Types ──────────────────────────────────────────────────────────────────────

type Role = "admin" | "student"
type Step = "landing" | "role-select"

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("landing")
  const [pendingUser, setPendingUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [savingRole, setSavingRole] = useState(false)
  const [error, setError] = useState("")

  // ── If already logged in, redirect immediately ──────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setLoading(false)
        return
      }

      const userDoc = await getDoc(doc(db, "users", u.uid))
      if (userDoc.exists()) {
        const role = userDoc.data().role as Role
        router.push(role === "admin" ? "/admin/dashboard" : "/student/join")
        return
      }

      // Logged in but no role yet — show role select
      setPendingUser(u)
      setStep("role-select")
      setLoading(false)
    })
    return () => unsub()
  }, [])

  // ── Google Sign In ───────────────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    setSigningIn(true)
    setError("")

    try {
      const provider = new GoogleAuthProvider()
      const result = await signInWithPopup(auth, provider)
      const u = result.user

      // Check if user already has a role
      const userDoc = await getDoc(doc(db, "users", u.uid))
      if (userDoc.exists()) {
        const role = userDoc.data().role as Role
        router.push(role === "admin" ? "/admin/dashboard" : "/student/join")
        return
      }

      // First time — collect role
      setPendingUser(u)
      setStep("role-select")
    } catch (e: any) {
      if (e.code !== "auth/popup-closed-by-user") {
        setError("Sign in failed. Please try again.")
      }
    } finally {
      setSigningIn(false)
    }
  }

  // ── Save role on first login ─────────────────────────────────────────────────
  const handleRoleSelect = async (role: Role) => {
    if (!pendingUser || savingRole) return
    setSavingRole(true)

    try {
      await setDoc(doc(db, "users", pendingUser.uid), {
        uid: pendingUser.uid,
        email: pendingUser.email,
        name: pendingUser.displayName,
        photoURL: pendingUser.photoURL,
        role,
        createdAt: serverTimestamp(),
      })
      router.push(role === "admin" ? "/admin/dashboard" : "/student/join")
    } catch (e) {
      setError("Failed to save your role. Please try again.")
      setSavingRole(false)
    }
  }

  // ─── Loading splash ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0f1117] text-white flex flex-col items-center justify-center px-6">

      {/* Logo */}
      <div className="flex items-center gap-3 mb-12">
        <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center">
          <Wifi className="w-5 h-5 text-white" />
        </div>
        <span className="text-2xl font-black tracking-tight">PulseBoard</span>
      </div>

      {step === "landing" && (
        <div className="w-full max-w-sm space-y-8">

          {/* Heading */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-black tracking-tight">
              Real-time lecture feedback
            </h1>
            <p className="text-white/40 text-sm leading-relaxed">
              Students signal how they're following. Professors see it live.
              Free, anonymous, built for classrooms.
            </p>
          </div>

          {/* Sign in button */}
          <div className="space-y-3">
            <button
              onClick={handleGoogleSignIn}
              disabled={signingIn}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors text-[#0f1117] font-semibold py-3.5 rounded-xl text-sm"
            >
              {signingIn ? (
                <div className="w-4 h-4 border-2 border-[#0f1117]/30 border-t-[#0f1117] rounded-full animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              {signingIn ? "Signing in..." : "Continue with Google"}
            </button>

            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
          </div>

          {/* Footer note */}
          <p className="text-center text-white/20 text-xs">
            🔒 Anonymous by design · No individual signals are ever shared
          </p>
        </div>
      )}

      {step === "role-select" && (
        <div className="w-full max-w-sm space-y-6">

          {/* Heading */}
          <div className="text-center space-y-2">
            <p className="text-white/40 text-sm">
              Welcome, {pendingUser?.displayName?.split(" ")[0]}
            </p>
            <h2 className="text-2xl font-black tracking-tight">
              How will you use PulseBoard?
            </h2>
            <p className="text-white/30 text-xs">
              You can't change this later — choose carefully
            </p>
          </div>

          {/* Role cards */}
          <div className="space-y-3">
            <RoleCard
              emoji="🎓"
              title="I'm a Professor"
              description="Create sessions, see live feedback, get AI insights after class"
              onClick={() => handleRoleSelect("admin")}
              disabled={savingRole}
            />
            <RoleCard
              emoji="📚"
              title="I'm a Student"
              description="Join sessions with a code and signal how you're following along"
              onClick={() => handleRoleSelect("student")}
              disabled={savingRole}
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          {savingRole && (
            <div className="flex items-center justify-center gap-2 text-white/30 text-sm">
              <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              Setting up your account...
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Role Card ──────────────────────────────────────────────────────────────────

function RoleCard({
  emoji,
  title,
  description,
  onClick,
  disabled,
}: {
  emoji: string
  title: string
  description: string
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left rounded-2xl border border-white/10 hover:border-violet-500/50 bg-white/[0.02] hover:bg-violet-500/5 transition-all px-5 py-5 space-y-1 disabled:opacity-50 disabled:cursor-not-allowed group"
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{emoji}</span>
        <p className="font-semibold text-base group-hover:text-violet-300 transition-colors">
          {title}
        </p>
      </div>
      <p className="text-white/30 text-sm leading-relaxed pl-9">
        {description}
      </p>
    </button>
  )
}

// ─── Google Icon ────────────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.583c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.583 9 3.583z"
      />
    </svg>
  )
}