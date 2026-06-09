"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { 
  BookOpen, 
  Award, 
  CheckCircle, 
  Play, 
  Lock, 
  ArrowLeft, 
  Code, 
  Terminal, 
  RefreshCw, 
  Check, 
  AlertTriangle 
} from "lucide-react";
import SuccessModal from "@/components/SuccessModal";
import { useZkLogin } from "@mysten/enoki/react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

interface CourseModule {
  id: number;
  title: string;
  category: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  lessons: number;
  duration: string;
  image: string;
  locked?: boolean;
}

const templates: Record<number, string> = {
  1: `module academy::hello_yeti {
    use std::string::{Self, String};

    public fun greet(): String {
        // Write your code to return "Hello Yeti"
        
    }
}`,
  2: `module academy::yeti_mug {
    use sui::object::UID;

    // Define a public struct YetiMug that represents a Yeti's personal coffee mug.
    // It must possess the 'key' and 'store' abilities, 
    // and contain fields: uid: UID, and coffee_level: u64.
    public struct YetiMug has key, store {
        // Define fields here
        
    }
}`,
  3: `module academy::zk_yeti {
    // Implement a validation check function verify_yeti.
    // The function receives a reference to a signature vector: &vector<u8>
    // and returns a boolean value indicating if it is valid (not empty).
    public fun verify_yeti(sig: &vector<u8>): bool {
        // Write validation logic here
        
    }
}`
};

const instructions: Record<number, { task: string; hint: string }> = {
  1: {
    task: "Write a Move function `greet()` inside module `academy::hello_yeti` that returns a `String` greeting 'Hello Yeti'. Utilize `std::string::utf8` to create the string.",
    hint: "Use `std::string::utf8(b\"Hello Yeti\")` as the return expression."
  },
  2: {
    task: "Declare a public struct `YetiMug` that has `key` and `store` abilities. It must contain two fields: `uid` of type `sui::object::UID` and `coffee_level` of type `u64`.",
    hint: "Make sure you include the abilities list: `has key, store` after the struct declaration name."
  },
  3: {
    task: "Write a verification helper function `verify_yeti` that takes `sig: &vector<u8>` and returns a `bool`. It must return `true` if the vector length is greater than 0, else `false`.",
    hint: "You can check length using standard vector functions, or check if the vector is empty."
  }
};

export default function AcademyPage() {
  const { address } = useZkLogin();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalMessage, setModalMessage] = useState("");

  const [completions, setCompletions] = useState<string[]>([]);
  const [activeCourse, setActiveCourse] = useState<CourseModule | null>(null);
  
  // Workspace states
  const [code, setCode] = useState("");
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileSuccess, setCompileSuccess] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState("");

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Fetch completions on mount and when address changes
  useEffect(() => {
    if (address) {
      loadCompletions();
    }
  }, [address]);

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [consoleLogs]);

  const loadCompletions = () => {
    fetch(`${BACKEND_URL}/quests?userAddress=${address}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          const completedIds = data
            .filter((q: any) => q.completions && q.completions.length > 0)
            .map((q: any) => q.objectId);
          setCompletions(completedIds);
        }
      })
      .catch(err => console.error("Failed to load completions:", err));
  };

  const courses: CourseModule[] = [
    {
      id: 1,
      title: "Move Smart Contracts on Sui",
      category: "Sui Development",
      difficulty: "Beginner",
      lessons: 8,
      duration: "3 hours",
      image: "/lofi-img/yeti-mainframe.jpeg",
    },
    {
      id: 2,
      title: "Sui Objects & Programmable Transactions",
      category: "Sui Architecture",
      difficulty: "Intermediate",
      lessons: 6,
      duration: "2.5 hours",
      image: "/lofi-img/yeti-sustainable-growth.jpeg",
      locked: !completions.includes("0xquest_course_1"),
    },
    {
      id: 3,
      title: "zkLogin Integrations & Native Wallet recovery",
      category: "Identity Systems",
      difficulty: "Advanced",
      lessons: 5,
      duration: "2 hours",
      image: "/lofi-img/yeti-live-on-sui.jpeg",
      locked: !completions.includes("0xquest_course_2"),
    }
  ];

  const handleStartCourse = (course: CourseModule) => {
    if (course.locked) return;
    setActiveCourse(course);
    setCode(templates[course.id] || "");
    setConsoleLogs([
      `[INFO] Workspace initialized for Course: "${course.title}".`,
      `[INFO] Target environment: Sui Testnet.`,
      `[INFO] Write your Move solution in the editor panel to begin verification.`
    ]);
    setCompileSuccess(null);
    setFeedback("");
  };

  const handleResetCode = () => {
    if (activeCourse) {
      setCode(templates[activeCourse.id] || "");
      setConsoleLogs(prev => [...prev, `[INFO] Code editor reset to initial lesson template.`]);
    }
  };

  const handleVerifyCode = async () => {
    if (!activeCourse) return;
    if (!address) {
      setModalTitle("Wallet Required");
      setModalMessage("Please connect your wallet or sign in using zkLogin to verify lessons and claim rewards! 🥶");
      setModalOpen(true);
      return;
    }

    setIsCompiling(true);
    setCompileSuccess(null);
    setConsoleLogs(prev => [
      ...prev,
      `[COMPILER] sui move build --verify-bytecode...`,
      `[COMPILER] Analyzing dependency tree (SuiFramework v1.6.0)...`,
      `[COMPILER] Performing semantic validation...`
    ]);

    try {
      const response = await fetch(`${BACKEND_URL}/quests/verify-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          suiAddress: address,
          courseId: activeCourse.id,
          code,
        }),
      });

      const data = await response.json();

      setIsCompiling(false);
      setCompileSuccess(data.success);
      setFeedback(data.feedback);

      // Split logs by line and append to console output
      const newLogs = (data.logs || "").split("\n").filter((l: string) => l.trim() !== "");
      setConsoleLogs(prev => [
        ...prev,
        ...newLogs,
        data.success 
          ? `[SUCCESS] All checks passed! Verification completed. On-chain reward process started.`
          : `[FAIL] Compilation failed or test assertions rejected. See feedback for details.`
      ]);

      if (data.success) {
        setModalTitle("Challenge Mastered!");
        setModalMessage(`Incredible job! You successfully completed "${activeCourse.title}". Your Flurries have been awarded! 🏂❄️`);
        setModalOpen(true);
        loadCompletions();
      }
    } catch (err) {
      setIsCompiling(false);
      setCompileSuccess(false);
      setConsoleLogs(prev => [
        ...prev,
        `[ERROR] Connection to compilation sandbox failed.`
      ]);
      setFeedback("Brrr! The verification server got too cold. Please check your network connection.");
    }
  };

  // Render side-by-side IDE layout
  if (activeCourse) {
    const lineCount = code.split("\n").length;
    const lineNumbers = Array.from({ length: Math.max(lineCount, 15) }, (_, i) => i + 1);

    return (
      <div className="space-y-6 pb-16">
        {/* Workspace Header */}
        <div className="flex items-center justify-between bg-bg-primary/40 p-4 rounded-2xl border border-border-ice/30">
          <button 
            onClick={() => setActiveCourse(null)}
            className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary bg-surface/50 px-3.5 py-2 rounded-xl border border-border-ice/30 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Curriculum
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold text-accent px-2 py-0.5 rounded bg-accent/10 border border-accent/20">
              {activeCourse.difficulty}
            </span>
            <span className="text-xs text-text-secondary font-semibold">
              Status: {completions.includes(`0xquest_course_${activeCourse.id}`) ? "Completed 🎓" : "In Progress ❄️"}
            </span>
          </div>
        </div>

        {/* Workspace Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[550px]">
          {/* Left panel: Instructions */}
          <div className="lg:col-span-4 glass-panel rounded-3xl p-5 flex flex-col justify-between border border-border-ice/60">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-accent font-heading font-bold text-sm border-b border-border-ice/30 pb-2">
                <BookOpen className="h-4 w-4" /> Lesson Objective
              </div>
              <h3 className="text-sm font-bold text-text-primary">{activeCourse.title}</h3>
              <div className="text-xs text-text-secondary leading-relaxed bg-surface/40 p-4 rounded-xl border border-border-ice/20 space-y-3">
                <p className="font-semibold text-text-primary">Task description:</p>
                <p>{instructions[activeCourse.id]?.task}</p>
              </div>
            </div>

            <div className="space-y-4 pt-6">
              <div className="bg-accent/5 p-4 rounded-xl border border-accent/20 text-[11px] leading-relaxed text-text-secondary">
                <span className="font-bold text-accent block mb-1 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Chef's Tip:
                </span>
                {instructions[activeCourse.id]?.hint}
              </div>
              <div className="text-center text-[10px] text-text-secondary font-semibold">
                Completing this course awards <span className="text-accent font-bold">Flurries</span> and unlocks the next level.
              </div>
            </div>
          </div>

          {/* Right panel: Editor & Console */}
          <div className="lg:col-span-8 flex flex-col gap-4">
            {/* Editor Pane */}
            <div className="glass-panel rounded-3xl overflow-hidden border border-border-ice/60 flex flex-col flex-1">
              <div className="bg-bg-primary/80 px-4 py-2 border-b border-border-ice/60 flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-text-secondary flex items-center gap-1.5">
                  <Code className="h-3.5 w-3.5 text-accent" /> main.move
                </span>
                <button 
                  onClick={handleResetCode}
                  className="p-1.5 rounded-lg hover:bg-surface text-text-secondary hover:text-text-primary transition-colors"
                  title="Reset Template"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
              
              <div className="flex flex-1 font-mono text-xs p-3 bg-surface/30">
                {/* Line numbers */}
                <div className="select-none text-right pr-3 text-text-secondary/30 border-r border-border-ice/20 flex flex-col">
                  {lineNumbers.map(n => (
                    <div key={n} className="h-[20px]">{n}</div>
                  ))}
                </div>
                {/* Code Area */}
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="flex-1 bg-transparent border-0 outline-none text-text-primary resize-none pl-3 font-mono leading-[20px] focus:ring-0"
                  style={{ minHeight: "300px" }}
                  placeholder="// Write your Sui Move code here..."
                  spellCheck="false"
                />
              </div>
            </div>

            {/* Console Pane */}
            <div className="bg-surface border border-border-ice/60 rounded-3xl overflow-hidden h-[180px] flex flex-col">
              <div className="bg-bg-primary/50 px-4 py-2 border-b border-border-ice/30 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider font-bold text-text-secondary flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5" /> Console logs
                </span>
                {compileSuccess !== null && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    compileSuccess ? "bg-mint/10 text-mint" : "bg-accent/10 text-accent"
                  }`}>
                    {compileSuccess ? "Success" : "Build Fail"}
                  </span>
                )}
              </div>
              <div className="flex-1 p-3 font-mono text-[10px] overflow-y-auto space-y-1 bg-black/40">
                {consoleLogs.map((log, index) => (
                  <div 
                    key={index} 
                    className={
                      log.startsWith("[SUCCESS]") 
                        ? "text-mint font-bold" 
                        : log.startsWith("[ERROR]") || log.startsWith("[FAIL]") 
                        ? "text-accent font-bold" 
                        : "text-text-secondary"
                    }
                  >
                    {log}
                  </div>
                ))}
                {isCompiling && (
                  <div className="text-accent animate-pulse font-bold">
                    [INFO] Compiling and verifying... Please wait...
                  </div>
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>

            {/* Action Bar */}
            {feedback && (
              <div className={`p-4 rounded-2xl text-xs border ${
                compileSuccess ? "bg-mint/5 border-mint/35 text-text-primary" : "bg-accent/5 border-accent/35 text-text-primary"
              }`}>
                <span className="font-bold block mb-1">
                  {compileSuccess ? "🎓 Coach Yeti says:" : "🥶 Debug Tip:"}
                </span>
                {feedback}
              </div>
            )}

            <button
              onClick={handleVerifyCode}
              disabled={isCompiling}
              className="w-full bg-accent text-bg-primary font-bold py-3.5 rounded-2xl text-xs hover:shadow-ice-glow transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isCompiling ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Verifying solution...</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>Run Tests & Submit Code</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render grid course list
  return (
    <div className="space-y-6 pb-16">
      {/* Academy Intro Banner */}
      <section className="glass-panel rounded-3xl p-5 relative overflow-hidden flex flex-col md:flex-row gap-5 items-center">
        <div className="absolute top-0 right-0 h-24 w-24 bg-accent/5 rounded-full blur-xl pointer-events-none" />
        <div className="space-y-2 flex-1">
          <h2 className="text-lg font-heading font-bold text-text-primary flex items-center gap-1.5">
            <BookOpen className="h-4 w-5 text-accent" /> Yeti Move Academy
          </h2>
          <p className="text-xs text-text-secondary leading-relaxed">
            Sharpen your Move smart contract skills. Follow our curated development courses, finish challenges inside the playground, and earn unique soulbound Yeti achievement badges verified on Sui.
          </p>
        </div>
        <div className="flex gap-4 bg-bg-primary/50 border border-border-ice/60 px-4 py-3 rounded-2xl shrink-0">
          <div className="text-center">
            <div className="text-lg font-bold font-heading text-accent">
              {completions.length} / {courses.length}
            </div>
            <div className="text-[9px] text-text-secondary uppercase font-semibold">Lessons Done</div>
          </div>
          <div className="border-r border-border-ice/60" />
          <div className="text-center">
            <div className="text-lg font-bold font-heading text-text-primary">
              {completions.length}
            </div>
            <div className="text-[9px] text-text-secondary uppercase font-semibold">Badges Earned</div>
          </div>
        </div>
      </section>

      {/* Courses List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {courses.map((course) => {
          const isCompleted = completions.includes(`0xquest_course_${course.id}`);
          const progress = isCompleted ? 100 : 0;
          return (
            <div
              key={course.id}
              className={`glass-panel rounded-3xl overflow-hidden hover:border-accent/40 transition-colors duration-300 flex flex-col justify-between ${
                course.locked ? "opacity-75" : ""
              }`}
            >
              {/* Header image */}
              <div className="relative w-full h-[150px] border-b border-border-ice/60">
                <Image
                  src={course.image}
                  alt={course.title}
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 500px, 500px"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-3 left-3 flex gap-2">
                  <span className="text-[8px] font-bold text-white bg-bg-primary/85 border border-border-ice/60 px-2 py-0.5 rounded uppercase tracking-wider">
                    {course.category}
                  </span>
                  <span className={`text-[8px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                    course.difficulty === "Beginner" 
                      ? "bg-accent/80 text-bg-primary" 
                      : course.difficulty === "Intermediate" 
                      ? "bg-accent/50 text-bg-primary" 
                      : "bg-surface border border-accent/30 text-accent"
                  }`}>
                    {course.difficulty}
                  </span>
                </div>
              </div>

              {/* Content */}
              <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <h3 className="text-sm md:text-base font-bold font-heading text-text-primary">
                    {course.title}
                  </h3>
                  <div className="flex justify-between text-[10px] text-text-secondary font-semibold">
                    <span>{course.lessons} lessons • {course.duration}</span>
                    {progress > 0 && (
                      <span className="text-accent">{progress}% Completed</span>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-border-ice h-1.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-accent h-full transition-all duration-500" 
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {/* Action Button */}
                <button
                  onClick={() => handleStartCourse(course)}
                  disabled={course.locked}
                  className={`w-full py-2.5 rounded-2xl font-bold text-xs transition-all duration-300 flex items-center justify-center gap-1.5 ${
                    course.locked
                      ? "bg-surface-secondary text-text-secondary/40 cursor-not-allowed border border-border-ice/60"
                      : progress === 100
                      ? "bg-accent/10 text-accent border border-accent/20"
                      : "bg-accent text-bg-primary hover:shadow-ice-glow"
                  }`}
                >
                  {course.locked ? (
                    <>
                      <Lock className="h-3.5 w-3.5" />
                      <span>Locked (Prerequisites needed)</span>
                    </>
                  ) : progress === 100 ? (
                    <>
                      <CheckCircle className="h-3.5 w-3.5" />
                      <span>Review Course</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 fill-current" />
                      <span>Start Course</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <SuccessModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modalTitle}
        message={modalMessage}
      />
    </div>
  );
}
