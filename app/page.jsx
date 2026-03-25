'use client';
import { useState, useEffect } from 'react';
import { getProfile, saveProfile, clearProfile } from '@/lib/userProfile';
import { STAGES, getStageFromScore } from '@/lib/onboardingData';
// Onboarding
import WelcomeScreen from '@/components/onboarding/WelcomeScreen';
import AssessmentScreen from '@/components/onboarding/AssessmentScreen';
import CalculatingScreen from '@/components/onboarding/CalculatingScreen';
import RevealScreen from '@/components/onboarding/RevealScreen';
import FlagsScreen from '@/components/onboarding/FlagsScreen';
import LaunchScreen from '@/components/onboarding/LaunchScreen';
// Main app
import ScannerScreen from '@/components/scanner/ScannerScreen';
import VerdictScreen from '@/components/verdict/VerdictScreen';
import SwapsScreen from '@/components/swaps/SwapsScreen';
import ProfileScreen from '@/components/profile/ProfileScreen';
import BottomNav from '@/components/shared/BottomNav';

export default function Home() {
  const [appScreen, setAppScreen] = useState('loading');
  const [onboardingStep, setOnboardingStep] = useState('welcome');
  const [assessmentScore, setAssessmentScore] = useState(0);
  const [mainTab, setMainTab] = useState('scan');
  const [lastScanResult, setLastScanResult] = useState(null);

  useEffect(() => {
    const profile = getProfile();
    if (profile?.onboardingComplete) {
      setAppScreen('main');
    } else {
      setAppScreen('onboarding');
    }
  }, []);

  function handleSkipOnboarding() {
    const defaultProfile = {
      stage: STAGES[1], // Stage 2
      score: 14,
      flags: [],
      onboardingComplete: true,
    };
    saveProfile(defaultProfile);
    setAppScreen('main');
  }

  function handleAssessmentComplete(score) {
    setAssessmentScore(score);
    setOnboardingStep('calculating');
  }

  function handleCalculatingDone() {
    setOnboardingStep('reveal');
  }

  function handleRevealNext() {
    setOnboardingStep('flags');
  }

  function handleFlagsComplete(selectedFlags) {
    const stage = getStageFromScore(assessmentScore);
    const profile = {
      stage,
      score: assessmentScore,
      flags: selectedFlags,
      onboardingComplete: true,
    };
    saveProfile(profile);
    setOnboardingStep('launch');
  }

  function handleLaunch() {
    setAppScreen('main');
  }

  function handleScanResult(result) {
    setLastScanResult(result);
    setMainTab('verdict');
  }

  function handleSeeSwaps() {
    setMainTab('swaps');
  }

  function handleRetakeAssessment() {
    clearProfile();
    setAssessmentScore(0);
    setOnboardingStep('welcome');
    setAppScreen('onboarding');
    setLastScanResult(null);
    setMainTab('scan');
  }

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
            onBegin={() => setOnboardingStep('assessment')}
            onSkip={handleSkipOnboarding}
          />
        )}
        {onboardingStep === 'assessment' && (
          <AssessmentScreen
            onComplete={handleAssessmentComplete}
            onBack={() => setOnboardingStep('welcome')}
          />
        )}
        {onboardingStep === 'calculating' && (
          <CalculatingScreen onComplete={handleCalculatingDone} />
        )}
        {onboardingStep === 'reveal' && (
          <RevealScreen
            score={assessmentScore}
            onNext={handleRevealNext}
          />
        )}
        {onboardingStep === 'flags' && (
          <FlagsScreen onComplete={handleFlagsComplete} />
        )}
        {onboardingStep === 'launch' && (
          <LaunchScreen
            score={assessmentScore}
            onLaunch={handleLaunch}
          />
        )}
      </div>
    );
  }

  // Main app
  return (
    <div className="app-container">
      <div style={{ paddingBottom: 68 }}>
        {mainTab === 'scan' && (
          <ScannerScreen onScanResult={handleScanResult} />
        )}
        {mainTab === 'verdict' && (
          <VerdictScreen
            scanResult={lastScanResult}
            onSeeSwaps={handleSeeSwaps}
            onBack={() => setMainTab('scan')}
          />
        )}
        {mainTab === 'swaps' && (
          <SwapsScreen
            scanResult={lastScanResult}
            onBack={() => setMainTab('verdict')}
          />
        )}
        {mainTab === 'profile' && (
          <ProfileScreen onRetakeAssessment={handleRetakeAssessment} />
        )}
      </div>
      <BottomNav activeTab={mainTab} onTabChange={setMainTab} />
    </div>
  );
}
