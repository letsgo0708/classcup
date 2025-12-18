import { useEffect, useMemo, useState } from "react"
import { BrowserRouter, Routes, Route, Link, NavLink, useParams, useNavigate } from "react-router-dom"
import { supabase } from "./supabase"

const ADMIN_PASS = "8134"
const ADMIN_KEY = "classcup_admin_ok"
const DAY = 24 * 60 * 60 * 1000


// ------------------------
// 1) Selectors (집계 함수)
// ------------------------
function parseDT(s) {
  return new Date(s)
}

function fmtDT(s) {
  const d = parseDT(s)
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isBeforeKickoff(match) {
  return Date.now() < parseDT(match.datetime).getTime()
}

function getGoalsByMatch(goals, matchId) {
  return goals.filter((g) => g.match_id === matchId)
}

function sumGoals(goalsForMatch, team) {
  return goalsForMatch
    .filter((g) => g.team === team)
    .reduce((acc, g) => acc + Number(g.goal_count || 0), 0)
}

function getPlayerNormalGoalsTotal(goals, playerId) {
  return goals
    .filter((g) => g.player_id === playerId && g.goal_type === "normal")
    .reduce((acc, g) => acc + Number(g.goal_count || 0), 0)
}

function buildScorerRanking(players, goals) {
  const rows = players.map((p) => ({ player: p, goals: getPlayerNormalGoalsTotal(goals, p.id) }))
  return rows
    .filter((r) => r.goals > 0)
    .sort(
      (a, b) =>
        b.goals - a.goals ||
        a.player.class.localeCompare(b.player.class) ||
        a.player.number - b.player.number
    )
}

function buildTeamStats(matches) {
  const map = new Map()
  const ensure = (team) => {
    if (!map.has(team)) map.set(team, { team, gf: 0, ga: 0, played: 0, w: 0, d: 0, l: 0 })
    return map.get(team)
  }

  matches.forEach((m) => {
    if (m.status !== "종료") return

    const hs = Number(m.home_score ?? 0)
    const as = Number(m.away_score ?? 0)

    const home = ensure(m.home_team)
    const away = ensure(m.away_team)

    home.gf += hs
    home.ga += as
    home.played += 1

    away.gf += as
    away.ga += hs
    away.played += 1

    if (hs > as) {
      home.w += 1
      away.l += 1
    } else if (hs < as) {
      away.w += 1
      home.l += 1
    } else {
      home.d += 1
      away.d += 1
    }
  })

  return Array.from(map.values()).sort(
    (a, b) => (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.team.localeCompare(b.team)
  )
}

function isPredictionHit(match, pred) {
  if (!match || match.status !== "종료") return false
  return Number(pred.home_score) === Number(match.home_score) && Number(pred.away_score) === Number(match.away_score)
}

function buildPredictionRanking(predictions, matches) {
  const matchMap = new Map(matches.map((m) => [m.id, m]))
  const keyOf = (p) => `${p.writer_student_no}::${p.writer_name}`

  const map = new Map()
  predictions.forEach((p) => {
    const k = keyOf(p)
    if (!map.has(k)) map.set(k, { writer_student_no: p.writer_student_no, writer_name: p.writer_name, hits: 0, total: 0 })
    const row = map.get(k)
    const match = matchMap.get(p.match_id)

    if (match?.status === "종료") {
      row.total += 1
      if (isPredictionHit(match, p)) row.hits += 1
    }
  })

  return Array.from(map.values())
    .filter((r) => r.total > 0)
    .sort((a, b) => b.hits - a.hits || b.total - a.total || a.writer_student_no.localeCompare(b.writer_student_no))
}

function getWinnerLoser(match) {
  if (match.status !== "종료") return { winner: null, loser: null }

  const hs = Number(match.home_score ?? 0)
  const as = Number(match.away_score ?? 0)

  if (hs > as) return { winner: match.home_team, loser: match.away_team }
  if (hs < as) return { winner: match.away_team, loser: match.home_team }

  // 정규가 무승부면 PK로 판정
  const hpk = match.home_pk
  const apk = match.away_pk
  if (hpk == null || apk == null) return { winner: null, loser: null }

  if (Number(hpk) > Number(apk)) return { winner: match.home_team, loser: match.away_team }
  if (Number(hpk) < Number(apk)) return { winner: match.away_team, loser: match.home_team }

  return { winner: null, loser: null }
}

function applyBracketAutoUpdate(nextMatches) {
  const m1 = nextMatches.find(m => m.id === 1)
  const m2 = nextMatches.find(m => m.id === 2)
  const m3 = nextMatches.find(m => m.id === 3)
  const m4 = nextMatches.find(m => m.id === 4)
  const m5 = nextMatches.find(m => m.id === 5) // 4강1
  const m6 = nextMatches.find(m => m.id === 6) // 4강2
  const m7 = nextMatches.find(m => m.id === 7) // 결승

  const r1 = m1 ? getWinnerLoser(m1) : { winner: null, loser: null }
  const r2 = m2 ? getWinnerLoser(m2) : { winner: null, loser: null }
  const r3 = m3 ? getWinnerLoser(m3) : { winner: null, loser: null }
  const r4 = m4 ? getWinnerLoser(m4) : { winner: null, loser: null }

  if (m5) {
    m5.home_team = r1.winner ?? "8강 1경기 승자"
    m5.away_team = r2.winner ?? "8강 2경기 승자"
  }
  if (m6) {
    m6.home_team = r3.winner ?? "8강 3경기 승자"
    m6.away_team = r4.winner ?? "8강 4경기 승자"
  }

  const r5 = m5 ? getWinnerLoser(m5) : { winner: null, loser: null }
  const r6 = m6 ? getWinnerLoser(m6) : { winner: null, loser: null }

  if (m7) {
    m7.home_team = r5.winner ?? "4강 1경기 승자"
    m7.away_team = r6.winner ?? "4강 2경기 승자"
  }
}

function getTeamTotals(matches, team) {
  let gf = 0
  let ga = 0
  let played = 0

  matches.forEach((m) => {
    if (m.status !== "종료") return

    const hs = Number(m.home_score ?? 0)
    const as = Number(m.away_score ?? 0)

    if (m.home_team === team) {
      gf += hs
      ga += as
      played += 1
    } else if (m.away_team === team) {
      gf += as
      ga += hs
      played += 1
    }
  })

  return { team, gf, ga, played }
}

// ------------------------
// 2) App
// ------------------------
export default function App() {
  const [matches, setMatches] = useState([])
  const [players, setPlayers] = useState([])
  const [goals, setGoals] = useState([])
  const [predictions, setPredictions] = useState([])

  const [matchesDraft, setMatchesDraft] = useState([])
  const [goalsDraft, setGoalsDraft] = useState([])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")

  const actions = useMemo(() => {
    return {
      updateMatchDraft: (matchId, patch) => {
        setMatchesDraft(prev => prev.map(m => (m.id === matchId ? { ...m, ...patch } : m)))
      },

      upsertGoalDraft: (goal) => {
        setGoalsDraft((prev) => {
          // ✅ 신규: DB id는 끝까지 null 유지
          if (goal.id == null) {
            const tempKey = goal._tmp ?? crypto.randomUUID()
            return [{ ...goal, _tmp: tempKey }, ...prev]
          }

          // ✅ 기존: id로 업데이트
          return prev.map((g) => (g.id === goal.id ? { ...g, ...goal } : g))
        })
      },


      deleteGoalDraft: (key) => {
        setGoalsDraft((prev) => prev.filter((g) => (g.id ?? g._tmp) !== key))
      },


      saveAdminChanges: async () => {
        const nextMatches = matchesDraft.map(m => ({ ...m }))
        const nextGoalsDraft = goalsDraft.map(g => ({ ...g }))

        applyBracketAutoUpdate(nextMatches)

        // 0) (선택) goals 기본 검증: team/goal_type 범위 + goal_count 정수/0이상
        const allowedTypes = new Set(["normal", "own_goal", "etc"])
        const allowedTeams = new Set(["home", "away"])

        for (const g of nextGoalsDraft) {
          if (!allowedTeams.has(g.team)) return alert(`goals 검증 실패: team=${g.team}`)
          if (!allowedTypes.has(g.goal_type)) return alert(`goals 검증 실패: goal_type=${g.goal_type} (normal/own_goal/etc만 가능)`)
          const n = Number(g.goal_count)
          if (!Number.isInteger(n) || n < 0) return alert(`goals 검증 실패: goal_count=${g.goal_count} (0 이상의 정수)`)
        }

        // 1) 삭제 대상 계산 (DB에 있던 id 중 draft에서 사라진 것)
        const prevIds = new Set((goals || []).map(g => g.id).filter(id => id != null))
        const nextIds = new Set(nextGoalsDraft.map(g => g.id).filter(id => id != null))
        const deletedIds = [...prevIds].filter(id => !nextIds.has(id))

        // 2) matches 저장
        const mRes = await supabase.from("matches").upsert(nextMatches, { onConflict: "id" })
        if (mRes.error) return alert("matches 저장 실패: " + mRes.error.message)

        // 3) goals 삭제
        if (deletedIds.length > 0) {
          const dRes = await supabase.from("goals").delete().in("id", deletedIds)
          if (dRes.error) return alert("goals 삭제 실패: " + dRes.error.message)
        }

        // 4) goals 저장 (정석 1번)
        const existingGoals = nextGoalsDraft
          .filter((g) => g.id != null)
          .map(({ _tmp, ...rest }) => rest)

        const newGoalsPayload = nextGoalsDraft
          .filter((g) => g.id == null)
          .map(({ id, _tmp, ...rest }) => rest) // ✅ id/_tmp 제거


        // 4-1) 기존 row는 upsert
        if (existingGoals.length > 0) {
          const upRes = await supabase.from("goals").upsert(existingGoals, { onConflict: "id" })
          if (upRes.error) return alert("goals 수정 실패: " + upRes.error.message)
        }

        // 4-2) 신규 row는 insert 후, id 포함된 row 받아오기
        let insertedRows = []
        if (newGoalsPayload.length > 0) {
          const inRes = await supabase.from("goals").insert(newGoalsPayload).select()
          if (inRes.error) return alert("goals 추가 실패: " + inRes.error.message)
          insertedRows = inRes.data || []
        }

        // 5) 최종 goals는 DB 기준으로 확정
        //    (기존 + 새로 insert된 row)  ※ 삭제된 건 이미 draft에서 빠져있음
        const nextGoalsFinal = [...existingGoals, ...insertedRows].sort((a, b) => Number(a.id) - Number(b.id))

        setMatches(nextMatches)
        setGoals(nextGoalsFinal)
        setMatchesDraft(nextMatches)
        setGoalsDraft(nextGoalsFinal)

        alert("관리자 변경사항이 저장되었습니다.")
      },




      resetAdminChanges: () => {
        setMatchesDraft(() => matches)
        setGoalsDraft(() => goals)
      },

      createPrediction: async (payload) => {
        const row = { ...payload, created_at: new Date().toISOString() }
        const res = await supabase.from("predictions").insert([row]).select().single()
        if (res.error) return alert("예측 저장 실패: " + res.error.message)
        setPredictions((prev) => [res.data, ...prev])
      },
    }
  }, [matchesDraft, goalsDraft, matches, goals])

  const nextMatch = useMemo(() => {
    const upcoming = matches
      .filter((m) => m.status !== "종료")
      .sort((a, b) => parseDT(a.datetime) - parseDT(b.datetime))
    return upcoming[0] || null
  }, [matches])

  const scorerRanking = useMemo(() => buildScorerRanking(players, goals), [players, goals])
  const predictionRanking = useMemo(() => buildPredictionRanking(predictions, matches), [predictions, matches])
  const teamStats = useMemo(() => buildTeamStats(matches), [matches])

  const data = { matches, players, goals, predictions, nextMatch, scorerRanking, predictionRanking, teamStats }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setLoadError("")

      const [mRes, pRes, gRes, prRes] = await Promise.all([
        supabase.from("matches").select("*").order("match_no", { ascending: true }),
        supabase.from("players").select("*").order("class", { ascending: true }).order("number", { ascending: true }),
        supabase.from("goals").select("*").order("id", { ascending: true }),
        supabase.from("predictions").select("*").order("created_at", { ascending: false }),
      ])

      const firstError = mRes.error || pRes.error || gRes.error || prRes.error
      if (firstError) {
        console.error(firstError)
        setLoadError(firstError.message || "데이터 로딩 실패")
        setLoading(false)
        return
      }

      const ms = mRes.data || []
      const ps = pRes.data || []
      const gs = gRes.data || []
      const prs = prRes.data || []

      setMatches(ms)
      setPlayers(ps)
      setGoals(gs)
      setPredictions(prs)

      setMatchesDraft(ms.map((x) => ({ ...x })))
      setGoalsDraft(gs.map((x) => ({ ...x })))

      setLoading(false)
    }

    load()
  }, [])

  if (loading) return <LoadingScreen />
  if (loadError) return <ErrorScreen message={loadError} />

  return (
    <BrowserRouter>
      {/* ✅ StrikeZone Theme */}
      <div className="min-h-screen bg-[#112117] text-white">
        <TopNav />

        {/* 페이지별로 폭/패딩을 HomePage에서 직접 잡도록 변경 */}
        <main className="w-full">
          <Routes>
            <Route path="/" element={<HomePage data={data} />} />
            <Route path="/overview" element={<OverviewPage data={data} />} />
            <Route path="/match/:id" element={<MatchPage data={data} actions={actions} />} />
            <Route
              path="/admin"
              element={
                <AdminGuard>
                  <AdminPage
                    data={{ matches: matchesDraft, goals: goalsDraft, players }}
                    actions={actions}
                  />
                </AdminGuard>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>

        <Footer />
      </div>
    </BrowserRouter>
  )
}

// ------------------------
// 3) UI Helpers (Tailwind)
// ------------------------
function cx(...xs) {
  return xs.filter(Boolean).join(" ")
}

function toIntClamped(raw, { min = 0, max = 99, fallback = 0 } = {}) {
  const s = String(raw ?? "").trim()
  if (s === "") return fallback
  if (!/^\d+$/.test(s)) return fallback // 숫자만 허용(음수/소수/문자 차단)
  const n = Number(s)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}


function Card({ children, className = "" }) {
  return (
    <div className={cx("rounded-2xl bg-[#1b3224] border border-white/10 shadow-sm", className)}>
      {children}
    </div>
  )
}

function Badge({ children, tone = "neutral", className = "" }) {
  const map = {
    neutral: "bg-white/5 text-white/80 border-white/10",
    good: "bg-[#36e27b]/10 text-[#36e27b] border-[#36e27b]/30",
    warn: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    bad: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    info: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  }
  return (
    <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold", map[tone] || map.neutral, className)}>
      {children}
    </span>
  )
}

function Button({ children, onClick, type = "button", variant = "primary", className = "" }) {
  const base =
    "inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-bold transition active:scale-[0.99] disabled:opacity-50"
  const map = {
    primary: "bg-[#36e27b] text-[#112117] hover:bg-white shadow-[0_0_20px_rgba(54,226,123,0.3)]",
    ghost: "bg-white/5 text-white border border-white/10 hover:bg-white/10",
    danger: "bg-rose-600 text-white hover:bg-rose-500",
    soft: "bg-[#36e27b]/10 text-[#36e27b] border border-[#36e27b]/30 hover:bg-[#36e27b] hover:text-[#112117]",
  }
  return (
    <button type={type} onClick={onClick} className={cx(base, map[variant] || map.primary, className)}>
      {children}
    </button>
  )
}

function Input({ value, onChange, placeholder = "", type = "text", min, max, step, inputMode }) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      inputMode={inputMode}
      onChange={onChange}
      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-base text-white placeholder:text-white/40 outline-none focus:border-[#36e27b]/50 focus:ring-2 focus:ring-[#36e27b]/20"
    />
  )
}


function Textarea({ value, onChange, placeholder = "" }) {
  return (
    <textarea
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      rows={4}
      className="w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-base text-white placeholder:text-white/40 outline-none focus:border-[#36e27b]/50 focus:ring-2 focus:ring-[#36e27b]/20"
    />
  )
}

function Select({ value, onChange, children }) {
  return (
    <select
      value={value}
      onChange={onChange}
      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-base text-white outline-none focus:border-[#36e27b]/50 focus:ring-2 focus:ring-[#36e27b]/20"
    >
      {children}
    </select>
  )
}

function Divider() {
  return <div className="my-4 h-px w-full bg-white/10" />
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#112117] text-white">
      <div className="mx-auto w-full max-w-[900px] px-4 py-10">
        <Card className="p-6">
          <div className="text-lg font-black">로딩중...</div>
          <div className="mt-1 text-sm text-white/60">데이터를 불러오고 있어요.</div>
        </Card>
      </div>
    </div>
  )
}

function ErrorScreen({ message }) {
  return (
    <div className="min-h-screen bg-[#112117] text-white">
      <div className="mx-auto w-full max-w-[900px] px-4 py-10">
        <Card className="border-rose-500/30 bg-rose-500/10 p-6">
          <div className="text-lg font-black">에러</div>
          <div className="mt-1 break-words text-sm text-rose-100">{message}</div>
        </Card>
      </div>
    </div>
  )
}

// ------------------------
// 4) Pages / Components
// ------------------------
function TopNav() {
  const navClass = ({ isActive }) =>
    cx(
      "text-sm font-medium transition-colors whitespace-nowrap",
      isActive ? "text-[#36e27b]" : "text-white/60 hover:text-[#36e27b]"
    )

  return (
    <header className="sticky top-0 z-50 border-b border-[#254632] bg-[#112117]/95 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-4 py-4 md:px-10">
        <div className="flex min-w-0 items-center gap-4 md:gap-8">
          <Link to="/" className="flex items-center gap-3">
            <div className="h-8 w-8 text-white/90">
              <IconSoccerBall />
            </div>
            <div className="text-xl font-bold tracking-tight">
              <span className="text-[#36e27b]">Y</span>oung
              <span className="text-[#36e27b]">I</span>l&nbsp;
              <span className="text-[#36e27b]">1</span>st
            </div>
          </Link>

          {/* ✅ 모바일에서도 보이도록 + 좁으면 가로 스크롤 */}
          <nav className="flex min-w-0 items-center gap-4 overflow-x-auto">
            <NavLink to="/" className={navClass}>메인</NavLink>
            <NavLink to="/overview" className={navClass}>일정</NavLink>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative hidden items-center md:flex"></div>

          <NavLink to="/admin" className={navClass}>
            <div className="h-6 w-6 cursor-pointer rounded-full border-2 border-[#36e27b] bg-white/10" />
          </NavLink>
        </div>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="border-t border-[#254632] bg-[#112117] py-8">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col items-center justify-between gap-4 px-4 md:flex-row md:px-10">
        <div className="text-sm text-white/50">Copyright 2025. 최미르T. All rights reserved.</div>
        <div className="flex gap-6 text-white/45">
          <button className="transition-colors hover:text-[#36e27b]"><IconHelp className="h-5 w-5" /></button>
          <button className="transition-colors hover:text-[#36e27b]"><IconShield className="h-5 w-5" /></button>
          <button className="transition-colors hover:text-[#36e27b]"><IconMail className="h-5 w-5" /></button>
        </div>
      </div>
    </footer>
  )
}

function HomePage({ data }) {
  const { matches, nextMatch, scorerRanking, predictionRanking } = data

  const finished = useMemo(() => {
    return matches
      .filter((m) => m.status === "종료")
      .sort((a, b) => parseDT(b.datetime) - parseDT(a.datetime))
      .slice(0, 3)
  }, [matches])

  const dday = useMemo(() => {
    if (!nextMatch) return null
    const ms = parseDT(nextMatch.datetime).getTime() - Date.now()
    const days = Math.ceil(ms / (1000 * 60 * 60 * 24))
    return Number.isFinite(days) ? days : null
  }, [nextMatch])

  const timeLine = useMemo(() => {
    if (!nextMatch) return { line1: "예정 경기가 없습니다", line2: "" }
    const d = parseDT(nextMatch.datetime)
    const pad = (n) => String(n).padStart(2, "0")
    const dayNames = ["일", "월", "화", "수", "목", "금", "토"]
    const day = dayNames[d.getDay()]
    return {
      line1: `${d.getMonth() + 1}월 ${d.getDate()}일(${day}) ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      line2: nextMatch.location || "운동장",
    }
  }, [nextMatch])

  const agoLabel = (dt) => {
    const diff = Date.now() - parseDT(dt).getTime()
    const days = Math.floor(diff / DAY)
    if (days <= 0) return "오늘"
    if (days === 1) return "어제"
    return `${days}일 전`

  }

  const TopPredRows = predictionRanking.slice(0, 3).map((r) => {
    const acc = Math.round((r.hits / r.total) * 100)
    const initials = (r.writer_name || "?").slice(0, 2).toUpperCase()
    return { ...r, acc, initials }
  })

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-10 px-4 py-8 md:px-10">
      {/* Hero */}
      <section>
        <div className="relative w-full overflow-hidden rounded-2xl bg-[#1b3224] shadow-2xl">
          {/* background */}
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage:
                "url('https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1800&q=60')",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#112117] via-[#112117]/90 to-[#112117]/60" />

          <div className="relative z-10 flex flex-col items-center justify-between gap-8 p-8 lg:flex-row lg:p-12">
            {/* left info */}
            <div className="flex w-full flex-1 flex-col gap-6">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-[#36e27b]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#36e27b]" />
                {nextMatch ? `라이브 예정 • ${nextMatch.match_name}` : "라이브 예정 • -"}
              </div>

              <h1 className="text-4xl font-black leading-tight text-white lg:text-5xl">
                {nextMatch ? (
                  <>
                    {nextMatch.home_team} <span className="mx-2 font-thin text-white/30">vs</span> {nextMatch.away_team}
                  </>
                ) : (
                  <>
                    Tigers <span className="mx-2 font-thin text-white/30">vs</span> Lions
                  </>
                )}
              </h1>

              <div className="flex flex-col gap-1">
                <p className="text-lg text-white/80">{timeLine.line1}</p>
                <p className="text-sm text-white/55">{timeLine.line2}</p>
              </div>

              <div className="mt-4 flex flex-wrap gap-4">
                <Link to={nextMatch ? `/match/${nextMatch.id}` : "/overview"}>
                  <Button className="gap-2">
                    <IconBall className="h-5 w-5" />
                    승부 예측하기
                  </Button>
                </Link>
                <Link to={nextMatch ? `/match/${nextMatch.id}` : "/overview"}>
                  <Button variant="ghost" className="gap-2">
                    <IconInfo className="h-5 w-5" />
                    전력 분석
                  </Button>
                </Link>
              </div>
            </div>

            {/* right VS visual */}
            <div className="w-full max-w-lg flex-1">
              <div className="flex items-center justify-center gap-4 rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm sm:gap-8">
                <TeamLogoCard title={nextMatch?.home_team || "Tigers"} sub="홈" />
                <div className="flex flex-col items-center justify-center">
                  <span className="text-3xl font-black italic text-white/20">VS</span>
                  {dday != null ? (
                    <div className="mt-2 rounded border border-red-500/30 bg-red-500/20 px-3 py-1 text-xs font-black text-red-300">
                      D-{dday}
                    </div>
                  ) : (
                    <div className="mt-2 rounded border border-white/10 bg-white/5 px-3 py-1 text-xs font-black text-white/40">
                      D-?
                    </div>
                  )}
                </div>
                <TeamLogoCard title={nextMatch?.away_team || "Lions"} sub="원정" dim />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Content grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left column */}
        <div className="flex flex-col gap-6 lg:col-span-8">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-2xl font-black">
              <span className="text-[#36e27b]">
                <IconHistory className="h-6 w-6" />
              </span>
              최근 경기 결과
            </h2>
            <Link to="/overview" className="text-sm font-bold text-[#36e27b] hover:text-white">
              전체보기 &gt;
            </Link>
          </div>

          {finished.length === 0 ? (
            <Card className="p-6">
              <div className="text-sm text-white/60">종료된 경기가 아직 없습니다.</div>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              {finished.map((m) => (
                <div
                  key={m.id}
                  className="group rounded-2xl bg-[#1b3224] p-1 shadow-sm transition-all duration-300 hover:shadow-md"
                >
                  <div className="p-5">
                    {/* ✅ 모바일: 위(팀/스코어) + 아래(날짜/버튼) 2줄 */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                      {/* ✅ 왼쪽: sm 이상에서는 flex-1로만 먹게 (w-full 제거) */}
                      <div className="flex w-full items-center justify-between gap-3 sm:min-w-0 sm:flex-1">
                        <div className="flex min-w-0 items-center gap-3">
                          <TeamBadge label={m.home_team} />
                          <span className="min-w-0 truncate text-base font-black sm:text-lg">
                            {m.home_team}
                          </span>
                        </div>

                        <div className="flex flex-none flex-col items-center">
                          <div
                            className={cx(
                              "rounded bg-black/30 px-3 py-1 font-mono text-lg font-black tracking-widest sm:px-4 sm:text-xl",
                              Number(m.home_score) === Number(m.away_score) ? "text-white/40" : "text-[#36e27b]"
                            )}
                          >
                            {m.home_score} : {m.away_score}
                          </div>
                          <span className="mt-1 text-xs text-white/40">종료</span>
                        </div>

                        <div className="flex min-w-0 items-center justify-end gap-3">
                          <span className="min-w-0 truncate text-right text-base font-black sm:text-left sm:text-lg">
                            {m.away_team}
                          </span>
                          <TeamBadge label={m.away_team} />
                        </div>
                      </div>

                      {/* ✅ 오른쪽: sm 이상에서 flex-none + nowrap으로 한 줄 고정 */}
                      <div className="flex w-full items-center justify-between gap-2 border-t border-white/10 pt-3 sm:w-auto sm:flex-none sm:justify-end sm:gap-3 sm:border-t-0 sm:pt-0 sm:whitespace-nowrap">
                        <span className="text-sm font-medium text-white/40">
                          {agoLabel(m.datetime)}
                        </span>
                        <Link to={`/match/${m.id}`}>
                          <Button variant="soft" className="px-4 py-2 text-sm">
                            기록 보기
                          </Button>
                        </Link>
                      </div>
                    </div>

                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-8 lg:col-span-4">
          {/* Scorer */}
          <Card className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-black">
                <span className="text-yellow-400">
                  <IconTrophy className="h-5 w-5" />
                </span>
                득점 랭킹
              </h3>
              <Link to="/" className="text-xs text-white/40 hover:text-[#36e27b]">더보기</Link>
            </div>

            <div className="flex max-h-[360px] flex-col gap-4 overflow-y-auto pr-2">
              {scorerRanking.length === 0 ? (
                <div className="text-sm text-white/60">득점 기록이 없습니다.</div>
              ) : (
                scorerRanking.slice(0, 10).map((r, idx) => (
                  <div key={r.player.id} className="flex items-center gap-3">
                    <div
                      className={cx(
                        "w-6 flex-none text-center text-lg font-black",
                        idx === 0 ? "text-yellow-400" : idx === 1 ? "text-white/40" : idx === 2 ? "text-amber-700" : "text-white/30"
                      )}
                    >
                      {idx + 1}
                    </div>

                    <div className="h-10 w-10 rounded-full bg-white/10" />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black">{r.player.name}</p>
                      <p className="text-xs text-white/40">{r.player.class}</p>
                    </div>

                    <div className="font-mono text-sm font-black text-[#36e27b]">
                      {r.goals}골
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Prediction */}
          <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br from-[#1b3224] to-[#0f1d15] p-6 shadow-sm">
            <div className="pointer-events-none absolute right-0 top-0 rounded-full bg-[#36e27b]/5 p-10 blur-2xl" />

            <div className="relative z-10 mb-6 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-black text-white">
                <span className="text-[#36e27b]">
                  <IconBrain className="h-5 w-5" />
                </span>
                예측 랭킹
              </h3>
              <button className="text-xs text-white/40 hover:text-[#36e27b]">내 순위</button>
            </div>

            <div className="relative z-10 flex flex-col gap-3">
              {TopPredRows.length === 0 ? (
                <div className="text-sm text-white/60">종료된 경기의 예측 데이터가 없습니다.</div>
              ) : (
                TopPredRows.map((r, idx) => (
                  <div
                    key={`${r.writer_student_no}-${r.writer_name}`}
                    className={cx(
                      "flex items-center gap-3 rounded-xl p-2 transition-colors",
                      idx === 0 ? "bg-white/5 border border-white/5" : "hover:bg-white/5"
                    )}
                  >
                    <div className={cx("w-6 flex-none text-center text-sm font-black", idx === 0 ? "text-[#36e27b]" : "text-white/35")}>
                      {idx + 1}
                    </div>
                    <div className={cx(
                      "flex h-8 w-8 items-center justify-center rounded-full text-xs font-black text-white",
                      idx === 0 ? "bg-indigo-500" : idx === 1 ? "bg-pink-500" : "bg-orange-500"
                    )}>
                      {r.initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-white">{r.writer_name}</p>
                    </div>
                    <div className={cx(
                      "text-xs font-black",
                      idx === 0
                        ? "rounded bg-[#36e27b]/10 px-2 py-1 text-[#36e27b]"
                        : "text-white/50"
                    )}>
                      {r.acc}% 적중
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-6 border-t border-white/10 pt-4 text-center">
              <p className="mb-2 text-xs text-white/40">다음 예측에 참여해보세요!</p>
              <Link to="/overview">
                <button className="w-full rounded-lg bg-[#36e27b]/20 py-2 text-sm font-black text-[#36e27b] transition-all hover:bg-[#36e27b] hover:text-[#112117]">
                  지금 예측하러 가기
                </button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TeamLogoCard({ title, sub, dim = false }) {
  const initial = (title || "?").slice(0, 2).toUpperCase()
  return (
    <div className="flex flex-col items-center gap-3">
      <div className={cx("flex h-20 w-20 items-center justify-center rounded-full bg-white p-2 shadow-lg sm:h-24 sm:w-24", dim && "opacity-95")}>
        <div className={cx("flex h-full w-full items-center justify-center rounded-full font-black", dim ? "bg-black text-white" : "bg-orange-400 text-[#112117]")}>
          {initial}
        </div>
      </div>
      <span className="text-lg font-black text-white">{title}</span>
      <span className={cx("font-mono text-xs", dim ? "text-white/45" : "text-[#36e27b]")}>{sub}</span>
    </div>
  )
}

function TeamBadge({ label }) {
  const s = (label || "?").slice(0, 1).toUpperCase()
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm font-black text-white">
        {s}
      </div>
    </div>
  )
}

function OverviewPage({ data }) {
  const { matches } = data
  const byTime = [...matches].sort((a, b) => parseDT(a.datetime) - parseDT(b.datetime))

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-4 px-4 pb-24 pt-6">
      <h1 className="text-xl font-black tracking-tight">영일고 1학년 반대항 축구 토너먼트</h1>

      <Card className="p-5">
        <ul className="list-disc space-y-1 pl-5 text-sm text-white/80">
          <li>12월 22일(월)부터</li>
          <li>토너먼트 한 판 승부!</li>
          <li>경기 일정 / 결과 / 라인업 / 득점 랭킹 / 승부예측 제공</li>
          <li>승부예측에 참여해보세요 !</li>
        </ul>
      </Card>

      <Card className="p-5">
        <div className="mb-2 text-base font-black">전체 일정</div>
        <ul className="space-y-2">
          {byTime.map((m) => (
            <li key={m.id}>
              <Link to={`/match/${m.id}`} className="block rounded-xl border border-white/10 bg-black/20 p-3 hover:bg-white/5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-bold">{m.match_name}</div>
                  <Badge tone={m.status === "종료" ? "good" : m.status === "진행중" ? "warn" : "info"}>{m.status}</Badge>
                </div>
                <div className="mt-1 text-sm text-white/80">
                  {m.home_team} <span className="text-white/50">vs</span> {m.away_team}
                </div>
                <div className="mt-1 text-sm text-white/80">{fmtDT(m.datetime)}</div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

function MatchPage({ data, actions }) {
  const { id } = useParams()
  const matchId = Number(id)
  const navigate = useNavigate()

  const { matches, players, goals, predictions } = data
  const match = matches.find((m) => m.id === matchId)

  const goalsForMatch = useMemo(() => getGoalsByMatch(goals, matchId), [goals, matchId])
  // ✅ 득점자 요약(경기 종료 시 표시용)
  const playerById = useMemo(() => {
    const m = new Map()
    players.forEach((p) => m.set(p.id, p))
    return m
  }, [players])

  const scorersBySide = useMemo(() => {
    const group = (side) => {
      const map = new Map() // key: player_id(or "null::type") -> { name, count }
      goalsForMatch
        .filter((g) => g.team === side && g.goal_type === "normal")
        .forEach((g) => {
          const cnt = Number(g.goal_count || 0)
          if (!cnt) return

          const pid = g.player_id
          const key = String(pid)
          const name = playerById.get(pid)?.name || "알 수 없음"

          const prev = map.get(key) || { name, count: 0 }
          map.set(key, { name: prev.name, count: prev.count + cnt })
        })


      // 많이 넣은 사람 먼저, 그다음 이름순
      return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    }

    return {
      home: group("home"),
      away: group("away"),
    }
  }, [goalsForMatch, playerById])

  const predForMatch = useMemo(() => predictions.filter((p) => p.match_id === matchId), [predictions, matchId])

  const homePlayers = useMemo(() => players.filter((p) => p.class === match?.home_team), [players, match])
  const awayPlayers = useMemo(() => players.filter((p) => p.class === match?.away_team), [players, match])

  const [form, setForm] = useState({ writer_student_no: "", writer_name: "", home_score: "", away_score: "", comment: "" })

  if (!match) {
    return (
      <div className="mx-auto w-full max-w-[900px] space-y-4 px-4 pb-24 pt-6">
        <Card className="p-6">
          <div className="text-lg font-black">경기 없음</div>
          <div className="mt-1 text-sm text-white/60">해당 경기를 찾을 수 없습니다.</div>
          <div className="mt-3">
            <Button onClick={() => navigate("/")}>메인으로</Button>
          </div>
        </Card>
      </div>
    )
  }

  const homeTotals = getTeamTotals(matches, match.home_team)
  const awayTotals = getTeamTotals(matches, match.away_team)
  const canSubmit = isBeforeKickoff(match)

  const exactHits = predForMatch
    .filter((p) => isPredictionHit(match, p))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  const others = predForMatch
    .filter((p) => !isPredictionHit(match, p))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  const orderedPreds = match.status === "종료" ? [...exactHits, ...others] : [...others]

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-4 px-4 pb-24 pt-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-black tracking-tight">경기 상세</h1>
        <Badge tone={match.status === "종료" ? "good" : match.status === "진행중" ? "warn" : "info"}>{match.status}</Badge>
      </div>

      <Card className="p-5">
        <div className="text-sm text-white/60">{match.match_name}</div>
        <div className="mt-1 text-xs text-white/40">{fmtDT(match.datetime)}</div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          {/* HOME ROW */}
          <div className="flex items-start justify-between gap-3">
            {/* LEFT */}
            <div className="min-w-0 flex-1">
              <div className="text-lg font-black">{match.home_team}</div>

              {/* 모바일(sm 미만): 팀명 아래 */}
              {match.status === "종료" ? (
                <div className="mt-2 flex flex-wrap gap-2 sm:hidden">
                  {scorersBySide.home.length === 0 ? (
                    <span className="text-sm text-white/45">득점 없음</span>
                  ) : (
                    scorersBySide.home.map((s) => (
                      <span
                        key={`home-m-${s.name}`}
                        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold"
                        title={`${s.name} ${s.count}골`}
                      >
                        <span className="max-w-[160px] truncate">{s.name}</span>
                        <span className="font-mono text-[#36e27b]">{s.count}</span>
                      </span>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            {/* RIGHT (desktop badges + score) */}
            <div className="flex min-w-0 items-center gap-3">
              {/* 데스크탑(sm 이상): 득점자 있을 때만 */}
              {match.status === "종료" && scorersBySide.home.length > 0 ? (
                <div className="hidden max-w-[520px] flex-wrap justify-end gap-2 sm:flex">
                  {scorersBySide.home.map((s) => (
                    <span
                      key={`home-d-${s.name}`}
                      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold"
                      title={`${s.name} ${s.count}골`}
                    >
                      <span className="max-w-[180px] truncate">{s.name}</span>
                      <span className="font-mono text-[#36e27b]">{s.count}</span>
                    </span>
                  ))}
                </div>
              ) : null}

              {/* 점수: 항상 우측 */}
              <div className="flex-none text-2xl font-black tabular-nums">
                {match.status === "종료" ? match.home_score : "-"}
              </div>
            </div>
          </div>

          <div className="my-3 h-px bg-white/10" />

          {/* AWAY ROW */}
          <div className="flex items-start justify-between gap-3">
            {/* LEFT */}
            <div className="min-w-0 flex-1">
              <div className="text-lg font-black">{match.away_team}</div>

              {/* 모바일(sm 미만): 팀명 아래 */}
              {match.status === "종료" ? (
                <div className="mt-2 flex flex-wrap gap-2 sm:hidden">
                  {scorersBySide.away.length === 0 ? (
                    <span className="text-sm text-white/45">득점 없음</span>
                  ) : (
                    scorersBySide.away.map((s) => (
                      <span
                        key={`away-m-${s.name}`}
                        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold"
                        title={`${s.name} ${s.count}골`}
                      >
                        <span className="max-w-[160px] truncate">{s.name}</span>
                        <span className="font-mono text-[#36e27b]">{s.count}</span>
                      </span>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            {/* RIGHT (desktop badges + score) */}
            <div className="flex min-w-0 items-center gap-3">
              {/* 데스크탑(sm 이상): 득점자 있을 때만 */}
              {match.status === "종료" && scorersBySide.away.length > 0 ? (
                <div className="hidden max-w-[520px] flex-wrap justify-end gap-2 sm:flex">
                  {scorersBySide.away.map((s) => (
                    <span
                      key={`away-d-${s.name}`}
                      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold"
                      title={`${s.name} ${s.count}골`}
                    >
                      <span className="max-w-[180px] truncate">{s.name}</span>
                      <span className="font-mono text-[#36e27b]">{s.count}</span>
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="flex-none text-2xl font-black tabular-nums">
                {match.status === "종료" ? match.away_score : "-"}
              </div>
            </div>
          </div>

          {/* PK 표시는 기존 그대로 유지 */}
          {match.status === "종료" && match.home_pk != null && match.away_pk != null ? (
            <div className="mt-3 text-sm text-white/75">
              PK <span className="font-black text-white">{match.home_pk}</span> :{" "}
              <span className="font-black text-white">{match.away_pk}</span>
            </div>
          ) : null}
        </div>

      </Card>



      <Card className="p-5">
        <div className="mb-2 text-base font-black">팀 누적 기록</div>
        <div className="space-y-2 text-sm text-white/75">
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <div className="font-bold">{homeTotals.team}</div>
            <div className="tabular-nums text-white/80">
              득 <span className="font-black text-white">{homeTotals.gf}</span> / 실{" "}
              <span className="font-black text-white">{homeTotals.ga}</span>{" "}
              <span className="text-white/35">(종료 {homeTotals.played}경기)</span>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <div className="font-bold">{awayTotals.team}</div>
            <div className="tabular-nums text-white/80">
              득 <span className="font-black text-white">{awayTotals.gf}</span> / 실{" "}
              <span className="font-black text-white">{awayTotals.ga}</span>{" "}
              <span className="text-white/35">(종료 {awayTotals.played}경기)</span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-2 text-base font-black">출전 선수 명단 / 누적 골수</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-black">{match.home_team}</div>
              <Badge tone="neutral">HOME</Badge>
            </div>
            <PlayerList players={homePlayers} goals={goals} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-black">{match.away_team}</div>
              <Badge tone="neutral">AWAY</Badge>
            </div>
            <PlayerList players={awayPlayers} goals={goals} />
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div className="text-base font-black">승부예측</div>
          <div className="text-xs text-white/50">{canSubmit ? "경기 시작 전까지 제출 가능" : "경기 시작 이후입니다"}</div>
        </div>

        <div className="mb-3 text-sm text-white/60">
          제출 가능:{" "}
          <span className={cx("font-bold", canSubmit ? "text-[#36e27b]" : "text-rose-300")}>
            {canSubmit ? "가능" : "불가"}
          </span>
        </div>

        {canSubmit ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-bold text-white/55">학번</div>
                <Input value={form.writer_student_no} onChange={(e) => setForm((f) => ({ ...f, writer_student_no: e.target.value }))} />
              </div>
              <div>
                <div className="mb-1 text-xs font-bold text-white/55">이름</div>
                <Input value={form.writer_name} onChange={(e) => setForm((f) => ({ ...f, writer_name: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-bold text-white/55">{match.home_team} 예상 점수</div>
                <Input value={form.home_score} onChange={(e) => setForm((f) => ({ ...f, home_score: e.target.value }))} />
              </div>
              <div>
                <div className="mb-1 text-xs font-bold text-white/55">{match.away_team} 예상 점수</div>
                <Input value={form.away_score} onChange={(e) => setForm((f) => ({ ...f, away_score: e.target.value }))} />
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs font-bold text-white/55">승부예측</div>
              <Textarea value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} />
            </div>
            <div className="flex justify-center">

              <Button
                onClick={() => {
                  if (!isBeforeKickoff(match)) return alert("경기 시작 이후 제출 불가")

                  const studentNo = form.writer_student_no.trim()
                  const writerName = form.writer_name.trim()

                  // 1) 필수값 체크
                  if (!studentNo) return alert("학번을 입력해줘.")
                  if (!writerName) return alert("이름을 입력해줘.")

                  // 2) 점수 파싱 + 검증
                  const hsRaw = String(form.home_score ?? "").trim()
                  const asRaw = String(form.away_score ?? "").trim()
                  if (hsRaw === "" || asRaw === "") return alert("예상 점수를 입력해줘.")

                  // 정수만 허용 (소수/문자 차단)
                  const isIntString = (s) => /^(\d+)$/.test(s)
                  if (!isIntString(hsRaw) || !isIntString(asRaw)) return alert("점수는 0 이상의 정수만 입력해줘.")

                  const hs = Number(hsRaw)
                  const as = Number(asRaw)

                  // 범위 제한 (원하면 0~30 등으로 바꿔도 됨)
                  const MAX_SCORE = 20
                  if (hs < 0 || as < 0) return alert("점수는 음수가 될 수 없어.")
                  if (hs > MAX_SCORE || as > MAX_SCORE) return alert(`점수는 ${MAX_SCORE} 이하로 입력해줘.`)

                  // 3) payload 생성
                  const payload = {
                    writer_student_no: studentNo,
                    writer_name: writerName,
                    match_id: matchId,
                    home_score: hs,
                    away_score: as,
                    comment: (form.comment || "").trim(),
                  }

                  actions.createPrediction(payload)
                  setForm({ writer_student_no: "", writer_name: "", home_score: "", away_score: "", comment: "" })
                }}
              >
                제출
              </Button>

            </div>
          </div>
        ) : (
          <div className="text-sm text-white/60">경기 시작 이후 제출 불가</div>
        )}

        <Divider />

        <div className="mb-2 text-sm font-black">예측 목록</div>
        {orderedPreds.length === 0 ? (
          <div className="text-sm text-white/60">아직 예측이 없습니다.</div>
        ) : (
          <ul className="space-y-2">
            {orderedPreds.map((p) => {
              const hit = isPredictionHit(match, p)
              return (
                <li key={p.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-bold">
                      {p.writer_name} <span className="text-white/35">({p.writer_student_no})</span>
                    </div>
                    {match.status === "종료" ? <Badge tone={hit ? "good" : "neutral"}>{hit ? "적중" : "—"}</Badge> : <Badge tone="info">예측</Badge>}
                  </div>
                  <div className="mt-1 text-sm text-white/75">
                    {match.home_team}{" "}{" "}
                    <span className="font-black text-white">{p.home_score}</span> :{" "}
                    <span className="font-black text-white">{p.away_score}</span>
                    {" "}{" "}{match.away_team}
                  </div>
                  <div className="mt-2 text-sm text-white/85">{p.comment || "(관전평 없음)"}</div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

function AdminPage({ data, actions }) {
  const { matches, players, goals } = data
  const sorted = [...matches].sort((a, b) => a.match_no - b.match_no)

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-4 px-4 pb-24 pt-6">
      <h1 className="text-xl font-black tracking-tight">관리자</h1>

      <Card className="p-5">
        <div className="mb-2 flex items-end justify-between">
          <div className="text-base font-black">경기 결과 / 상태</div>
        </div>

        <div className="space-y-3">
          {sorted.map((m) => (
            <div key={m.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-black">
                  {m.match_no}. {m.match_name}
                </div>
                <Badge tone={m.status === "종료" ? "good" : m.status === "진행중" ? "warn" : "info"}>{m.status}</Badge>
              </div>
              <div className="mt-1 text-xs text-white/40">{fmtDT(m.datetime)}</div>

              <div className="mt-2 text-sm text-white/75">{m.home_team} vs {m.away_team}</div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 text-xs font-bold text-white/55">{m.home_team} 점수</div>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={20}
                    step={1}
                    value={m.home_score == null ? "" : String(m.home_score)}
                    onChange={(e) =>
                      actions.updateMatchDraft(m.id, {
                        home_score: toIntClamped(e.target.value, { min: 0, max: 20, fallback: 0 }),
                      })
                    }
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs font-bold text-white/55">{m.away_team} 점수</div>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={20}
                    step={1}
                    value={m.away_score == null ? "" : String(m.away_score)}
                    onChange={(e) =>
                      actions.updateMatchDraft(m.id, {
                        away_score: toIntClamped(e.target.value, { min: 0, max: 20, fallback: 0 }),
                      })
                    }
                  />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 text-xs font-bold text-white/55">{m.home_team} PK</div>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={30}
                    step={1}
                    value={m.home_pk == null ? "" : String(m.home_pk)}
                    onChange={(e) => {
                      const v = String(e.target.value ?? "").trim()
                      actions.updateMatchDraft(m.id, {
                        home_pk: v === "" ? null : toIntClamped(v, { min: 0, max: 30, fallback: 0 }),
                      })
                    }}
                  />

                </div>
                <div>
                  <div className="mb-1 text-xs font-bold text-white/55">{m.away_team} PK</div>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={30}
                    step={1}
                    value={m.away_pk == null ? "" : String(m.away_pk)}
                    onChange={(e) => {
                      const v = String(e.target.value ?? "").trim()
                      actions.updateMatchDraft(m.id, {
                        away_pk: v === "" ? null : toIntClamped(v, { min: 0, max: 30, fallback: 0 }),
                      })
                    }}
                  />
                </div>
              </div>

              <div className="mt-3">
                <div className="mb-1 text-xs font-bold text-white/55">상태</div>
                <Select value={m.status} onChange={(e) => actions.updateMatchDraft(m.id, { status: e.target.value })}>
                  <option value="예정">예정</option>
                  <option value="진행중">진행중</option>
                  <option value="종료">종료</option>
                </Select>
              </div>

              <div className="mt-3 text-xs text-white/45">
                골 합계(참고): {sumGoals(getGoalsByMatch(goals, m.id), "home")} : {sumGoals(getGoalsByMatch(goals, m.id), "away")}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-2 flex items-end justify-between">
          <div className="text-base font-black">득점 입력</div>
        </div>

        <div className="space-y-4">
          {sorted.map((m) => (
            <GoalEditor
              key={m.id}
              match={m}
              players={players}
              goals={goals}
              upsertGoal={actions.upsertGoalDraft}
              deleteGoal={actions.deleteGoalDraft}
            />
          ))}
        </div>
      </Card>

      <div className="flex gap-2">
        <Button onClick={actions.saveAdminChanges}>저장</Button>
        <Button variant="ghost" onClick={actions.resetAdminChanges}>변경 취소</Button>
      </div>
    </div>
  )
}

function PlayerList({ players, goals }) {
  const sorted = [...players].sort((a, b) => a.number - b.number)

  if (sorted.length === 0) return <div className="text-sm text-white/60">선수 데이터가 없습니다.</div>

  return (
    <ul className="space-y-2">
      {sorted.map((p) => {
        const g = getPlayerNormalGoalsTotal(goals, p.id)
        return (
          <li key={p.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <div className="text-sm">
              <span className="mr-2 font-black text-white/80">{p.number}</span>
              <span className="font-black text-white">{p.name}</span>{" "}
              <span className="text-white/35">({p.position})</span>
            </div>
            {g >= 1 ? <div className="text-sm font-black text-white">{g}골</div> : <div className="text-xs text-white/35"> </div>}
          </li>
        )
      })}
    </ul>
  )
}

function Bracket({ matches }) {
  const sorted = [...matches].sort((a, b) => a.match_no - b.match_no)
  const upcoming = sorted.filter(m => m.status !== "종료")
  const finished = sorted.filter(m => m.status === "종료")

  const statusTone = (s) => (s === "종료" ? "good" : s === "진행중" ? "warn" : "info")

  const MatchRow = ({ m }) => (
    <Link to={`/match/${m.id}`} className="block rounded-xl border border-white/10 bg-black/20 p-3 hover:bg-white/5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold">{m.match_name}</div>
        <Badge tone={statusTone(m.status)}>{m.status}</Badge>
      </div>
      <div className="mt-1 text-sm text-white/75">
        {m.status === "종료" ? (
          <>
            {m.home_team} <span className="font-black text-white">{m.home_score}</span> :{" "}
            <span className="font-black text-white">{m.away_score}</span> {m.away_team}
            {m.home_pk != null && m.away_pk != null ? <span className="text-white/45"> (PK {m.home_pk}:{m.away_pk})</span> : null}
          </>
        ) : (
          <>
            {m.home_team} <span className="text-white/35">vs</span> {m.away_team}
          </>
        )}
      </div>
      <div className="mt-1 text-xs text-white/40">{fmtDT(m.datetime)}</div>
    </Link>
  )

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-black">예정 / 진행중</div>
          <Badge tone="info">{upcoming.length}경기</Badge>
        </div>
        {upcoming.length === 0 ? (
          <div className="text-sm text-white/60">예정된 경기가 없습니다.</div>
        ) : (
          <div className="space-y-2">
            {upcoming.map((m) => <MatchRow key={m.id} m={m} />)}
          </div>
        )}
      </div>

      <Divider />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-black">종료</div>
          <Badge tone="good">{finished.length}경기</Badge>
        </div>
        {finished.length === 0 ? (
          <div className="text-sm text-white/60">종료된 경기가 없습니다.</div>
        ) : (
          <div className="space-y-2">
            {finished.map((m) => <MatchRow key={m.id} m={m} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function GoalEditor({ match, players, goals, upsertGoal, deleteGoal }) {
  const goalsForMatch = goals.filter((g) => g.match_id === match.id)
  const homePlayers = players.filter((p) => p.class === match.home_team).sort((a, b) => a.number - b.number)
  const awayPlayers = players.filter((p) => p.class === match.away_team).sort((a, b) => a.number - b.number)

  const newGoalTemplate = (team) => ({
    id: null,
    match_id: match.id,
    team,
    player_id: null,
    goal_count: 1,
    goal_type: "normal",
  })

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-black">{match.match_name}</div>
        <div className="text-xs text-white/40">match_id: {match.id}</div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-black">{match.home_team} (home)</div>
            <Button variant="ghost" onClick={() => upsertGoal(newGoalTemplate("home"))} className="px-3 py-1 text-xs">
              + 추가
            </Button>
          </div>
          <GoalList candidates={homePlayers} rows={goalsForMatch.filter((g) => g.team === "home")} onChange={upsertGoal} onDelete={deleteGoal} />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-black">{match.away_team} (away)</div>
            <Button variant="ghost" onClick={() => upsertGoal(newGoalTemplate("away"))} className="px-3 py-1 text-xs">
              + 추가
            </Button>
          </div>
          <GoalList candidates={awayPlayers} rows={goalsForMatch.filter((g) => g.team === "away")} onChange={upsertGoal} onDelete={deleteGoal} />
        </div>
      </div>
    </div>
  )
}

function GoalList({ candidates, rows, onChange, onDelete }) {
  const goalTypeOptions = [
    { value: "normal", label: "골" },
    { value: "own_goal", label: "자책골" },
    { value: "etc", label: "기타" },
  ]

  if (rows.length === 0) return <div className="text-sm text-white/45">득점 기록 없음</div>

  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id ?? r._tmp} className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="space-y-2">
            <div>
              <div className="mb-1 text-xs font-bold text-white/55">선수</div>
              <Select
                value={r.player_id == null ? "" : String(r.player_id)}
                onChange={(e) => onChange({ ...r, player_id: e.target.value === "" ? null : Number(e.target.value) })}
              >
                <option value="">— (null: 기타/미상/자책 등)</option>
                {candidates.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.number} {p.name} ({p.position})
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="mb-1 text-xs font-bold text-white/55">득점 수</div>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={20}
                  step={1}
                  value={r.goal_count == null ? "1" : String(r.goal_count)}
                  onChange={(e) =>
                    onChange({
                      ...r,
                      goal_count: toIntClamped(e.target.value, { min: 1, max: 20, fallback: 1 }),
                    })
                  }
                />

              </div>

              <div>
                <div className="mb-1 text-xs font-bold text-white/55">goal_type</div>
                <Select value={r.goal_type} onChange={(e) => onChange({ ...r, goal_type: e.target.value })}>
                  {goalTypeOptions.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>

              </div>
            </div>

            <div className="flex justify-end">
              <Button variant="danger" onClick={() => onDelete(r.id ?? r._tmp)} className="px-3 py-2 text-xs">
                삭제
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function NotFound() {
  return (
    <div className="mx-auto w-full max-w-[900px] space-y-4 px-4 pb-24 pt-6">
      <Card className="p-6">
        <div className="text-lg font-black">404</div>
        <div className="mt-1 text-sm text-white/60">페이지를 찾을 수 없습니다.</div>
        <div className="mt-3">
          <Link to="/">
            <Button>메인으로</Button>
          </Link>
        </div>
      </Card>
    </div>
  )
}

function AdminGuard({ children }) {
  const [ok, setOk] = useState(() => localStorage.getItem(ADMIN_KEY) === "1")
  const [pw, setPw] = useState("")
  const navigate = useNavigate()

  if (!ok) {
    return (
      <div className="mx-auto w-full max-w-[900px] space-y-4 px-4 pb-24 pt-6">
        <h1 className="text-xl font-black tracking-tight">관리자 접속</h1>

        <Card className="p-6">
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-bold text-white/55">비밀번호</div>
              <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => {
                  if (pw === ADMIN_PASS) {
                    localStorage.setItem(ADMIN_KEY, "1")
                    setOk(true)
                  } else {
                    alert("비밀번호가 틀렸습니다.")
                  }
                }}
              >
                확인
              </Button>
              <Button variant="ghost" onClick={() => navigate("/")}>
                메인으로
              </Button>
            </div>

            <div className="text-xs text-white/45">
              * 경기 결과를 입력하는 선생님만 로그인할 수 있습니다.
            </div>
          </div>
        </Card>
      </div>
    )
  }

  return children
}

// ------------------------
// 5) Icons (inline SVG)
// ------------------------

function IconSoccerBall({ className = "" }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"          // 🔽 내부 선 인식 좋아지는 핵심
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* outer circle */}
      <circle cx="32" cy="32" r="28" />

      {/* center pentagon */}
      <polygon points="32 18 40 24 37 34 27 34 24 24" />

      {/* radial lines */}
      <line x1="32" y1="18" x2="32" y2="6" />
      <line x1="24" y1="24" x2="12" y2="20" />
      <line x1="40" y1="24" x2="52" y2="20" />
      <line x1="27" y1="34" x2="18" y2="46" />
      <line x1="37" y1="34" x2="46" y2="46" />
    </svg>
  )
}


function IconHistory({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M3 12a9 9 0 1 0 3-6.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M3 4v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconTrophy({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M8 4h8v3a4 4 0 0 1-8 0V4Z" stroke="currentColor" strokeWidth="2" />
      <path d="M6 4H4v2a4 4 0 0 0 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M18 4h2v2a4 4 0 0 1-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 11v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 20h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 14h4v6h-4z" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function IconBrain({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path
        d="M8.5 4.5a3 3 0 0 0-3 3v.2A3 3 0 0 0 4 10.4V14a4 4 0 0 0 4 4h1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M15.5 4.5a3 3 0 0 1 3 3v.2a3 3 0 0 1 1.5 2.7V14a4 4 0 0 1-4 4h-1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M12 4v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
    </svg>
  )
}

function IconBall({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10Z" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7l3 2-1 4h-4l-1-4 3-2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M7.5 10.5 9 9M16.5 10.5 15 9M10 13l-2 2M14 13l2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function IconInfo({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10Z" stroke="currentColor" strokeWidth="2" />
      <path d="M12 10v7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 7h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function IconHelp({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10Z" stroke="currentColor" strokeWidth="2" />
      <path d="M9.5 9a2.5 2.5 0 1 1 4.1 1.9c-.8.6-1.6 1.1-1.6 2.1v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 17h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function IconShield({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M12 2 20 6v6c0 5-3.5 9.4-8 10-4.5-.6-8-5-8-10V6l8-4Z" stroke="currentColor" strokeWidth="2" />
      <path d="M9 12l2 2 4-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconMail({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M4 6h16v12H4z" stroke="currentColor" strokeWidth="2" />
      <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}
