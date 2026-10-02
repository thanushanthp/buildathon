// lib/types.ts

import { Timestamp } from "firebase/firestore"

export type Role = "admin" | "student"

export type SignalType =
  | "got_it"
  | "slightly_lost"
  | "confused"
  | "interesting"

export type User = {
  uid:       string
  email:     string
  name:      string
  photoURL:  string
  role:      Role
  createdAt: Timestamp
}

export type Session = {
  id:               string
  adminId:          string
  title:            string
  courseCode:       string
  joinCode:         string
  status:           "active" | "ended"
  createdAt:        Timestamp
  endedAt:          Timestamp | null
  aiSummary:        string | null
  participantCount: number
}

export type Signal = {
  sessionId: string
  studentId: string
  signal:    SignalType
  timestamp: Timestamp
}

export type Snapshot = {
  timestamp:    Timestamp
  got_it:       number
  slightly_lost:number
  confused:     number
  interesting:  number
  total:        number
}