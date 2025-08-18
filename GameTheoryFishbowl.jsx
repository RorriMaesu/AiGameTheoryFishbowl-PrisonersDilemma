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
      if (history.length === 0) return "C";
      const lastMove = history[history.length - 1].opponent;
      if (lastMove === "C") return "C";
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
    epsilon: 0.1, // exploration rate
    alpha: 0.1,   // learning rate
    gamma: 0.9,   // discount factor
    fn: function(history, myHistory) {
      // Q-Learning implementation
      const state = this.getState(history);
      
      if (Math.random() < this.epsilon) {
        // Explore: random action
        return Math.random() < 0.5 ? "C" : "D";
      } else {
        // Exploit: best known action
        const qC = this.qTable[state + "_C"] || 0;
        const qD = this.qTable[state + "_D"] || 0;
        return qC > qD ? "C" : "D";
      }
    },
    getState: function(history) {
      if (history.length === 0) return "start";
      const recent = history.slice(-3); // Look at last 3 moves
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
      if (history.length < 5) return "C"; // Start cooperatively
      
      const cooperationRate = history.filter(h => h.opponent === "C").length / history.length;
      
      // If opponent cooperates more than threshold, cooperate; otherwise defect
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
      if (history.length < 4) return "C";
      
      // Look for patterns of length 2-4
      for (let patternLength = 2; patternLength <= Math.min(4, history.length); patternLength++) {
        const pattern = history.slice(-patternLength).map(h => h.opponent).join("");
        
        if (this.patterns[pattern]) {
          const predictions = this.patterns[pattern];
          const mostLikely = predictions.C > predictions.D ? "C" : "D";
          // Counter the prediction
          return mostLikely === "C" ? "C" : "D"; // Cooperate if they're likely to cooperate
        }
      }
      
      return "C"; // Default to cooperation
    },
    updatePatterns: function(history) {
      if (history.length < 3) return;
      
      for (let patternLength = 2; patternLength <= Math.min(4, history.length - 1); patternLength++) {
        const pattern = history.slice(-patternLength - 1, -1).map(h => h.opponent).join("");
        const nextMove = history[history.length - 1].opponent;
        
        if (!this.patterns[pattern]) {
          this.patterns[pattern] = { C: 0, D: 0 };
        }
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
        // Every 10 rounds, evaluate and potentially switch strategy
        let bestStrategy = this.currentStrategy;
        let bestPerf = this.counts[this.currentStrategy] > 0 ? 
          this.performance[this.currentStrategy] / this.counts[this.currentStrategy] : 0;
        
        for (let strategy of this.strategies) {
          if (this.counts[strategy] > 0) {
            const perf = this.performance[strategy] / this.counts[strategy];
            if (perf > bestPerf) {
              bestPerf = perf;
              bestStrategy = strategy;
            }
          }
        }
        this.currentStrategy = bestStrategy;
      }
      
      // Execute current strategy
      switch (this.currentStrategy) {
        case "C": return "C";
        case "D": return "D";
        case "TFT": return history.length === 0 ? "C" : history[history.length - 1].opponent;
        case "FREQ": 
          if (history.length < 5) return "C";
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

// Tooltip component for educational details
const Tooltip = ({ x, y, content, visible }) => {
  if (!visible || !content) return null;

  const isMobile = window.innerWidth < 768;
  const tooltipWidth = isMobile ? 280 : 320;
  const tooltipHeight = 400; // Approximate height
  
  // Smart positioning based on viewport quadrants
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const centerX = viewportWidth / 2;
  const centerY = viewportHeight / 2;
  
  let adjustedX = x;
  let adjustedY = y;
  
  // Determine which quadrant the cursor is in and position accordingly
  const isLeftHalf = x < centerX;
  const isTopHalf = y < centerY;
  
  // Horizontal positioning with quadrant awareness
  if (isLeftHalf) {
    // Cursor in left half - try to show tooltip on the right
    if (x + tooltipWidth + 20 <= viewportWidth) {
      adjustedX = x + 15; // Show on right side
    } else {
      adjustedX = Math.max(10, x - tooltipWidth - 15); // Fall back to left side
    }
  } else {
    // Cursor in right half - try to show tooltip on the left
    if (x - tooltipWidth - 20 >= 0) {
      adjustedX = x - tooltipWidth - 15; // Show on left side
    } else {
      adjustedX = Math.min(viewportWidth - tooltipWidth - 10, x + 15); // Fall back to right side
    }
  }
  
  // Vertical positioning with quadrant awareness
  if (isTopHalf) {
    // Cursor in top half - try to show tooltip below
    if (y + tooltipHeight + 20 <= viewportHeight) {
      adjustedY = y + 15; // Show below cursor
    } else {
      adjustedY = Math.max(10, y - tooltipHeight - 15); // Fall back to above
    }
  } else {
    // Cursor in bottom half - try to show tooltip above
    if (y - tooltipHeight - 20 >= 0) {
      adjustedY = y - tooltipHeight - 15; // Show above cursor
    } else {
      adjustedY = Math.min(viewportHeight - tooltipHeight - 10, y + 15); // Fall back to below
    }
  }
  
  // Final safety bounds check
  adjustedX = Math.max(10, Math.min(adjustedX, viewportWidth - tooltipWidth - 10));
  adjustedY = Math.max(10, Math.min(adjustedY, viewportHeight - tooltipHeight - 10));

  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{
        left: adjustedX,
        top: adjustedY,
        width: tooltipWidth,
      }}
    >
      <div className="bg-gray-900/95 backdrop-blur-md border border-white/20 rounded-xl p-3 md:p-4 shadow-2xl">
        <div className="text-sm md:text-base font-bold text-white mb-2">{content.name}</div>
        <div className="text-xs md:text-sm text-gray-300 mb-3">{content.desc}</div>
        
        <div className="space-y-2 md:space-y-3">
          <div className="bg-blue-900/30 p-2 md:p-3 rounded-lg border border-blue-500/30">
            <div className="text-xs md:text-sm font-semibold text-blue-300 mb-1">🧠 Strategy Philosophy</div>
            <div className="text-xs text-gray-300">{content.reasoning}</div>
          </div>
          
          <div className="bg-green-900/30 p-2 md:p-3 rounded-lg border border-green-500/30">
            <div className="text-xs md:text-sm font-semibold text-green-300 mb-1">✅ Strengths</div>
            <ul className="text-xs text-gray-300 list-disc list-inside space-y-0.5">
              {content.strengths.map((strength, i) => (
                <li key={i}>{strength}</li>
              ))}
            </ul>
          </div>
          
          <div className="bg-red-900/30 p-2 md:p-3 rounded-lg border border-red-500/30">
            <div className="text-xs md:text-sm font-semibold text-red-300 mb-1">⚠️ Weaknesses</div>
            <ul className="text-xs text-gray-300 list-disc list-inside space-y-0.5">
              {content.weaknesses.map((weakness, i) => (
                <li key={i}>{weakness}</li>
              ))}
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
        
        <div className="mt-2 md:mt-3 text-xs text-gray-400 border-t border-white/10 pt-2">
          {content.isClassic ? "🏛️ Classic Strategy" : "🤖 Adaptive AI Agent"}
        </div>
      </div>
    </div>
  );
};

export default function GameTheoryFishbowl() {
  const containerRef = useRef(null);
  const [agents, setAgents] = useState([]);
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(0);
  const [log, setLog] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [hovered, setHovered] = useState(null);
  const [stickyTooltip, setStickyTooltip] = useState(null);

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
  }, []);

  const center = { x: 440, y: 260, r: 240 };

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
    if (running) return;
    setRunning(true);
    setTick(0);
    setLog([]);
    setChartData([]);
    
    // Reset agent scores and histories
    setAgents(prev => prev.map(agent => ({
      ...agent,
      score: 0,
      history: [],
      myHistory: []
    })));

    let currentTick = 0;
    const interval = setInterval(() => {
      setAgents((currentAgents) => {
        if (currentAgents.length < 2) return currentAgents;

        // Pick two random agents
        const indices = [];
        while (indices.length < 2) {
          const idx = Math.floor(Math.random() * currentAgents.length);
          if (!indices.includes(idx)) indices.push(idx);
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

        // Log the match
        setLog((prevLog) => [
          `${agentA.name} vs ${agentB.name}: ${Math.round(result.scoreA)} - ${Math.round(result.scoreB)}`,
          ...prevLog.slice(0, 19)
        ]);

        // Update chart data
        setChartData((prevData) => [
          ...prevData.slice(-19),
          {
            tick: currentTick,
            s0: newAgents[0]?.score || 0,
            s1: newAgents[1]?.score || 0,
            s2: newAgents[2]?.score || 0,
            s3: newAgents[3]?.score || 0,
            s4: newAgents[4]?.score || 0,
            s5: newAgents[5]?.score || 0,
          }
        ]);

        return newAgents;
      });

      setTick(currentTick);
      currentTick++;

      if (currentTick > 500) {
        clearInterval(interval);
        setRunning(false);
      }
    }, PAUSE_BETWEEN_MATCHES_MS);
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
    e.preventDefault();
    setStickyTooltip({
      x: e.clientX,
      y: e.clientY,
      content: agent,
    });
    setHovered(null);
  };

  // Close sticky tooltip on outside click
  useEffect(() => {
    const handleClickOutside = () => setStickyTooltip(null);
    if (stickyTooltip) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
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
    <div ref={containerRef} className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-rose-900 text-white">
      {/* Mobile/Desktop responsive container */}
      <div className="w-full max-w-7xl mx-auto p-3 md:p-6">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 md:gap-6">
          
          {/* Main Fishbowl Area - Full width on mobile, 8 cols on desktop */}
          <div className="xl:col-span-8 bg-black/40 rounded-2xl p-3 md:p-4 shadow-2xl border border-white/10">
            
            {/* Header - Stack on mobile, side-by-side on desktop */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 gap-3 md:gap-4">
              <div className="flex-1">
                <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Game Theory Fishbowl</h1>
                <p className="text-xs md:text-sm text-white/70 mt-1">
                  Interactive educational simulation: AI agents compete in Iterated Prisoner's Dilemma. 
                  <span className="hidden sm:inline">
                    <strong> Hover any agent for detailed strategy analysis</strong> including philosophy, strengths, weaknesses, and real-world analogies.
                  </span>
                  <span className="sm:hidden">
                    <strong> Tap agents for detailed analysis.</strong>
                  </span>
                </p>
              </div>
              <div className="flex-shrink-0">
                <button
                  className={`w-full md:w-auto px-4 py-2 font-semibold rounded-xl shadow-lg transition-all ${running ? "bg-gray-500 text-gray-200" : "bg-emerald-400 text-black"}`}
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

            {/* Fishbowl Visualization - Responsive height and scaling */}
            <div className="relative h-[300px] sm:h-[400px] md:h-[500px] lg:h-[540px] p-2 overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <svg 
                  width="100%" 
                  height="100%" 
                  viewBox="0 0 880 520" 
                  className="max-w-full max-h-full"
                  preserveAspectRatio="xMidYMid meet"
                >
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
                <motion.div 
                  key={a.id + idx} 
                  className="absolute flex items-center justify-center" 
                  style={{ left: a.x - 46, top: a.y - 26 }} 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }} 
                  transition={{ delay: idx * 0.02 }}
                >
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
                    className={`
                      w-28 h-12 sm:w-32 sm:h-14 md:w-36 md:h-16 
                      rounded-xl md:rounded-2xl p-1 md:p-2 
                      backdrop-blur-md border border-white/10 
                      flex flex-col justify-center items-center 
                      shadow-md focus:outline-none cursor-pointer 
                      hover:border-white/30 transition-all 
                      ${a.isClassic ? "bg-white/5 hover:bg-white/10" : "bg-amber-900/20 hover:bg-amber-900/30"}
                    `}
                  >
                    <div className="text-[10px] sm:text-xs font-semibold truncate w-full text-center">{a.name}</div>
                    <div className="text-[8px] sm:text-[10px] text-white/70 mt-0.5 md:mt-1">{a.isClassic ? "Classic" : "Learner"}</div>
                    <div className="text-[7px] sm:text-[8px] text-white/50 mt-0.5 hidden sm:block">Click for details</div>
                  </div>
                </motion.div>
              ))}

              {/* SVG connections overlay */}
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

            {/* Educational Dashboard - Responsive grid */}
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2 bg-black/30 p-3 rounded-xl border border-white/10">
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
              </div>

              <div className="lg:col-span-1 bg-black/30 p-3 rounded-xl border border-white/10">
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

          {/* Sidebar - Full width on mobile, 4 cols on desktop */}
          <div className="xl:col-span-4 flex flex-col gap-4">
            <div className="bg-black/40 p-3 rounded-2xl border border-white/10 shadow-2xl h-64 md:h-72">
              <h3 className="text-base md:text-lg font-bold mb-2">Score evolution (recent snapshots)</h3>
              <div className="h-44 md:h-48">
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

            <div className="bg-black/30 p-3 rounded-2xl border border-white/10 h-64 md:h-72 overflow-auto">
              <h3 className="text-base md:text-lg font-bold mb-2">Recent Matches</h3>
              <div className="text-sm text-white/80 space-y-2">
                {log.length === 0 && <div className="text-xs text-white/60">No matches yet — press Start.</div>}
                {log.map((l, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="truncate flex-1 mr-2">{l}</div>
                    <div className="text-xs text-white/60 flex-shrink-0">tick</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-black/30 p-3 rounded-2xl border border-white/10 text-sm leading-6 overflow-auto max-h-64 md:max-h-80">
              <h3 className="text-base md:text-lg font-bold mb-3">🔬 Strategic Analysis Deep Dive</h3>
              
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
                    <li><strong>Always Defect:</strong> Guaranteed to lose against itself and cooperators.</li>
                    <li><strong>Always Cooperate:</strong> Exploitable by defectors, needs protection.</li>
                    <li><strong>Random:</strong> Unpredictable but suboptimal in long-term relationships.</li>
                  </ul>
                </div>

                <div className="bg-blue-900/20 p-3 rounded-lg border border-blue-500/30">
                  <h4 className="font-semibold text-blue-300 mb-2">🧠 Real-World Applications</h4>
                  <div className="text-xs space-y-1">
                    <p><strong>International Relations:</strong> Arms races, trade agreements, climate cooperation</p>
                    <p><strong>Economics:</strong> Price competition, cartel stability, public goods provision</p>
                    <p><strong>Biology:</strong> Evolution of altruism, symbiosis, resource sharing</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-6 text-center text-xs text-white/50 px-4">
          Enhanced Educational AI Game Theory Simulation • Hover agents for in-depth strategy analysis • 
          Philosophy, strengths, weaknesses, real-world applications, and learning mechanisms explained
        </div>
      </div>

      {/* Global Tooltips - Rendered at root level to avoid container clipping */}
      {hovered && !stickyTooltip && (
        <Tooltip 
          x={hovered.x} 
          y={hovered.y} 
          content={hovered.content} 
          visible={true} 
        />
      )}

      {stickyTooltip && (
        <Tooltip 
          x={stickyTooltip.x} 
          y={stickyTooltip.y} 
          content={stickyTooltip.content} 
          visible={true} 
        />
      )}
    </div>
  );
}
