import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getToken, getProfile as fetchProfile } from "./api";

interface AuthState {
  isLoggedIn: boolean;
  loading: boolean;
  profile: any | null;
  needsOnboarding: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  isLoggedIn: false,
  loading: true,
  profile: null,
  needsOnboarding: false,
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const refreshProfile = useCallback(async () => {
    try {
      const data = await fetchProfile();
      if (data.needsOnboarding) {
        setNeedsOnboarding(true);
        setProfile(null);
      } else {
        setNeedsOnboarding(false);
        setProfile(data);
      }
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    const token = getToken();
    if (token) {
      setIsLoggedIn(true);
      refreshProfile().finally(() => setLoading(false));
    } else {
      setIsLoggedIn(false);
      setLoading(false);
    }
  }, [refreshProfile]);

  return (
    <AuthContext.Provider value={{ isLoggedIn, loading, profile, needsOnboarding, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
