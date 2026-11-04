import { useEffect, useMemo, useState } from "react";
import { useMe } from "../App";
import { api, timeAgo, type Journal, type WeeklyReport } from "../api";
import { Segmented, Window } from "../components/Window";
import { CheckIcon, FlameIcon } from "../components/icons";

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow", month: "numeric", day: "numeric" });
/** Badge art made with Muse Image (backend/scripts/generate-art.ts). */
const badgeArt = (id: string) => `/art/badges/${id}.webp`;

const PARTS: { key: keyof WeeklyReport["parts"]; label: string; max: number; hint: (r: WeeklyReport) => string }[] = [
  { key: "resist", label: "Resisting", max: 40, hint: (r) => `${r.week.putdowns} put-downs · ${r.week.slips} slips` },
  { key: "focus", label: "Focus", max: 30, hint: (r) => `${r.week.focusMinutes} / ${r.focusTargetMinutes} min` },
  { key: "consistency", label: "Consistency", max: 20, hint: (r) => `${r.week.activeDays} / 7 days` },
  { key: "streak", label: "Streak", max: 10, hint: () => "toward 7 days" },
];

function ReportCard({ report }: { report: WeeklyReport }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  return (
    <section className="card report-card" aria-label="This week's Focus Score">
      <div className="score-ring">
        <svg viewBox="0 0 160 160" aria-hidden="true">
          <defs>
            <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#8ec2f9" />
              <stop offset="1" stopColor="#2a6fd0" />
            </linearGradient>
          </defs>
          <circle cx="80" cy="80" r={r} className="ring-bg" />
          <circle cx="80" cy="80" r={r} className="ring-fg" strokeDasharray={`${(c * report.score) / 100} ${c}`} />
        </svg>
        <div className="score-v">
          <b>{report.score}</b>
          <span>Focus Score</span>
        </div>
      </div>
      <div>
        <h2>
          {report.score >= 70 ? "A strong week." : report.score >= 40 ? "Getting there." : "A fresh start."}
          {report.delta !== null && report.delta !== 0 && (
            <span className={`score-delta ${report.delta > 0 ? "up" : "down"}`}>
              {report.delta > 0 ? "+" : "-"}{Math.abs(report.delta)} on last week
            </span>
          )}
        </h2>
        {report.note && (
          <p className="report-note">
            <img src="/tubby/tubby_happy.png" alt="" />
            <span>{report.note}</span>
          </p>
        )}
        <div className="report-parts">
          {PARTS.map((p) => (
            <div key={p.key}>
              <b>{report.parts[p.key]}</b><small> / {p.max} {p.label}</small>
              <div className="progress"><div style={{ width: `${(report.parts[p.key] / p.max) * 100}%` }} /></div>
              <small>{p.hint(report)}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Achievements() {
  const { me } = useMe();
  const [filter, setFilter] = useState<"all" | "unlocked" | "locked">("all");
  const [journal, setJournal] = useState<Journal | null>(null);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  useEffect(() => {
    api<Journal>("/journal?days=14").then(setJournal).catch(() => undefined);
    api<WeeklyReport>("/report/weekly").then(setReport).catch(() => undefined);
  }, [me?.balance]);
  const all = me?.achievements ?? [];
  const unlocked = all.filter((a) => a.unlocked).length;
  const pct = all.length ? (unlocked / all.length) * 100 : 0;

  const next = useMemo(
    () => [...all].filter((a) => !a.unlocked).sort((a, b) => b.progress - a.progress)[0],
    [all],
  );

  const shown = all.filter((a) => (filter === "all" ? true : filter === "unlocked" ? a.unlocked : !a.unlocked));

  return (
    <div className="page achievements-page">
      <Window
        title="Achievements"
        toolbar={
          <>
            <div className="toolbar-figure">
              <b>{unlocked}<small>of {all.length} badges</small></b>
              <div className="progress-wrap">
                <div className="progress ach-hero-progress"><div style={{ width: `${pct}%` }} /></div>
              </div>
            </div>
            <div className="toolbar-facts muted small">
              <span><FlameIcon size={14} /> {me?.streak ?? 0}-day streak</span>
              <span>Best {me?.bestStreak ?? 0} days</span>
            </div>
          </>
        }
      >
      {report && <ReportCard report={report} />}

      {next && (
        <section className="card next-badge">
          <img className="ach-art" src={badgeArt(next.id)} alt="" />
          <div className="grow">
            <h3>Next up: {next.name}</h3>
            <p className="muted small">{next.description}</p>
            <div className="progress"><div style={{ width: `${next.progress * 100}%` }} /></div>
          </div>
          <span className="next-detail">{next.detail}</span>
        </section>
      )}

      <Segmented
        className="ach-tabs"
        label="Achievement filter"
        value={filter}
        onChange={setFilter}
        options={(["all", "unlocked", "locked"] as const).map((f) => ({
          value: f,
          label: <>{f === "all" ? "All" : f === "unlocked" ? "Unlocked" : "Locked"} <span className="count">{f === "all" ? all.length : f === "unlocked" ? unlocked : all.length - unlocked}</span></>,
        }))}
      />

      <div className="ach-grid">
        {shown.map((a) => (
          <article key={a.id} className={`ach-card card ${a.unlocked ? "on" : ""}`}>
            <img className="ach-art" src={badgeArt(a.id)} alt="" loading="lazy" />
            <div className="ach-body">
              <h3>{a.name}</h3>
              <p className="muted small">{a.description}</p>
              <div className="progress"><div style={{ width: `${a.progress * 100}%` }} /></div>
              <div className="ach-meta">
                <span>{a.unlocked ? "Unlocked" : a.detail}</span>
                <span>{Math.round(a.progress * 100)}%</span>
              </div>
            </div>
          </article>
        ))}
        {shown.length === 0 && (
          <div className="card empty">
            <p><b>Nothing here yet.</b></p>
            <p className="muted small">Finish a focus session or put a distraction down to start unlocking.</p>
          </div>
        )}
      </div>

      {journal && journal.totals.earned + journal.totals.burned > 0 && (
        <section className="card patterns-card">
          <div className="section-head">
            <h2>Your last 14 days</h2>
            {journal.peakHour !== null && (
              <span className="muted small">Most tempted around {hourLabel(journal.peakHour)}</span>
            )}
          </div>
          <div className="patterns-bars" role="img" aria-label="Points earned per day for the last 14 days">
            {journal.days.map((d) => {
              const max = Math.max(...journal.days.map((x) => Math.max(x.earned, x.burned)), 1);
              const h = Math.max(4, Math.round((Math.max(d.earned, d.burned) / max) * 72));
              const neg = d.burned > d.earned;
              return (
                <span
                  key={d.date}
                  className={`bar ${neg ? "neg" : ""} ${d.earned + d.burned === 0 ? "empty" : ""}`}
                  style={{ height: `${h}px` }}
                  title={`${dayLabel(d.date)}: +${d.earned} earned, -${d.burned} burned, ${d.putdowns} put-downs, ${d.slips} slips, ${d.focusMinutes} focus min`}
                />
              );
            })}
          </div>
          <div className="patterns-totals muted small">
            <span><b className="pos">+{journal.totals.earned}</b> earned</span>
            <span><b className="neg">-{journal.totals.burned}</b> burned</span>
            <span><b>{journal.totals.putdowns}</b> put-downs</span>
            <span><b>{journal.totals.slips}</b> slips</span>
            <span><b>{journal.totals.focusMinutes}</b> focus min</span>
            {journal.bestDay && <span>best day <b>{dayLabel(journal.bestDay.date)}</b></span>}
          </div>
        </section>
      )}

      <section className="card">
        <div className="section-head">
          <h2>Recent activity</h2>
        </div>
        <ul className="ledger">
          {me?.recent.length ? null : <li className="muted">Nothing yet. A single put-down starts the story.</li>}
          {me?.recent.map((r, i) => (
            <li key={i}>
              <span className={r.delta >= 0 ? "pos" : "neg"}>{r.delta === 0 ? <CheckIcon size={15} /> : `${r.delta > 0 ? "+" : ""}${r.delta}`}</span>
              <span>{r.reason}</span>
              <small className="muted">{timeAgo(r.at)}</small>
            </li>
          ))}
        </ul>
      </section>
      </Window>
    </div>
  );
}
