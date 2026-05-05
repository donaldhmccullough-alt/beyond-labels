'use client';
// ─────────────────────────────────────────────────────────────────────────────
// MVP_MODE: set to false to restore FlagsScreen in onboarding flow
// ─────────────────────────────────────────────────────────────────────────────
const MVP_MODE = true;

import { useState, useEffect } from 'react';
import { getProfile, saveProfile, clearProfile } from '@/lib/userProfile';
import { hasUserLevel, getUserLevel, setUserLevel } from '@/lib/userLevel';
import { STAGES, getStageFromScore } from '@/lib/onboardingData';
import { supabase } from '@/lib/supabase';
import { migrateLocalToSupabase, syncUserLevelFromSupabase, saveUserLevelToSupabase } from '@/lib/auth';
// Onboarding
import WelcomeScreen from '@/components/onboarding/WelcomeScreen';
import AssessmentScreen from '@/components/onboarding/AssessmentScreen';
import CalculatingScreen from '@/components/onboarding/CalculatingScreen';
import RevealScreen from '@/components/onboarding/RevealScreen';
import FlagsScreen from '@/components/onboarding/FlagsScreen';
import LaunchScreen from '@/components/onboarding/LaunchScreen';
import LevelSelectScreen from '@/components/onboarding/LevelSelectScreen';
// Main app
import ScannerScreen from '@/components/scanner/ScannerScreen';
import VerdictScreen from '@/components/verdict/VerdictScreen';
import SwapsScreen from '@/components/swaps/SwapsScreen';
import ProfileScreen from '@/components/profile/ProfileScreen';
import BottomNav from '@/components/shared/BottomNav';
import AuthModal from '@/components/auth/AuthModal';

export default function Home() {
  const [appScreen, setAppScreen] = useState('loading');
  const [onboardingStep, setOnboardingStep] = useState('welcome');
  const [assessmentScore, setAssessmentScore] = useState(0);
  const [mainTab, setMainTab] = useState('scan');
  const [lastScanResult, setLastScanResult] = useState(null);
  const [userLevel, setUserLevelState] = useState(1);

  // ── Auth state ────────────────────────────────────────────────────────────
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    // Show level-select on first visit; skip straight to scanner on return visits.
    if (hasUserLevel()) {
      setUserLevelState(getUserLevel());
      setAppScreen('main');
    } else {
      setOnboardingStep('level-select');
      setAppScreen('onboarding');
    }

    if (!supabase) return;

    // Restore existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUser(session.user);
    });

    // Listen for sign-in / sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const newUser = session?.user || null;
      setUser(newUser);

      if (event === 'SIGNED_IN' && newUser) {
        // Run localStorage → Supabase migration (idempotent)
        const alreadyMigrated = localStorage.getItem('bl_migrated');
        if (alreadyMigrated !== newUser.id) {
          await migrateLocalToSupabase(newUser.id);
        }
        // Sync user_level from Supabase — Supabase wins for signed-in users
        const syncedLevel = await syncUserLevelFromSupabase(newUser.id);
        if (syncedLevel) setUserLevelState(syncedLevel);
      }
    });

    return () => subscription?.unsubscribe();
  }, []);

  // ── Level handlers ────────────────────────────────────────────────────────

  function handleLevelSelect(level) {
    setUserLevel(level);
    setUserLevelState(level);
    setAppScreen('main');
  }

  function handleLevelChange(level) {
    setUserLevel(level);
    setUserLevelState(level);
    if (user?.id) saveUserLevelToSupabase(user.id, level);
  }

  // ── Onboarding handlers ───────────────────────────────────────────────────

  function handleSkipOnboarding() {
    if (!hasUserLevel()) {
      setUserLevel(1);
      setUserLevelState(1);
    }
    const defaultProfile = { stage: STAGES[1], score: 14, flags: [], onboardingComplete: true };
    saveProfile(defaultProfile);
    setAppScreen('main');
  }

  function handleAssessmentComplete(score) {
    setAssessmentScore(score);
    setOnboardingStep('calculating');
  }

  function handleCalculatingDone() { setOnboardingStep('reveal'); }
  function handleRevealNext() {
    // MVP_MODE: skip FlagsScreen, go straight to launch
    if (MVP_MODE) {
      const stage = getStageFromScore(assessmentScore);
      const profile = { stage, score: assessmentScore, flags: [], onboardingComplete: true };
      saveProfile(profile);
      if (user && supabase) {
        supabase.from('profiles').upsert({
          id: user.id,
          stage: stage.stage,
          score: assessmentScore,
          personal_flags: [],
          onboarding_complete: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
      }
      setOnboardingStep('launch');
      return;
    }
    setOnboardingStep('flags');
  }

  function handleFlagsComplete(selectedFlags) {
    const stage = getStageFromScore(assessmentScore);
    const profile = { stage, score: assessmentScore, flags: selectedFlags, onboardingComplete: true };
    saveProfile(profile);
    // If signed in, also persist to Supabase
    if (user && supabase) {
      supabase.from('profiles').upsert({
        id: user.id,
        stage: stage.stage,
        score: assessmentScore,
        personal_flags: selectedFlags,
        onboarding_complete: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    }
    setOnboardingStep('launch');
  }

  function handleLaunch() { setAppScreen('main'); }

  function handleScanResult(result) {
    setLastScanResult(result);
    setMainTab('verdict');
  }

  function handleSeeSwaps() { setMainTab('swaps'); }

  function handleRetakeAssessment() {
    clearProfile();
    setAssessmentScore(0);
    setOnboardingStep('welcome');
    setAppScreen('onboarding');
    setLastScanResult(null);
    setMainTab('scan');
  }

  function handleStartOnboarding() {
    setOnboardingStep('welcome');
    setAppScreen('onboarding');
  }

  function handleAuthSuccess(signedInUser) {
    if (signedInUser) setUser(signedInUser);
    setShowAuthModal(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (appScreen === 'loading') {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh' }}>
        <div className="pulse-circle" />
      </div>
    );
  }

  if (appScreen === 'onboarding') {
    return (
      <div className="app-container">
        {onboardingStep === 'welcome' && (
          <WelcomeScreen
            onBegin={() => setOnboardingStep(MVP_MODE ? 'level-select' : 'assessment')}
            onSkip={handleSkipOnboarding}
          />
        )}
        {onboardingStep === 'level-select' && (
          <LevelSelectScreen onComplete={handleLevelSelect} />
        )}
        {onboardingStep === 'assessment' && (
          <AssessmentScreen onComplete={handleAssessmentComplete} onBack={() => setOnboardingStep('welcome')} />
        )}
        {onboardingStep === 'calculating' && (
          <CalculatingScreen onComplete={handleCalculatingDone} />
        )}
        {onboardingStep === 'reveal' && (
          <RevealScreen score={assessmentScore} onNext={handleRevealNext} />
        )}
        {onboardingStep === 'flags' && (
          <FlagsScreen onComplete={handleFlagsComplete} />
        )}
        {onboardingStep === 'launch' && (
          <LaunchScreen score={assessmentScore} onLaunch={handleLaunch} />
        )}
      </div>
    );
  }

  // Main app
  return (
    <div className="app-container">
      <div style={{ paddingBottom: 68 }}>
        {mainTab === 'scan' && (
          <ScannerScreen user={user} userLevel={userLevel} onScanResult={handleScanResult} />
        )}
        {mainTab === 'verdict' && (
          <VerdictScreen
            scanResult={lastScanResult}
            userLevel={userLevel}
            onSeeSwaps={handleSeeSwaps}
            onBack={() => setMainTab('scan')}
            onStartOnboarding={handleStartOnboarding}
          />
        )}
        {mainTab === 'swaps' && (
          <SwapsScreen scanResult={lastScanResult} onBack={() => setMainTab('verdict')} />
        )}
        {mainTab === 'profile' && (
          <ProfileScreen
            user={user}
            userLevel={userLevel}
            onLevelChange={handleLevelChange}
            onRetakeAssessment={handleRetakeAssessment}
            onStartOnboarding={handleStartOnboarding}
            onSignIn={() => setShowAuthModal(true)}
          />
        )}
      </div>

      <BottomNav activeTab={mainTab} onTabChange={setMainTab} />

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={handleAuthSuccess}
        />
      )}
    </div>
  );
}
