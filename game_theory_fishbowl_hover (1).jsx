import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

// Single-file React component: visualized autonomous Game Theory fishbowl
// This variant adds interactive hover/tooltips for educational exploration.

// --- Simulation params ---
const PD = {
  R: 3,
  T: 5,
  P: 1,
  S: 0,
};

const ITERATED_LENGTH = 20;
const PAUSE_BETWEEN_MATCHES_MS = 300;
const AGENT_COUNT = 10;

const ClassicStrategies = [
  { 
    id: "C_ALWAYS", 
    name: "Always Cooperate", 
    fn: (history) => "C", 
    desc: "The altruist - always cooperates regardless of opponent behavior.",
    reasoning: "Philosophy: Trust and cooperation lead to mutual benefit. This strategy embodies unconditional altruism and assumes others will reciprocate kindness.",
    strengths: ["Maximizes mutual cooperation when paired with similar strategies", "Simple and predictable", "Encourages cooperative environments"],
    weaknesses: ["Vulnerable to exploitation by defectors", "Cannot adapt to hostile opponents", "Often finishes last in mixed tournaments"],
    realWorld: "Like a person who always helps others regardless of how they're treated - admirable but potentially naive.",
    performance: "Excellent against other cooperators, terrible against defectors. Often used as a baseline 'nice' strategy.",
  },
  { 
    id: "D_ALWAYS", 
    name: "Always Defect", 
    fn: (history) => "D", 
    desc: "The pure egoist - always defects to maximize personal gain.",
    reasoning: "Philosophy: Self-interest above all. This strategy assumes others will eventually defect, so striking first is optimal.",
    strengths: ["Cannot be exploited", "Maximizes short-term gains", "Performs well against naive cooperators"],
    weaknesses: ["Mutual defection yields lower scores than cooperation", "Destroys potential for beneficial relationships", "Predictably hostile"],
    realWorld: "Like a person who always puts themselves first, never trusting others - protected but isolated.",
    performance: "Dominates naive strategies but loses to tit-for-tat style responses. Classic 'hawk' behavior.",
  },
  {
    id: "TFT",
    name: "Tit for Tat",
    fn: (history) => {
      if (history.length === 0) return "C";
      return history[history.length - 1].opp;
    },
    desc: "The mirror - starts friendly but reciprocates exactly what opponent did last.",
    reasoning: "Philosophy: Be nice, retaliatory, forgiving, and clear. Start with trust, punish betrayal immediately, but give second chances.",
    strengths: ["Nice (never defects first)", "Retaliatory (punishes defection)", "Forgiving (returns to cooperation)", "Clear and predictable"],
    weaknesses: ["Can get stuck in defection cycles", "Vulnerable to noise/misunderstandings", "Not always optimal against complex strategies"],
    realWorld: "Like a fair person who treats you exactly as you treat them - trustworthy but firm about boundaries.",
    performance: "Winner of Axelrod's original tournament. Excellent balance of cooperation and retaliation.",
  },
  { 
    id: "RANDOM", 
    name: "Random", 
    fn: () => (Math.random() < 0.5 ? "C" : "D"), 
    desc: "The chaotic agent - flips a coin each round (50% cooperation).",
    reasoning: "Philosophy: Unpredictability as a strategy. By being random, this agent cannot be predicted or exploited systematically.",
    strengths: ["Completely unpredictable", "Cannot be systematically exploited", "Provides noise that can break deadlocks"],
    weaknesses: ["No coherent strategy", "Cannot build trust or sustained cooperation", "Performance is mediocre and inconsistent"],
    realWorld: "Like a person whose behavior is completely unpredictable - neither friend nor foe, just chaotic.",
    performance: "Mediocre against all strategies. Useful as a control or noise-maker in experiments.",
  },
  {
    id: "GRIM",
    name: "Grim Trigger",
    fn: (history) => (history.some((h) => h.opp === "D") ? "D" : "C"),
    desc: "The unforgiving enforcer - cooperates until betrayed once, then defects forever.",
    reasoning: "Philosophy: Trust completely until betrayed, then never trust again. This creates strong deterrent against defection.",
    strengths: ["Strong deterrent effect", "Maximizes cooperation when it works", "Clear consequences for betrayal"],
    weaknesses: ["Extremely unforgiving", "Vulnerable to single mistakes or noise", "Cannot recover from misunderstandings"],
    realWorld: "Like someone who gives complete trust initially but cuts you off permanently after one betrayal.",
    performance: "Excellent when cooperation is sustained, catastrophic after any defection. High-risk, high-reward.",
  },
  {
    id: "PAVLOV",
    name: "Pavlov (Win-Stay, Lose-Shift)",
    fn: (history) => {
      if (history.length === 0) return "C";
      const last = history[history.length - 1];
      const payoff = payoffFor(last.me, last.opp);
      if (payoff === PD.R || payoff === PD.T) return last.me;
      return last.me === "C" ? "D" : "C";
    },
    desc: "The learner - repeats successful moves, changes after poor outcomes.",
    reasoning: "Philosophy: Learn from results. If the last move was rewarding (R=3 or T=5), repeat it. If it was punishing (S=0 or P=1), try something different.",
    strengths: ["Adaptive to opponent behavior", "Good in noisy environments", "Can exploit simple patterns", "Self-correcting"],
    weaknesses: ["Can be exploited by complex patterns", "Sometimes changes successful cooperation", "May not recognize long-term strategies"],
    realWorld: "Like someone who learns from immediate feedback - pragmatic but sometimes short-sighted.",
    performance: "Robust in many environments. Good balance of adaptation and stability.",
  },
];

function payoffFor(meMove, oppMove) {
  if (meMove === "C" && oppMove === "C") return PD.R;
  if (meMove === "C" && oppMove === "D") return PD.S;
  if (meMove === "D" && oppMove === "C") return PD.T;
  return PD.P;
}

function createAdaptiveAgent(id) {
  const p_afterC = 0.45 + Math.random() * 0.1;
  const p_afterD = 0.45 + Math.random() * 0.1;
  return { 
    id, 
    name: `Adaptive-${id}`, 
    type: "ADAPTIVE", 
    policy: { p_afterC, p_afterD }, 
    score: 0, 
    desc: "AI learning agent that adapts cooperation based on reward feedback.",
    reasoning: "Philosophy: Learn from experience through reinforcement. Adjusts cooperation probability based on whether cooperation or defection has been more rewarding recently.",
    strengths: ["Adapts to opponent patterns", "Learns optimal responses over time", "Can exploit predictable opponents", "Balances exploration and exploitation"],
    weaknesses: ["May be slow to adapt", "Can forget long-term patterns", "Vulnerable during learning phase", "May overcorrect to recent experiences"],
    realWorld: "Like a person who learns from trial and error, gradually figuring out the best way to deal with different people.",
    performance: "Variable - starts random but can become very effective against predictable opponents. Represents modern AI approaches.",
    learningMechanism: "Uses gradient-based policy updates with learning rate 0.06. Increases cooperation probability when cooperation yields higher average rewards.",
  };
}

function adaptiveDecision(agent, history) {
  if (history.length === 0) return Math.random() < agent.policy.p_afterC ? "C" : "D";
  const lastOpp = history[history.length - 1].opp;
  const p = lastOpp === "C" ? agent.policy.p_afterC : agent.policy.p_afterD;
  return Math.random() < p ? "C" : "D";
}

function adaptAgentAfterMatch(agent, matches) {
  let coopReward = 0,
    coopCount = 0,
    defReward = 0,
    defCount = 0;
  for (const r of matches) {
    const rew = payoffFor(r.me, r.opp);
    if (r.me === "C") {
      coopReward += rew;
      coopCount++;
    } else {
      defReward += rew;
      defCount++;
    }
  }
  const avgC = coopCount ? coopReward / coopCount : 0;
  const avgD = defCount ? defReward / defCount : 0;
  const lr = 0.06;
  if (avgC > avgD) {
    agent.policy.p_afterC = Math.min(0.98, agent.policy.p_afterC + lr * (avgC - avgD));
    agent.policy.p_afterD = Math.min(0.98, agent.policy.p_afterD + lr * (avgC - avgD) * 0.6);
  } else if (avgD > avgC) {
    agent.policy.p_afterC = Math.max(0.02, agent.policy.p_afterC - lr * (avgD - avgC));
    agent.policy.p_afterD = Math.max(0.02, agent.policy.p_afterD - lr * (avgD - avgC) * 0.6);
  }
  agent.policy.p_afterC = Math.min(0.99, Math.max(0.01, agent.policy.p_afterC + (Math.random() - 0.5) * 0.02));
  agent.policy.p_afterD = Math.min(0.99, Math.max(0.01, agent.policy.p_afterD + (Math.random() - 0.5) * 0.02));
}

function initializeAgents() {
  const agents = [];
  for (let i = 0; i < ClassicStrategies.length; i++) agents.push({ ...ClassicStrategies[i], score: 0, isClassic: true });
  let aid = 1;
  while (agents.length < AGENT_COUNT) agents.push(createAdaptiveAgent(aid++));
  return agents;
}

function runIteratedMatch(A, B) {
  const history = [];
  const historyB = [];
  let scoreA = 0,
    scoreB = 0;
  for (let r = 0; r < ITERATED_LENGTH; r++) {
    const aMove = decideMove(A, history, historyB);
    const bMove = decideMove(B, historyB, history);
    history.push({ me: aMove, opp: bMove });
    historyB.push({ me: bMove, opp: aMove });
    scoreA += payoffFor(aMove, bMove);
    scoreB += payoffFor(bMove, aMove);
  }
  return { history, historyB, scoreA, scoreB };
}

function decideMove(agent, history, oppHistory) {
  if (agent.isClassic) return agent.fn(history, agent, oppHistory);
  return adaptiveDecision(agent, oppHistory);
}

function Tooltip({ x, y, content, visible }) {
  if (!visible || !content) return null;
  
  // Better positioning - closer to mouse and responsive to screen edges
  const tooltipWidth = 380;
  const tooltipHeight = 450;
  const offset = 8;
  
  // Calculate position to keep tooltip on screen
  let left = x + offset;
  let top = y + offset;
  
  // Adjust if too close to right edge
  if (left + tooltipWidth > window.innerWidth - 20) {
    left = x - tooltipWidth - offset;
  }
  
  // Adjust if too close to bottom edge  
  if (top + tooltipHeight > window.innerHeight - 20) {
    top = y - tooltipHeight - offset;
  }
  
  // Ensure minimum distance from edges
  left = Math.max(10, Math.min(left, window.innerWidth - tooltipWidth - 10));
  top = Math.max(10, Math.min(top, window.innerHeight - tooltipHeight - 10));

  const style = {
    position: "fixed", // Use fixed positioning for better control
    left: left,
    top: top,
    width: tooltipWidth,
    height: tooltipHeight,
    zIndex: 1000,
    pointerEvents: "auto", // Allow interaction with tooltip content
    background: "rgba(8,9,12,0.98)",
    color: "white",
    padding: "16px",
    borderRadius: 12,
    boxShadow: "0 20px 40px rgba(2,6,23,0.8)",
    fontSize: 13,
    lineHeight: 1.4,
    border: "1px solid rgba(255,255,255,0.2)",
    overflowY: "auto",
    overflowX: "hidden",
    backdropFilter: "blur(8px)",
  };

  return (
    <div style={style} role="tooltip" aria-hidden={!visible}>
      {/* Header */}
      <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 15, color: "#60a5fa" }}>
        {content.title}
      </div>
      
      {/* Basic Description */}
      <div style={{ marginBottom: 12, opacity: 0.95 }}>
        {content.desc}
      </div>

      {/* Philosophy/Reasoning */}
      {content.reasoning && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#34d399" }}>🧠 Strategy Philosophy:</div>
          <div style={{ fontSize: 12, opacity: 0.9, fontStyle: "italic" }}>{content.reasoning}</div>
        </div>
      )}

      {/* Real World Analogy */}
      {content.realWorld && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#f59e0b" }}>🌍 Real World Analogy:</div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>{content.realWorld}</div>
        </div>
      )}

      {/* Strengths */}
      {content.strengths && content.strengths.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#10b981" }}>✅ Strengths:</div>
          <ul style={{ fontSize: 11, opacity: 0.9, paddingLeft: 16, margin: 0 }}>
            {content.strengths.map((strength, i) => (
              <li key={i} style={{ marginBottom: 2 }}>{strength}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Weaknesses */}
      {content.weaknesses && content.weaknesses.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#ef4444" }}>❌ Weaknesses:</div>
          <ul style={{ fontSize: 11, opacity: 0.9, paddingLeft: 16, margin: 0 }}>
            {content.weaknesses.map((weakness, i) => (
              <li key={i} style={{ marginBottom: 2 }}>{weakness}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Learning Mechanism (for adaptive agents) */}
      {content.learningMechanism && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#8b5cf6" }}>🤖 Learning Mechanism:</div>
          <div style={{ fontSize: 11, opacity: 0.9 }}>{content.learningMechanism}</div>
        </div>
      )}

      {/* Performance Notes */}
      {content.performance && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#06b6d4" }}>📊 Performance Notes:</div>
          <div style={{ fontSize: 11, opacity: 0.9 }}>{content.performance}</div>
        </div>
      )}

      {/* Current State */}
      <div style={{ 
        borderTop: "1px solid rgba(255,255,255,0.1)", 
        paddingTop: 8, 
        marginTop: 8,
        background: "rgba(255,255,255,0.02)",
        margin: "8px -16px -16px -16px",
        padding: "8px 16px",
        borderRadius: "0 0 12px 12px"
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4, color: "#fbbf24" }}>📈 Current Status:</div>
        <div style={{ fontSize: 11, opacity: 0.9, marginBottom: 4 }}>{content.score}</div>
        {content.details && (
          <div style={{ fontSize: 10, opacity: 0.8, fontFamily: "monospace" }}>{content.details}</div>
        )}
      </div>
      
      {/* Close hint */}
      <div style={{ 
        position: "absolute", 
        top: 8, 
        right: 12, 
        fontSize: 10, 
        opacity: 0.5,
        color: "#94a3b8" 
      }}>
        Click outside to close
      </div>
    </div>
  );
}

export default function GameTheoryFishbowl() {
  const [agents, setAgents] = useState(() => initializeAgents());
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [tick, setTick] = useState(0);
  const [chartData, setChartData] = useState([]);
  const [hovered, setHovered] = useState(null);
  const [stickyTooltip, setStickyTooltip] = useState(null);
  const containerRef = useRef(null);
  const intervalRef = useRef(null);
  const tooltipTimeoutRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      // Close sticky tooltip when clicking outside
      if (stickyTooltip && !event.target.closest('[role="tooltip"]')) {
        setStickyTooltip(null);
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      clearInterval(intervalRef.current);
      clearTimeout(tooltipTimeoutRef.current);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [stickyTooltip]);

  function startSimulation() {
    if (running) return;
    setRunning(true);
    setLog([]);
    setTick(0);
    setChartData([]);
    let localAgents = agents.map((a) => ({ ...a, score: 0 }));
    setAgents(localAgents);

    intervalRef.current = setInterval(() => {
      const i = Math.floor(Math.random() * localAgents.length);
      let j = Math.floor(Math.random() * localAgents.length);
      while (j === i) j = Math.floor(Math.random() * localAgents.length);
      const A = localAgents[i];
      const B = localAgents[j];
      const outcome = runIteratedMatch(A, B);
      A.score += outcome.scoreA;
      B.score += outcome.scoreB;
      if (!A.isClassic) adaptAgentAfterMatch(A, outcome.history);
      if (!B.isClassic) adaptAgentAfterMatch(B, outcome.historyB);
      const entry = `${A.name} vs ${B.name}: ${outcome.scoreA.toFixed(0)} - ${outcome.scoreB.toFixed(0)}`;
      setLog((l) => [entry, ...l].slice(0, 12));
      const snapshot = localAgents.map((a) => ({ name: a.name, score: a.score })).sort((a, b) => b.score - a.score).slice(0, 6);
      setChartData((cd) => [{ tick: tick + 1, ...snapshot.reduce((acc, cur, idx) => ({ ...acc, ["s" + idx]: cur.score }), {}) }, ...cd].slice(0, 40));
      setTick((t) => t + 1);
      setAgents([...localAgents]);
    }, PAUSE_BETWEEN_MATCHES_MS);
  }

  function buildTooltipContent(agent) {
    const base = { 
      title: agent.name + (agent.isClassic ? " — Classic Strategy" : " — Learning AI"), 
      desc: agent.desc || "",
      reasoning: agent.reasoning || "",
      strengths: agent.strengths || [],
      weaknesses: agent.weaknesses || [],
      realWorld: agent.realWorld || "",
      performance: agent.performance || "",
      details: null 
    };
    
    if (!agent.isClassic) {
      base.details = `Current Policy: P(coop|opponent cooperated) = ${(agent.policy.p_afterC || 0).toFixed(3)}, P(coop|opponent defected) = ${(agent.policy.p_afterD || 0).toFixed(3)}`;
      base.learningMechanism = agent.learningMechanism || "";
    } else {
      base.details = `Fixed strategy - behavior never changes`;
    }
    
    base.score = `Current Score: ${Math.round(agent.score || 0)}`;
    return base;
  }

  function handleEnterAgent(e, agent) {
    clearTimeout(tooltipTimeoutRef.current);
    const rect = containerRef.current?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : e.clientX;
    const y = rect ? e.clientY - rect.top : e.clientY;
    
    const tooltipData = {
      agent,
      x: e.clientX, // Use screen coordinates for better positioning
      y: e.clientY,
      content: buildTooltipContent(agent)
    };
    
    setHovered(tooltipData);
  }

  function handleMoveAgent(e) {
    if (!hovered && !stickyTooltip) return;
    
    // Update position for non-sticky tooltip
    if (hovered && !stickyTooltip) {
      setHovered(h => h ? { 
        ...h, 
        x: e.clientX, 
        y: e.clientY 
      } : h);
    }
  }

  function handleLeaveAgent() {
    // Delay hiding to allow mouse to move to tooltip
    tooltipTimeoutRef.current = setTimeout(() => {
      if (!stickyTooltip) {
        setHovered(null);
      }
    }, 150);
  }

  function handleClickAgent(e, agent) {
    e.preventDefault();
    // Make tooltip sticky on click
    const tooltipData = {
      agent,
      x: e.clientX,
      y: e.clientY,
      content: buildTooltipContent(agent)
    };
    setStickyTooltip(tooltipData);
    setHovered(null);
  }

  const center = { x: 420, y: 260, r: 220 };
  const placed = agents.map((a, idx) => {
    const angle = (idx / agents.length) * Math.PI * 2 - Math.PI / 2;
    const x = center.x + Math.cos(angle) * center.r;
    const y = center.y + Math.sin(angle) * center.r;
    return { ...a, x, y, angle };
  });
  const leaderboard = [...agents].sort((a, b) => b.score - a.score).slice(0, 6);

  return (
    <div ref={containerRef} className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-rose-900 text-white p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-12 gap-6">
        <div className="col-span-8 bg-black/40 rounded-2xl p-4 shadow-2xl border border-white/10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">Game Theory Fishbowl</h1>
              <p className="text-sm text-white/70 mt-1">
                Interactive educational simulation: AI agents compete in Iterated Prisoner's Dilemma. 
                <strong> Hover any agent for detailed strategy analysis</strong> including philosophy, strengths, weaknesses, and real-world analogies.
              </p>
            </div>
            <div>
              <button
                className={`px-4 py-2 font-semibold rounded-xl shadow-lg transition-all ${running ? "bg-gray-500 text-gray-200" : "bg-emerald-400 text-black"}`}
                onClick={() => {
                  if (!running) startSimulation();
                }}
                disabled={running}
                title="Start the autonomous fishbowl"
              >
                {running ? "Running..." : "Start"}
              </button>
            </div>
          </div>

          <div className="relative h-[540px] p-2">
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <svg width={880} height={520} viewBox="0 0 880 520">
                <defs>
                  <radialGradient id="g1" cx="50%" cy="30%">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.08" />
                    <stop offset="60%" stopColor="#ffffff" stopOpacity="0.02" />
                    <stop offset="100%" stopColor="#000" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <ellipse cx={center.x} cy={center.y} rx={260} ry={240} fill="url(#g1)" />
              </svg>
            </div>

            {placed.map((a, idx) => (
              <motion.div key={a.id + idx} className="absolute flex items-center justify-center" style={{ left: a.x - 46, top: a.y - 26 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.02 }}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`${a.name} — ${a.isClassic ? "classic strategy" : "adaptive learner"}`}
                  onMouseEnter={(e) => handleEnterAgent(e, a)}
                  onMouseMove={handleMoveAgent}
                  onMouseLeave={handleLeaveAgent}
                  onClick={(e) => handleClickAgent(e, a)}
                  onFocus={(e) => handleEnterAgent(e, a)}
                  onBlur={handleLeaveAgent}
                  className={`w-36 h-16 rounded-2xl p-2 backdrop-blur-md border border-white/10 flex flex-col justify-center items-center shadow-md focus:outline-none cursor-pointer hover:border-white/30 transition-all ${a.isClassic ? "bg-white/5 hover:bg-white/10" : "bg-amber-900/20 hover:bg-amber-900/30"}`}
                >
                  <div className="text-xs font-semibold truncate w-full text-center">{a.name}</div>
                  <div className="text-[10px] text-white/70 mt-1">{a.isClassic ? "Classic" : "Learner"}</div>
                  <div className="text-[8px] text-white/50 mt-0.5">Click for details</div>
                </div>
              </motion.div>
            ))}

            <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
              {/* Regular hover tooltip */}
              {hovered && !stickyTooltip && (
                <Tooltip 
                  x={hovered.x} 
                  y={hovered.y} 
                  content={hovered.content} 
                  visible={true} 
                />
              )}
            </div>

            {/* Sticky tooltip rendered at root level for better positioning */}
            {stickyTooltip && (
              <Tooltip 
                x={stickyTooltip.x} 
                y={stickyTooltip.y} 
                content={stickyTooltip.content} 
                visible={true} 
              />
            )}

            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {log.slice(0, 8).map((entry, i) => {
                const parts = entry.split(":")[0].split(" vs ");
                const Aname = parts[0];
                const Bname = parts[1];
                const A = placed.find((p) => p.name === Aname) || placed[0];
                const B = placed.find((p) => p.name === Bname) || placed[1];
                const alpha = 0.12 + (8 - i) * 0.1;
                return (
                  <g key={i}>
                    <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={`rgba(255,255,255,${alpha})`} strokeWidth={2} strokeLinecap="round" />
                  </g>
                );
              })}
            </svg>
          </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="col-span-2 bg-black/30 p-3 rounded-xl border border-white/10">
              <h3 className="text-lg font-bold mb-3">🎓 Game Theory Educational Dashboard</h3>
              <div className="text-sm text-white/80 space-y-3 max-h-48 overflow-auto leading-5">
                <div className="bg-blue-900/20 p-3 rounded-lg border border-blue-500/30">
                  <h4 className="font-semibold text-blue-300 mb-2">📊 Prisoner's Dilemma Payoff Matrix</h4>
                  <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                    <div></div><div className="text-center text-green-300">Opponent Cooperates</div><div className="text-center text-red-300">Opponent Defects</div>
                    <div className="text-green-300">You Cooperate</div><div className="text-center bg-green-900/30 p-1 rounded">Both get R=3</div><div className="text-center bg-red-900/30 p-1 rounded">You get S=0</div>
                    <div className="text-red-300">You Defect</div><div className="text-center bg-yellow-900/30 p-1 rounded">You get T=5</div><div className="text-center bg-gray-900/30 p-1 rounded">Both get P=1</div>
                  </div>
                  <p className="mt-2 text-xs text-white/70">
                    <strong>Key insight:</strong> Mutual cooperation (R=3,3) beats mutual defection (P=1,1), but you're tempted to defect (T=5) while they cooperate (S=0).
                  </p>
                </div>
                
                <div className="bg-purple-900/20 p-3 rounded-lg border border-purple-500/30">
                  <h4 className="font-semibold text-purple-300 mb-2">🔄 Why Iteration Matters</h4>
                  <p className="text-xs text-white/70">
                    In single-shot games, defection dominates. But with repeated interactions, strategies like <strong>Tit-for-Tat</strong> can enforce cooperation through reputation and retaliation. This models real-world relationships where future interactions matter.
                  </p>
                </div>

                <div className="bg-amber-900/20 p-3 rounded-lg border border-amber-500/30">
                  <h4 className="font-semibold text-amber-300 mb-2">🤖 AI Strategy Categories</h4>
                  <div className="text-xs text-white/70 space-y-1">
                    <p><strong>Fixed Strategies:</strong> Deterministic rules (Tit-for-Tat, Always Cooperate, etc.)</p>
                    <p><strong>Adaptive AI:</strong> Machine learning agents that update policies based on experience</p>
                    <p><strong>Hover any agent above</strong> to see detailed analysis of their decision-making process!</p>
                  </div>
                </div>
              </div>
            </div>            <div className="col-span-1 bg-black/30 p-3 rounded-xl border border-white/10">
              <h3 className="text-lg font-bold">Leaderboard</h3>
              <ol className="mt-2 space-y-2">
                {leaderboard.map((a, idx) => (
                  <li key={a.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full" style={{ background: idx === 0 ? "#ffd700" : "#fff" }} />
                      <button 
                        className="font-medium truncate text-left hover:text-blue-300 transition-colors" 
                        style={{ maxWidth: 140 }} 
                        onMouseEnter={(e) => handleEnterAgent(e, a)} 
                        onMouseMove={handleMoveAgent} 
                        onMouseLeave={handleLeaveAgent}
                        onClick={(e) => handleClickAgent(e, a)}
                        onFocus={(e) => handleEnterAgent(e, a)} 
                        onBlur={handleLeaveAgent}
                      >
                        {a.name}
                      </button>
                    </div>
                    <div className="text-xs text-white/80">{Math.round(a.score)}</div>
                  </li>
                ))}
              </ol>

              <div className="mt-3 text-xs text-white/60">Ticks: {tick}</div>
            </div>
          </div>
        </div>

        <div className="col-span-4 flex flex-col gap-4">
          <div className="bg-black/40 p-3 rounded-2xl border border-white/10 shadow-2xl h-72">
            <h3 className="text-lg font-bold mb-2">Score evolution (recent snapshots)</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData.slice().reverse()}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="tick" />
                  <YAxis />
                  <ReTooltip />
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <Line key={i} type="monotone" dataKey={`s${i}`} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-black/30 p-3 rounded-2xl border border-white/10 h-72 overflow-auto">
            <h3 className="text-lg font-bold mb-2">Recent Matches</h3>
            <div className="text-sm text-white/80 space-y-2">
              {log.length === 0 && <div className="text-xs text-white/60">No matches yet — press Start.</div>}
              {log.map((l, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="truncate max-w-[260px]">{l}</div>
                  <div className="text-xs text-white/60">tick</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-black/30 p-3 rounded-2xl border border-white/10 text-sm leading-6 overflow-auto" style={{ maxHeight: 280 }}>
            <h3 className="text-lg font-bold mb-3">🔬 Strategic Analysis Deep Dive</h3>
            
            <div className="space-y-4 text-white/80">
              <div className="bg-emerald-900/20 p-3 rounded-lg border border-emerald-500/30">
                <h4 className="font-semibold text-emerald-300 mb-2">🏆 Tournament Winners & Why</h4>
                <ul className="list-disc pl-4 text-xs space-y-1">
                  <li><strong>Tit-for-Tat:</strong> Won Axelrod's original tournament. Perfect balance: nice, retaliatory, forgiving, clear.</li>
                  <li><strong>Generous Tit-for-Tat:</strong> Sometimes forgives defection to avoid death spirals.</li>
                  <li><strong>Adaptive Agents:</strong> Can potentially outperform fixed strategies by learning opponent patterns.</li>
                </ul>
              </div>

              <div className="bg-red-900/20 p-3 rounded-lg border border-red-500/30">
                <h4 className="font-semibold text-red-300 mb-2">⚠️ Common Strategy Pitfalls</h4>
                <ul className="list-disc pl-4 text-xs space-y-1">
                  <li><strong>Always Cooperate:</strong> Exploitable by any defector - too naive for competitive environments.</li>
                  <li><strong>Grim Trigger:</strong> One mistake ruins everything - too unforgiving for noisy environments.</li>
                  <li><strong>Always Defect:</strong> Misses cooperation opportunities - short-sighted greed.</li>
                </ul>
              </div>

              <div className="bg-blue-900/20 p-3 rounded-lg border border-blue-500/30">
                <h4 className="font-semibold text-blue-300 mb-2">🧠 Real-World Applications</h4>
                <ul className="list-disc pl-4 text-xs space-y-1">
                  <li><strong>International Relations:</strong> Trade agreements, arms control, climate cooperation</li>
                  <li><strong>Business:</strong> Price competition, R&D collaboration, supply chain partnerships</li>
                  <li><strong>Biology:</strong> Evolution of cooperation, symbiosis, social behavior</li>
                  <li><strong>AI Systems:</strong> Multi-agent coordination, negotiation, resource allocation</li>
                </ul>
              </div>

              <div className="bg-purple-900/20 p-3 rounded-lg border border-purple-500/30">
                <h4 className="font-semibold text-purple-300 mb-2">🎯 Learning Objectives</h4>
                <p className="text-xs">
                  Watch how different strategies interact. Notice how <strong>context matters</strong> - the same strategy 
                  can succeed or fail depending on the opponent mix. Observe how learning agents evolve their behavior 
                  over time. <strong>Hover agents for detailed behavioral analysis!</strong>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto mt-6 text-right text-xs text-white/50">
        Enhanced Educational AI Game Theory Simulation • Hover agents for in-depth strategy analysis • 
        Philosophy, strengths, weaknesses, real-world applications, and learning mechanisms explained
      </div>
    </div>
  );
}
