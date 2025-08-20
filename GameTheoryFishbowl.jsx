import React, { useEffect, useRef, useState, useCallback, useLayoutEffect, startTransition, forwardRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import ThreeFishbowl from "./ThreeFishbowl";
import { useProgress } from "@react-three/drei";
// Removed Recharts imports as charts are no longer displayed

// Single-file React component: visualized autonomous Game Theory fishbowl
// Tooltip component for educational details (kept on-screen via measured clamping)
const Tooltip = forwardRef(({ x, y, content, visible, isSticky = false }, fwdRef) => {
  const wrapperRef = useRef(null);
  const setRefs = useCallback((node) => {
    wrapperRef.current = node;
    if (typeof fwdRef === 'function') fwdRef(node);
    else if (fwdRef) fwdRef.current = node;
  }, [fwdRef]);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 320, maxH: 400 });

  const recompute = useCallback(() => {
    if (!visible || !content) { return; }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isMobile = vw < 768;
    const isSmallMobile = vw < 480;
    const fallbackW = isSmallMobile ? Math.min(280, vw - 20) : isMobile ? 300 : 320;
    // Always cap tooltip height to fit viewport with small margins
    const fallbackMaxH = Math.max(120, Math.min(420, vh - 20));
    const rawX = Number.isFinite(x) ? x : vw / 2;
    const rawY = Number.isFinite(y) ? y : vh / 2;
    const margin = 10;

    const el = wrapperRef.current;
    const measuredW = el ? el.offsetWidth || fallbackW : fallbackW;
    const measuredH = el ? el.offsetHeight || fallbackMaxH : fallbackMaxH;
    let left = rawX + 15;
    let top = rawY + 15;

    if (isMobile) {
      left = Math.max(margin, (vw - measuredW) / 2);
      const below = rawY < vh / 2;
      top = below ? Math.min(rawY + 20, vh - measuredH - margin)
                  : Math.max(margin, rawY - measuredH - 20);
    } else {
      const hasRight = rawX + measuredW + 20 <= vw;
      const hasLeft = rawX - measuredW - 20 >= 0;
      if (hasRight) left = rawX + 15;
      else if (hasLeft) left = rawX - measuredW - 15;
      else left = Math.min(vw - measuredW - margin, Math.max(margin, rawX - measuredW / 2));

      const hasBelow = rawY + measuredH + 20 <= vh;
      const hasAbove = rawY - measuredH - 20 >= 0;
      if (hasBelow) top = rawY + 15;
      else if (hasAbove) top = rawY - measuredH - 15;
      else top = Math.min(vh - measuredH - margin, Math.max(margin, rawY - measuredH / 2));
    }

    left = Math.max(margin, Math.min(left, vw - measuredW - margin));
    top = Math.max(margin, Math.min(top, vh - measuredH - margin));
    setPos({ left, top, width: measuredW || fallbackW, maxH: fallbackMaxH });
  }, [x, y, visible, content]);

  useLayoutEffect(() => { recompute(); }, [recompute]);
  useEffect(() => {
    if (!visible) { return; }
    const handler = () => recompute();
    window.addEventListener('resize', handler, { passive: true });
    window.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('orientationchange', handler, { passive: true });
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler);
      window.removeEventListener('orientationchange', handler);
    };
  }, [visible, recompute]);

  // Recompute when internal size changes (content wraps, fonts load, etc.)
  useEffect(() => {
    if (!visible || !wrapperRef.current) return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [visible, recompute]);

  if (!visible || !content) { return null; }

  return (
    <div
      ref={setRefs}
      className={`fixed z-[9999] ${isSticky ? 'pointer-events-auto' : 'pointer-events-none'}`}
      style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxH }}
      onClick={isSticky ? (e) => e.stopPropagation() : undefined}
    >
      <div className="bg-gray-900/95 backdrop-blur-md border border-white/20 rounded-xl p-3 md:p-4 shadow-2xl overflow-auto max-h-full">
        <div className="text-sm md:text-base font-bold text-white mb-2 flex items-center gap-2">
          <span className="text-2xl">{content.isClassic ? "🏛️" : "🤖"}</span>
          {content.name}
          {isSticky && <span className="text-xs bg-blue-500/20 px-2 py-1 rounded-full">📌 Pinned</span>}
        </div>
        <div className="text-xs md:text-sm text-gray-300 mb-3">{content.desc}</div>
        <div className="space-y-2 md:space-y-3">
          <div className="bg-blue-900/30 p-2 md:p-3 rounded-lg border border-blue-500/30">
            <div className="text-xs md:text-sm font-semibold text-blue-300 mb-1">🧠 Strategy Philosophy</div>
            <div className="text-xs text-gray-300">{content.reasoning}</div>
          </div>
          <div className="bg-green-900/30 p-2 md:p-3 rounded-lg border border-green-500/30">
            <div className="text-xs md:text-sm font-semibold text-green-300 mb-1">✅ Strengths</div>
            <ul className="text-xs text-gray-300 list-disc list-inside space-y-0.5">
              {content.strengths.map((s, i) => (<li key={i}>{s}</li>))}
            </ul>
          </div>
          <div className="bg-red-900/30 p-2 md:p-3 rounded-lg border border-red-500/30">
            <div className="text-xs md:text-sm font-semibold text-red-300 mb-1">⚠️ Weaknesses</div>
            <ul className="text-xs text-gray-300 list-disc list-inside space-y-0.5">
              {content.weaknesses.map((w, i) => (<li key={i}>{w}</li>))}
            </ul>
          </div>
          <div className="bg-purple-900/30 p-2 md:p-3 rounded-lg border border-purple-500/30">
            <div className="text-xs md:text-sm font-semibold text-purple-300 mb-1">🌍 Real-World Analogy</div>
            <div className="text-xs text-gray-300">{content.realWorld}</div>
          </div>
          <div className="bg-amber-900/30 p-2 md:p-3 rounded-lg border border-amber-500/30">
            <div className="text-xs md:text-sm font-semibold text-amber-300 mb-1">📈 Performance Profile</div>
            <div className="text-xs text-gray-300">{content.performance}</div>
          </div>
        </div>
        <div className="mt-2 md:mt-3 text-xs text-gray-400 border-t border-white/10 pt-2 flex items-center justify-between">
          <span>{content.isClassic ? "🏛️ Classic Strategy" : "🤖 Adaptive AI Agent"}</span>
          {content.score !== undefined && (
            <span className="bg-emerald-500/20 px-2 py-1 rounded-full text-emerald-300">
              Score: {Math.round(content.score)}
            </span>
          )}
        </div>
        {window.innerWidth < 768 && (
          <div className="mt-2 text-center">
            <div className="text-xs text-gray-400">
              {isSticky ? "Tap outside to close • Scroll for more details" : "Tap to pin this tooltip"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

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
    isClassic: true 
  },
  { 
    id: "D_ALWAYS", 
    name: "Always Defect", 
    fn: (history) => "D", 
    desc: "The hawk - pure selfishness, always defects.",
    reasoning: "Philosophy: Self-interest above all. This strategy assumes others cannot be trusted and that exploitation is the only path to success.",
    strengths: ["Cannot be exploited", "Performs well against naive cooperators", "Provides guaranteed minimum payoff"],
    weaknesses: ["Cannot build cooperative relationships", "Terrible against itself", "Misses opportunities for mutual benefit"],
    realWorld: "Like a ruthless business competitor who never honors agreements - successful short-term, isolated long-term.",
    performance: "Dominates cooperators but destroys mutual benefit. Classic 'rational' choice that leads to tragedy of commons.",
    isClassic: true 
  },
  { 
    id: "TIT_FOR_TAT", 
    name: "Tit-for-Tat", 
    fn: (history) => history.length === 0 ? "C" : history[history.length - 1].opponent, 
    desc: "The diplomat - starts nice, then mirrors opponent's last move.",
    reasoning: "Philosophy: Reciprocity is the foundation of cooperation. Start with trust, but respond proportionally to how you're treated.",
    strengths: ["Nice (starts cooperating)", "Retaliatory (punishes defection)", "Forgiving (returns to cooperation quickly)", "Clear and predictable"],
    weaknesses: ["Can get trapped in defection spirals", "Vulnerable to noise/mistakes", "Sometimes too retaliatory"],
    realWorld: "Like international diplomacy - extend an olive branch, but respond firmly to aggression. The golden rule in action.",
    performance: "Winner of Axelrod's original tournament. Optimal balance of niceness, retaliation, and forgiveness.",
    isClassic: true 
  },
  { 
    id: "GRIM", 
    name: "Grim Trigger", 
    fn: (history) => history.some((h) => h.opponent === "D") ? "D" : "C", 
    desc: "The grudge-holder - cooperates until first betrayal, then defects forever.",
    reasoning: "Philosophy: Trust is sacred and betrayal is unforgivable. One strike and you're out - permanent retaliation for any defection.",
    strengths: ["Deters defection through threat of permanent punishment", "Simple trigger mechanism", "Maximizes cooperation when respected"],
    weaknesses: ["Unforgiving - no second chances", "Vulnerable to accidental defections", "Can create permanent hostility"],
    realWorld: "Like cutting off all contact after being betrayed once - effective deterrent but inflexible to human error.",
    performance: "Powerful deterrent effect, but lacks forgiveness mechanism. Can spiral into permanent conflict.",
    isClassic: true 
  },
  { 
    id: "GENEROUS_TIT_FOR_TAT", 
    name: "Generous Tit-for-Tat", 
    fn: (history) => {
      if (history.length === 0) {
        return "C";
      }
      const lastMove = history[history.length - 1].opponent;
      if (lastMove === "C") {
        return "C";
      }
      return Math.random() < 0.1 ? "C" : "D"; // 10% chance to forgive
    }, 
    desc: "The forgiver - like Tit-for-Tat but occasionally forgives defection.",
    reasoning: "Philosophy: Reciprocity with mercy. Sometimes forgive defections to break cycles of retaliation and give second chances.",
    strengths: ["Breaks defection spirals", "More resilient to noise", "Maintains cooperative potential", "Generous but not naive"],
    weaknesses: ["Can be exploited by repeated defectors", "Forgiveness rate needs calibration", "More complex than pure strategies"],
    realWorld: "Like a diplomatic relationship with occasional pardons - maintains cooperation while allowing for mistakes and reconciliation.",
    performance: "Often outperforms pure Tit-for-Tat in noisy environments. Balance between firmness and flexibility.",
    isClassic: true 
  },
  { 
    id: "RANDOM", 
    name: "Random", 
    fn: (history) => Math.random() < 0.5 ? "C" : "D", 
    desc: "The unpredictable - randomly cooperates or defects.",
    reasoning: "Philosophy: Unpredictability prevents exploitation. Random behavior makes it impossible for opponents to learn and counter your strategy.",
    strengths: ["Completely unpredictable", "Cannot be exploited systematically", "Provides baseline performance measure"],
    weaknesses: ["No strategic coherence", "Cannot build trust", "Suboptimal against all other strategies"],
    realWorld: "Like someone with random mood swings - impossible to predict but also impossible to build a relationship with.",
    performance: "Typically performs poorly as it cannot establish cooperation or systematic exploitation. Useful as control group.",
    isClassic: true 
  }
];

const AdaptiveAgents = [
  {
    id: "Q_LEARNER",
    name: "Q-Learning Agent",
    desc: "Reinforcement learning agent using Q-Learning algorithm.",
    reasoning: "Machine Learning: Uses Q-Learning to map opponent history patterns to optimal actions. Learns through trial and error with exploration vs exploitation.",
    strengths: ["Adapts to any opponent strategy", "Learns optimal responses", "Balances exploration and exploitation", "Can discover novel counter-strategies"],
    weaknesses: ["Requires training time", "May be exploited during learning phase", "Performance depends on exploration rate"],
    realWorld: "Like an AI studying your behavior patterns to predict and counter your moves - gets smarter over time.",
    performance: "Potentially superior to fixed strategies after sufficient learning. Effectiveness depends on opponent predictability.",
    isClassic: false,
    qTable: {},
    epsilon: 0.1,
    alpha: 0.1,
    gamma: 0.9,
    fn: function(history, myHistory) {
      const state = this.getState(history);
      if (Math.random() < this.epsilon) {
        return Math.random() < 0.5 ? "C" : "D";
      } else {
        const qC = this.qTable[state + "_C"] || 0;
        const qD = this.qTable[state + "_D"] || 0;
        return qC > qD ? "C" : "D";
      }
    },
    getState: function(history) {
      if (history.length === 0) { return "start"; }
      const recent = history.slice(-3);
      return recent.map(h => h.opponent).join("");
    },
    updateQ: function(state, action, reward, nextState) {
      const current = this.qTable[state + "_" + action] || 0;
      const nextMax = Math.max(
        this.qTable[nextState + "_C"] || 0,
        this.qTable[nextState + "_D"] || 0
      );
      this.qTable[state + "_" + action] = current + this.alpha * (reward + this.gamma * nextMax - current);
    }
  },
  {
    id: "FREQ_ANALYSIS",
    name: "Frequency Analyzer",
    desc: "Analyzes opponent's cooperation frequency and adapts accordingly.",
    reasoning: "Statistical Learning: Tracks opponent cooperation rate and adjusts strategy based on their apparent cooperativeness level.",
    strengths: ["Quick to identify opponent type", "Simple and efficient", "Good against consistent strategies", "Robust to noise"],
    weaknesses: ["Vulnerable to pattern changes", "Cannot detect complex patterns", "May miss temporal strategies"],
    realWorld: "Like a negotiator who studies your past behavior to predict future actions - simple but effective pattern recognition.",
    performance: "Effective against consistent opponents, struggles with adaptive or complex strategies.",
    isClassic: false,
    cooperationThreshold: 0.6,
    fn: function(history, myHistory) {
      if (history.length < 5) { return "C"; }
      const cooperationRate = history.filter(h => h.opponent === "C").length / history.length;
      return cooperationRate > this.cooperationThreshold ? "C" : "D";
    }
  },
  {
    id: "PATTERN_DETECTOR",
    name: "Pattern Detective",
    desc: "Detects patterns in opponent behavior and predicts next move.",
    reasoning: "Pattern Recognition: Searches for repeating sequences in opponent behavior to predict and counter their next move.",
    strengths: ["Detects complex patterns", "Can counter systematic strategies", "Adapts to changing patterns", "Good against periodic strategies"],
    weaknesses: ["Struggles with truly random opponents", "Needs time to learn patterns", "May overfit to noise"],
    realWorld: "Like a detective analyzing crime patterns - looks for repeating behaviors to predict and prevent the next incident.",
    performance: "Excellent against pattern-based strategies, poor against random or adaptive opponents.",
    isClassic: false,
    patterns: {},
    fn: function(history, myHistory) {
      if (history.length < 4) { return "C"; }
      for (let patternLength = 2; patternLength <= Math.min(4, history.length); patternLength++) {
        const pattern = history.slice(-patternLength).map(h => h.opponent).join("");
        if (this.patterns[pattern]) {
          const predictions = this.patterns[pattern];
          const mostLikely = predictions.C > predictions.D ? "C" : "D";
          return mostLikely === "C" ? "C" : "D";
        }
      }
      return "C";
    },
    updatePatterns: function(history) {
      if (history.length < 3) { return; }
      for (let patternLength = 2; patternLength <= Math.min(4, history.length - 1); patternLength++) {
        const pattern = history.slice(-patternLength - 1, -1).map(h => h.opponent).join("");
        const nextMove = history[history.length - 1].opponent;
        if (!this.patterns[pattern]) { this.patterns[pattern] = { C: 0, D: 0 }; }
        this.patterns[pattern][nextMove]++;
      }
    }
  },
  {
    id: "META_STRATEGY",
    name: "Meta-Strategist",
    desc: "Combines multiple strategies and switches based on performance.",
    reasoning: "Portfolio Learning: Maintains multiple sub-strategies and dynamically selects the best performer against current opponent.",
    strengths: ["Combines best of multiple approaches", "Adapts strategy selection", "Robust across opponent types", "Self-improving"],
    weaknesses: ["Complex implementation", "Slow to converge", "May switch strategies too frequently"],
    realWorld: "Like an investment portfolio manager - maintains diverse strategies and allocates resources to the best performers.",
    performanceProfile: "Potentially the strongest adaptive agent, but requires careful tuning of strategy switching mechanisms.",
    isClassic: false,
    strategies: ["C", "D", "TFT", "FREQ"],
    performance: { "C": 0, "D": 0, "TFT": 0, "FREQ": 0 },
    counts: { "C": 0, "D": 0, "TFT": 0, "FREQ": 0 },
    currentStrategy: "TFT",
    fn: function(history, myHistory) {
      if (history.length > 10 && history.length % 10 === 0) {
        let bestStrategy = this.currentStrategy;
        let bestPerf = this.counts[this.currentStrategy] > 0 ? 
          this.performance[this.currentStrategy] / this.counts[this.currentStrategy] : 0;
        for (let strategy of this.strategies) {
          if (this.counts[strategy] > 0) {
            const perf = this.performance[strategy] / this.counts[strategy];
            if (perf > bestPerf) { bestPerf = perf; bestStrategy = strategy; }
          }
        }
        this.currentStrategy = bestStrategy;
      }
      switch (this.currentStrategy) {
        case "C": return "C";
        case "D": return "D";
        case "TFT": return history.length === 0 ? "C" : history[history.length - 1].opponent;
        case "FREQ": 
          if (history.length < 5) { return "C"; }
          const cooperationRate = history.filter(h => h.opponent === "C").length / history.length;
          return cooperationRate > 0.6 ? "C" : "D";
        default: return "C";
      }
    },
    updatePerformance: function(strategy, reward) {
      this.performance[strategy] += reward;
      this.counts[strategy]++;
    }
  }
];

// (removed duplicate Tooltip)

// Fullscreen loading splash with highly animated loader
function LoadingSplash({ onDone }) {
  const { active, progress } = useProgress();
  const [settled, setSettled] = useState(false);
  const dismissedRef = useRef(false);
  const [readyToFade, setReadyToFade] = useState(false);

  useEffect(() => {
    if (dismissedRef.current) { return; }
    if (!active && progress >= 100) {
      let frames = 0;
      let ok = 0;
      let last = 0;
      const tick = (ts) => {
        if (!last) { last = ts; requestAnimationFrame(tick); return; }
        const dt = ts - last; last = ts; frames++;
  if (dt < 50) { ok++; }
        if (frames >= 14) {
          if (ok >= 11) { setSettled(true); return; }
          setTimeout(() => requestAnimationFrame(tick), 120);
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    }
  }, [active, progress]);

  useEffect(() => {
    if (settled && !dismissedRef.current) {
      // trigger a smooth fade-out via framer-motion; complete unmount in onAnimationComplete
      setReadyToFade(true);
    }
  }, [settled]);

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[999999] flex items-center justify-center select-none"
      style={{ pointerEvents: 'auto' }}
      aria-busy
      initial={{ opacity: 1 }}
      animate={{ opacity: readyToFade ? 0 : 1 }}
      transition={{ duration: 0.35, ease: 'easeInOut' }}
      onAnimationComplete={() => {
        if (readyToFade && !dismissedRef.current) {
          dismissedRef.current = true;
          onDone?.();
        }
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[#0f172a] via-[#1e293b] to-[#020617]" />

      {/* Animated rings */}
      <div className="relative w-48 h-48 sm:w-56 sm:h-56">
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-white/15"
          animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          style={{ boxShadow: '0 0 24px rgba(255,255,255,0.05) inset' }}
        />
        <motion.div
          className="absolute inset-3 rounded-full border-2 border-emerald-400/30"
          animate={{ rotate: -360 }} transition={{ duration: 5.5, repeat: Infinity, ease: 'linear' }}
          style={{ boxShadow: '0 0 24px rgba(16,185,129,0.25) inset' }}
        />
        <motion.div
          className="absolute inset-6 rounded-full border-2 border-sky-400/30"
          animate={{ rotate: 360 }} transition={{ duration: 3.8, repeat: Infinity, ease: 'linear' }}
          style={{ boxShadow: '0 0 24px rgba(56,189,248,0.25) inset' }}
        />

        {/* Orbiting dots */}
        <motion.div className="absolute left-1/2 top-1/2" animate={{ rotate: 360 }} transition={{ duration: 2.6, repeat: Infinity, ease: 'linear' }} style={{ width: 0, height: 0 }}>
          <div className="-translate-x-1/2 -translate-y-1/2">
            <div className="relative" style={{ width: 100, height: 100 }}>
              <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.7)]" />
              <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_16px_rgba(56,189,248,0.7)]" />
              <div className="absolute left-1/2 -top-1 -translate-x-1/2 w-2 h-2 rounded-full bg-fuchsia-400 shadow-[0_0_16px_rgba(232,121,249,0.7)]" />
              <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_16px_rgba(251,191,36,0.7)]" />
            </div>
          </div>
        </motion.div>

        {/* Core pulsing dot */}
        <motion.div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white"
          animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          style={{ boxShadow: '0 0 28px rgba(255,255,255,0.8)' }}
        />
      </div>

      {/* Progress and copy */}
      <div className="mt-8 text-center relative z-10">
        <div className="text-white/90 font-semibold text-lg">Loading assets… {Math.round(progress)}%</div>
        <div className="text-white/60 text-xs mt-1">Preparing the ring and agents</div>
      </div>
    </motion.div>,
    document.body
  );
}

export default function GameTheoryFishbowl() {
  const containerRef = useRef(null);
  const [agents, setAgents] = useState([]);
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(0);
  const [log, setLog] = useState([]); // kept for internal messages if needed; UI list removed
  const [hovered, setHovered] = useState(null);
  const [stickyTooltip, setStickyTooltip] = useState(null);
  const stickyRef = useRef(null);
  const [fishbowlDimensions, setFishbowlDimensions] = useState({ width: 880, height: 520 });
  const [showMobileInstructions, setShowMobileInstructions] = useState(false);
  const [lastInteraction, setLastInteraction] = useState(null);
  const agentRingRef = useRef(null); // stable ring meta for 3D scene
  const rafIdRef = useRef(null);
  const runningRef = useRef(false);
  const lastTsRef = useRef(0);
  const accRef = useRef(0);
  const cadenceRef = useRef(700); // ms between matches; updated on start
  const [showSplash, setShowSplash] = useState(true);

  // Responsive fishbowl dimensions
  useEffect(() => {
    const updateDimensions = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const isMobile = viewportWidth < 768;
      const isSmallMobile = viewportWidth < 480;
      const isTablet = viewportWidth >= 768 && viewportWidth < 1024;
      
      if (isSmallMobile) {
        // For small mobile, balanced dimensions that aren't too wide
        const width = Math.min(viewportWidth - 48, 360); // Slightly less width
        const height = Math.min(width * 0.9, Math.min(viewportHeight * 0.4, 320)); // More square aspect ratio
        setFishbowlDimensions({ width, height });
      } else if (isMobile) {
        // For mobile, good balance of space usage without being too spread out
        const width = Math.min(viewportWidth - 64, 480); // Reduced width
        const height = Math.min(width * 0.85, Math.min(viewportHeight * 0.45, 400)); // Better aspect ratio
        setFishbowlDimensions({ width, height });
      } else if (isTablet) {
        // Tablet size
        setFishbowlDimensions({ width: 600, height: 450 });
      } else {
        // Desktop
        setFishbowlDimensions({ width: 880, height: 520 });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    
    // Show mobile instructions on first load for mobile users
    if (window.innerWidth < 768) {
      setShowMobileInstructions(true);
      setTimeout(() => setShowMobileInstructions(false), 5000);
    }
    
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Hide page scroll while splash is visible
  useEffect(() => {
    const prev = document.body.style.overflow;
    if (showSplash) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = prev || '';
    }
    return () => { document.body.style.overflow = prev || ''; };
  }, [showSplash]);

  // Dynamic center calculation based on dimensions
  const center = { 
    x: fishbowlDimensions.width / 2, 
    y: fishbowlDimensions.height / 2, 
    // Balanced radius for mobile: not too cramped, not too spread out
    r: window.innerWidth < 768 
      ? Math.min(fishbowlDimensions.width, fishbowlDimensions.height) * 0.30 // Balanced radius on mobile
      : Math.min(fishbowlDimensions.width, fishbowlDimensions.height) * 0.32 // Original radius on desktop
  };

  // Initialize agents
  useEffect(() => {
    const newAgents = [];
    
    // Add classic strategies
    ClassicStrategies.forEach((strategy) => {
      newAgents.push({
        id: `classic_${strategy.id}`,
        name: strategy.name,
        strategy: strategy.fn,
        score: 0,
        history: [],
        myHistory: [],
        desc: strategy.desc,
        reasoning: strategy.reasoning,
        strengths: strategy.strengths,
        weaknesses: strategy.weaknesses,
        realWorld: strategy.realWorld,
        performance: strategy.performance,
        isClassic: true,
        x: 0,
        y: 0,
        angle: 0,
      });
    });

    // Add adaptive agents
    AdaptiveAgents.forEach((agent) => {
      newAgents.push({
        id: `adaptive_${agent.id}`,
        name: agent.name,
        strategy: agent.fn.bind(agent), // Bind the context
        agent: agent, // Store reference for updates
        score: 0,
        history: [],
        myHistory: [],
        desc: agent.desc,
        reasoning: agent.reasoning,
        strengths: agent.strengths,
        weaknesses: agent.weaknesses,
        realWorld: agent.realWorld,
        performance: agent.performanceProfile || agent.performance,
        isClassic: false,
        x: 0,
        y: 0,
        angle: 0,
      });
    });

    // Trim to AGENT_COUNT if we have too many
    if (newAgents.length > AGENT_COUNT) {
      newAgents.splice(AGENT_COUNT);
    }

  setAgents(newAgents);
  // Initialize a stable ring meta once (name + isClassic + score)
  agentRingRef.current = newAgents.map(a => ({ 
    name: a.name, 
    isClassic: a.isClassic, 
    score: a.score || 0 
  }));
  }, []);

  const playGame = (agentA, agentB) => {
    const historyA = [];
    const historyB = [];
    let scoreA = 0;
    let scoreB = 0;

    for (let round = 0; round < ITERATED_LENGTH; round++) {
      const moveA = agentA.strategy(historyA, agentA.myHistory);
      const moveB = agentB.strategy(historyB, agentB.myHistory);

      // Calculate payoffs
      let payoffA, payoffB;
      if (moveA === "C" && moveB === "C") {
        payoffA = PD.R;
        payoffB = PD.R;
      } else if (moveA === "C" && moveB === "D") {
        payoffA = PD.S;
        payoffB = PD.T;
      } else if (moveA === "D" && moveB === "C") {
        payoffA = PD.T;
        payoffB = PD.S;
      } else {
        payoffA = PD.P;
        payoffB = PD.P;
      }

      scoreA += payoffA;
      scoreB += payoffB;

      // Update histories
      historyA.push({ self: moveA, opponent: moveB, payoff: payoffA });
      historyB.push({ self: moveB, opponent: moveA, payoff: payoffB });
      
      // Update agent histories
      agentA.myHistory.push({ self: moveA, opponent: moveB, payoff: payoffA });
      agentB.myHistory.push({ self: moveB, opponent: moveA, payoff: payoffB });

      // Update learning agents
      if (!agentA.isClassic && agentA.agent.updateQ) {
        const state = agentA.agent.getState(historyA.slice(0, -1));
        const nextState = agentA.agent.getState(historyA);
        agentA.agent.updateQ(state, moveA, payoffA, nextState);
      }
      if (!agentB.isClassic && agentB.agent.updateQ) {
        const state = agentB.agent.getState(historyB.slice(0, -1));
        const nextState = agentB.agent.getState(historyB);
        agentB.agent.updateQ(state, moveB, payoffB, nextState);
      }

      // Update pattern detectors
      if (!agentA.isClassic && agentA.agent.updatePatterns) {
        agentA.agent.updatePatterns(historyA);
      }
      if (!agentB.isClassic && agentB.agent.updatePatterns) {
        agentB.agent.updatePatterns(historyB);
      }

      // Update meta-strategists
      if (!agentA.isClassic && agentA.agent.updatePerformance) {
        agentA.agent.updatePerformance(agentA.agent.currentStrategy, payoffA);
      }
      if (!agentB.isClassic && agentB.agent.updatePerformance) {
        agentB.agent.updatePerformance(agentB.agent.currentStrategy, payoffB);
      }
    }

    return { scoreA, scoreB, historyA, historyB };
  };

  const startSimulation = () => {
    if (running) {
      return;
    }
    setRunning(true);
    runningRef.current = true;
    setTick(0);
    setLog([]);
    
    // Reset agent scores and histories
    setAgents(prev => prev.map(agent => ({
      ...agent,
      score: 0,
      history: [],
      myHistory: []
    })));

  let currentTick = 0;
  cadenceRef.current = 300; // consistent fast cadence

  const runOneMatch = () => {
      setAgents((currentAgents) => {
        if (currentAgents.length < 2) {
          return currentAgents;
        }

        // Pick two random agents
        const indices = [];
        while (indices.length < 2) {
          const idx = Math.floor(Math.random() * currentAgents.length);
          if (!indices.includes(idx)) {
            indices.push(idx);
          }
        }

        const [idxA, idxB] = indices;
        const agentA = { ...currentAgents[idxA] };
        const agentB = { ...currentAgents[idxB] };

  const result = playGame(agentA, agentB);

        agentA.score += result.scoreA;
        agentB.score += result.scoreB;
        agentA.history = result.historyA;
        agentB.history = result.historyB;

        const newAgents = [...currentAgents];
        newAgents[idxA] = agentA;
        newAgents[idxB] = agentB;

        // Update current interaction for 3D cinematic (non-blocking)
        const lastARound = result.historyA[result.historyA.length - 1];
        const lastBRound = result.historyB[result.historyB.length - 1];
        const lastA = lastARound?.self;
        const lastB = lastBRound?.self;
        const pA = lastARound?.payoff ?? 0;
        const pB = lastBRound?.payoff ?? 0;
        
        startTransition(() => {
          setLastInteraction({ A: agentA.name, B: agentB.name, aMove: lastA, bMove: lastB, pA, pB });
        });

  // Removed log list and chart updates UI; keep minimal state changes for 3D scene only

        // Update the ring ref with current agent data including scores
        agentRingRef.current = newAgents.map(a => ({ 
          name: a.name, 
          isClassic: a.isClassic, 
          score: a.score || 0
        }));

        return newAgents;
      });
      setTick(currentTick);
      currentTick++;
      if (currentTick > 500) {
        runningRef.current = false;
        setRunning(false);
      }
    };

    // RAF-driven scheduler for smooth pacing
    const loop = (ts) => {
      if (!runningRef.current) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; return; }
      if (!lastTsRef.current) { lastTsRef.current = ts; }
      const dt = ts - lastTsRef.current; lastTsRef.current = ts; accRef.current += dt;
      while (accRef.current >= cadenceRef.current && runningRef.current) {
        accRef.current -= cadenceRef.current;
        runOneMatch();
      }
      rafIdRef.current = requestAnimationFrame(loop);
    };
    rafIdRef.current = requestAnimationFrame(loop);
  };

  const handleEnterAgent = (e, agent) => {
    setHovered({
      x: e.clientX,
      y: e.clientY,
      content: agent,
    });
  };

  const handleMoveAgent = (e) => {
    if (hovered) {
      setHovered(prev => ({
        ...prev,
        x: e.clientX,
        y: e.clientY,
      }));
    }
  };

  const handleLeaveAgent = () => {
    setHovered(null);
  };

  const handleClickAgent = (e, agent) => {
    // Extract robust client coordinates for mouse/touch
    const getClientPoint = (evt) => {
      if (evt && Number.isFinite(evt.clientX) && Number.isFinite(evt.clientY)) {
        return { x: evt.clientX, y: evt.clientY };
      }
      // TouchEvent path
      const t = evt?.touches?.[0] || evt?.changedTouches?.[0];
      if (t && Number.isFinite(t.clientX) && Number.isFinite(t.clientY)) {
        return { x: t.clientX, y: t.clientY };
      }
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    };

    const pt = getClientPoint(e);
    setStickyTooltip({ x: pt.x, y: pt.y, content: agent });
    setHovered(null);
  };

  // Close sticky tooltip on outside click (ignore clicks inside the tooltip)
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (stickyRef.current && stickyRef.current.contains(e.target)) {
        return; // click inside tooltip - keep it open
      }
      setStickyTooltip(null);
    };
    if (stickyTooltip) {
      document.addEventListener('click', handleClickOutside, { capture: true });
      return () => document.removeEventListener('click', handleClickOutside, { capture: true });
    }
  }, [stickyTooltip]);

  // Position agents in a circle
  const placed = agents.map((a, i) => {
    const angle = (i / agents.length) * 2 * Math.PI;
    const x = center.x + Math.cos(angle) * center.r;
    const y = center.y + Math.sin(angle) * center.r;
    return { ...a, x, y, angle };
  });
  const leaderboard = [...agents].sort((a, b) => b.score - a.score).slice(0, 6);

  return (
    <div ref={containerRef} className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-rose-900 text-white safe-top safe-bottom">
      {showSplash && (
        <LoadingSplash onDone={() => setShowSplash(false)} />
      )}
      {/* Mobile/Desktop responsive container */}
      <div className="w-full max-w-7xl mx-auto p-2 sm:p-3 md:p-6 safe-left safe-right">
        <div className="flex flex-col xl:flex-row gap-3 md:gap-6">
          
          {/* Main Fishbowl Area - Full width on mobile, larger on desktop */}
          <div className="flex-1 xl:flex-[2] bg-black/40 rounded-2xl p-2 sm:p-3 md:p-4 shadow-2xl border border-white/10">
            
            {/* Header - Stack on mobile, side-by-side on desktop */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 md:mb-4 gap-2 md:gap-4">
              <div className="flex-1">
                <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight">Game Theory Fishbowl</h1>
                <p className="text-xs sm:text-sm text-white/70 mt-1">
                  Interactive educational simulation: AI agents compete in Iterated Prisoner's Dilemma. 
                  <span className="hidden sm:inline">
                    <strong> Hover any agent for detailed strategy analysis</strong> including philosophy, strengths, weaknesses, and real-world analogies.
                  </span>
                  <span className="sm:hidden">
                    <strong> Tap agents for detailed analysis.</strong>
                  </span>
                </p>
              </div>
              <div className="flex-shrink-0 flex items-center gap-2">
                <button
                  className={`w-full sm:w-auto px-3 md:px-4 py-2 font-semibold rounded-xl shadow-lg transition-all text-sm md:text-base touch-feedback no-tap-highlight ${running ? "bg-gray-500 text-gray-200" : "bg-emerald-400 text-black"}`}
                  onClick={() => {
                    if (!running) {
                      startSimulation();
                    }
                  }}
                  disabled={running}
                  title="Start the autonomous fishbowl"
                >
                  {running ? "Running..." : "Start Simulation"}
                </button>
              </div>
            </div>

            {/* Fishbowl Visualization - 3D characters */}
            <div className="relative min-h-[320px] h-[40vh] sm:h-[45vh] md:h-[50vh] lg:h-[540px] p-1 sm:p-2 overflow-hidden">
              <div className="absolute inset-0 rounded-xl overflow-hidden">
                <ThreeFishbowl 
                  ring={agentRingRef.current || agents.map(a => ({ name: a.name, isClassic: a.isClassic }))}
                  interaction={lastInteraction}
                  hideOverlays={showSplash}
                  onAgentClick={(name)=>{
                    const a = agents.find(x => x.name === name);
                    if (a) { setStickyTooltip({x: window.innerWidth/2, y: 100, content: a}); }
                  }}
                />
              </div>
            </div>

            {/* Educational Dashboard - Responsive grid */}
            <div className="mt-3 md:mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              <div className="md:col-span-2 xl:col-span-3 bg-black/30 p-2 sm:p-3 rounded-xl border border-white/10">
                <h3 className="text-base md:text-lg font-bold mb-2 md:mb-3">🎓 Game Theory Educational Dashboard</h3>
                <div className="text-xs sm:text-sm text-white/80 space-y-2 md:space-y-3 max-h-48 sm:max-h-56 md:max-h-64 overflow-auto mobile-scroll leading-4 sm:leading-5">
                  <div className="bg-blue-900/20 p-2 md:p-3 rounded-lg border border-blue-500/30 hover:bg-blue-900/30 transition-colors cursor-pointer">
                    <h4 className="font-semibold text-blue-300 mb-1 md:mb-2 text-xs sm:text-sm">📊 Prisoner's Dilemma Payoff Matrix</h4>
                    <div className="grid grid-cols-3 gap-1 md:gap-2 text-xs font-mono">
                      <div></div><div className="text-center text-green-300">Cooperate</div><div className="text-center text-red-300">Defect</div>
                      <div className="text-green-300">Cooperate</div><div className="text-center bg-green-900/30 p-1 rounded text-[10px] sm:text-xs hover:bg-green-900/50 transition-colors">R=3,3</div><div className="text-center bg-red-900/30 p-1 rounded text-[10px] sm:text-xs hover:bg-red-900/50 transition-colors">S=0,T=5</div>
                      <div className="text-red-300">Defect</div><div className="text-center bg-yellow-900/30 p-1 rounded text-[10px] sm:text-xs hover:bg-yellow-900/50 transition-colors">T=5,S=0</div><div className="text-center bg-gray-900/30 p-1 rounded text-[10px] sm:text-xs hover:bg-gray-900/50 transition-colors">P=1,1</div>
                    </div>
                    <p className="mt-1 md:mt-2 text-[10px] sm:text-xs text-white/70">
                      <strong>Key insight:</strong> Mutual cooperation (R=3,3) beats mutual defection (P=1,1), but temptation to defect (T=5) while opponent cooperates (S=0).
                    </p>
                  </div>
                  
                  <div className="bg-purple-900/20 p-2 md:p-3 rounded-lg border border-purple-500/30">
                    <h4 className="font-semibold text-purple-300 mb-1 md:mb-2 text-xs sm:text-sm">🔄 Why Iteration Matters</h4>
                    <p className="text-[10px] sm:text-xs text-white/70">
                      In single-shot games, defection dominates. But with repeated interactions, strategies like <strong>Tit-for-Tat</strong> can enforce cooperation through reputation and retaliation.
                    </p>
                  </div>

                  <div className="bg-amber-900/20 p-2 md:p-3 rounded-lg border border-amber-500/30">
                    <h4 className="font-semibold text-amber-300 mb-1 md:mb-2 text-xs sm:text-sm">🤖 AI Strategy Categories</h4>
                    <div className="text-[10px] sm:text-xs text-white/70 space-y-1">
                      <p><strong>Fixed Strategies:</strong> Deterministic rules (Tit-for-Tat, Always Cooperate, etc.)</p>
                      <p><strong>Adaptive AI:</strong> Machine learning agents that update policies based on experience</p>
                      <p><strong>{window.innerWidth < 768 ? 'Tap' : 'Hover'} any agent above</strong> to see detailed analysis!</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar - Full width on mobile, smaller on desktop */}
          <div className="flex-1 xl:flex-[1] flex flex-col gap-3 md:gap-4">
            {/* Moved Leaderboard to the right sidebar */}
            <div className="bg-black/30 p-2 sm:p-3 rounded-2xl border border-white/10">
              <h3 className="text-base md:text-lg font-bold">Leaderboard</h3>
              <ol className="mt-2 space-y-1 md:space-y-2">
                {leaderboard.map((a, idx) => (
                  <li key={a.name} className="flex items-center justify-between text-xs sm:text-sm">
                    <div className="flex items-center gap-2 md:gap-3">
                      <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full" style={{ background: idx === 0 ? "#ffd700" : "#fff" }} />
                      <button 
                        className="font-medium truncate text-left hover:text-blue-300 active:text-blue-400 transition-colors touch-feedback no-tap-highlight bg-white/5 hover:bg-white/10 active:bg-white/15 rounded px-2 py-1" 
                        style={{ maxWidth: window.innerWidth < 640 ? 120 : 160 }} 
                        onMouseEnter={(e) => window.innerWidth >= 768 && handleEnterAgent(e, a)} 
                        onMouseMove={window.innerWidth >= 768 ? handleMoveAgent : undefined} 
                        onMouseLeave={window.innerWidth >= 768 ? handleLeaveAgent : undefined}
                        onClick={(e) => handleClickAgent(e, a)}
                        onTouchStart={(e) => {
                          handleClickAgent(e, a);
                        }}
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

              <div className="mt-2 md:mt-3 text-xs text-white/60">Ticks: {tick}</div>
            </div>

            <div className="bg-black/30 p-2 sm:p-3 rounded-2xl border border-white/10 text-xs sm:text-sm leading-5 sm:leading-6">
              <h3 className="text-sm sm:text-base md:text-lg font-bold mb-2 md:mb-3">🔬 Strategic Analysis Deep Dive</h3>
              
              <div className="space-y-2 md:space-y-3 text-white/80">
                <div className="bg-emerald-900/20 p-2 md:p-3 rounded-lg border border-emerald-500/30">
                  <h4 className="font-semibold text-emerald-300 mb-1 md:mb-2 text-xs sm:text-sm">🏆 Tournament Winners & Why</h4>
                  <ul className="list-disc pl-3 md:pl-4 text-[10px] sm:text-xs space-y-0.5">
                    <li><strong>Tit-for-Tat:</strong> Won Axelrod's original tournament. Perfect balance: nice, retaliatory, forgiving, clear.</li>
                    <li><strong>Generous Tit-for-Tat:</strong> Sometimes forgives defection to avoid death spirals.</li>
                    <li><strong>Adaptive Agents:</strong> Can potentially outperform fixed strategies by learning opponent patterns.</li>
                  </ul>
                </div>

                <div className="bg-red-900/20 p-2 md:p-3 rounded-lg border border-red-500/30">
                  <h4 className="font-semibold text-red-300 mb-1 md:mb-2 text-xs sm:text-sm">⚠️ Common Strategy Pitfalls</h4>
                  <ul className="list-disc pl-3 md:pl-4 text-[10px] sm:text-xs space-y-0.5">
                    <li><strong>Always Defect:</strong> Guaranteed to lose against itself and cooperators.</li>
                    <li><strong>Always Cooperate:</strong> Exploitable by defectors, needs protection.</li>
                    <li><strong>Random:</strong> Unpredictable but suboptimal in long-term relationships.</li>
                  </ul>
                </div>

                <div className="bg-blue-900/20 p-2 md:p-3 rounded-lg border border-blue-500/30">
                  <h4 className="font-semibold text-blue-300 mb-1 md:mb-2 text-xs sm:text-sm">🧠 Real-World Applications</h4>
                  <div className="text-[10px] sm:text-xs space-y-0.5">
                    <p><strong>International Relations:</strong> Arms races, trade agreements, climate cooperation</p>
                    <p><strong>Economics:</strong> Price competition, cartel stability, public goods provision</p>
                    <p><strong>Biology:</strong> Evolution of altruism, symbiosis, resource sharing</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-4 md:mt-6 text-center text-[10px] sm:text-xs text-white/50 px-2 sm:px-4">
          Enhanced Educational AI Game Theory Simulation • {window.innerWidth < 768 ? 'Tap' : 'Hover'} agents for in-depth strategy analysis • 
          Philosophy, strengths, weaknesses, real-world applications, and learning mechanisms explained
        </div>

        {/* Mobile-only floating action button */}
        {window.innerWidth < 768 && (
          <div className="fixed bottom-6 right-6 z-50 sm:hidden">
            <button
              className={`w-16 h-16 rounded-full shadow-2xl font-bold text-lg transition-all duration-300 transform touch-feedback no-tap-highlight ${
                running 
                  ? "bg-gray-600 text-gray-300 scale-95" 
                  : "bg-emerald-500 text-black scale-100 hover:scale-105 active:scale-95"
              }`}
              onClick={() => {
                if (!running) {
                  startSimulation();
                }
              }}
              disabled={running}
              style={{ touchAction: 'manipulation' }}
            >
              {running ? "⏸️" : "▶️"}
            </button>
          </div>
        )}
      </div>

      {/* Global Tooltips - Rendered at root level to avoid container clipping */}
      {hovered && !stickyTooltip && (
        <Tooltip 
          x={hovered.x} 
          y={hovered.y} 
          content={hovered.content} 
          visible={true}
          isSticky={false}
        />
      )}

      {stickyTooltip && (
        <Tooltip 
          x={stickyTooltip.x} 
          y={stickyTooltip.y} 
          content={stickyTooltip.content} 
          visible={true}
          isSticky={true}
          ref={stickyRef}
        />
      )}

      {/* Mobile instructions overlay */}
      {showMobileInstructions && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[10000] flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-blue-900/90 to-purple-900/90 rounded-2xl p-6 max-w-sm mx-auto border border-white/20 shadow-2xl">
            <div className="text-center">
              <div className="text-2xl mb-3">📱 Mobile Mode</div>
              <h3 className="text-lg font-bold text-white mb-3">Welcome to Game Theory Fishbowl!</h3>
              <div className="text-sm text-white/90 space-y-2 mb-4">
                <p>• <strong>Tap agents</strong> to see detailed strategy analysis</p>
                <p>• <strong>Use the ▶️ button</strong> to start the simulation</p>
                <p>• <strong>Explore</strong> each agent's strategy by tapping them</p>
                <p>• <strong>Run the simulation</strong> to see interactions play out</p>
              </div>
              <button
                onClick={() => setShowMobileInstructions(false)}
                className="bg-emerald-500 text-black font-bold py-2 px-4 rounded-xl hover:bg-emerald-400 transition-colors touch-feedback no-tap-highlight"
              >
                Got it! 👍
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
