import React, { useState } from "react";
import { motion } from "motion/react";
import { Sparkles, ArrowRight } from "lucide-react";
import { updateProfile } from "../lib/api";

interface OnboardingProps {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState({
    preferredName: "",
    comfortStyle: "倾听",
  });

  const handleNext = async () => {
    if (step < 2) {
      setStep(step + 1);
    } else {
      try {
        await updateProfile(data);
        onComplete();
      } catch (e) {
        console.error("Failed to save profile:", e);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900 flex items-center justify-center p-4 md:p-6 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full bg-surface rounded-3xl p-6 md:p-8 shadow-2xl max-h-[90dvh] overflow-y-auto"
      >
        <div className="flex justify-center mb-6">
          <div className="p-3 bg-surface-alt rounded-2xl text-body">
            <Sparkles size={32} />
          </div>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-body mb-2">欢迎来到 Soulmate AI</h1>
          <p className="text-secondary text-sm">让我们先设置一下您的个人资料。</p>
        </div>

        <div className="space-y-6">
          {step === 1 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
              <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">我们该怎么称呼您？</label>
              <input
                type="text"
                value={data.preferredName}
                onChange={(e) => setData({ ...data, preferredName: e.target.value })}
                placeholder="您的名字..."
                className="w-full bg-input-bg border-input-border rounded-xl py-3 px-4 text-base text-body focus:ring-2 focus:ring-focus-ring transition-all"
              />
            </motion.div>
          )}

          {step === 2 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
              <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">您偏好哪种安慰方式？</label>
              <div className="grid grid-cols-1 gap-2">
                {["倾听", "建议", "转移注意力", "情感共鸣"].map((style) => (
                  <button
                    key={style}
                    onClick={() => setData({ ...data, comfortStyle: style })}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                      data.comfortStyle === style
                        ? "bg-btn border-btn text-btn-text"
                        : "bg-surface border-divider text-secondary hover:border-divider-strong"
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          <button
            onClick={handleNext}
            disabled={step === 1 && !data.preferredName.trim()}
            className="w-full bg-btn text-btn-text rounded-xl py-4 font-bold flex items-center justify-center space-x-2 hover:bg-btn-hover transition-colors disabled:opacity-50"
          >
            <span>{step === 2 ? "开启旅程" : "下一步"}</span>
            <ArrowRight size={18} />
          </button>
        </div>

        <div className="flex justify-center space-x-1.5 mt-8">
          {[1, 2].map((s) => (
            <div key={s} className={`h-1.5 rounded-full transition-all ${step === s ? "w-6 bg-btn" : "w-1.5 bg-divider-strong"}`} />
          ))}
        </div>
      </motion.div>
    </div>
  );
}
