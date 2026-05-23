export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  company?: string;
  phone?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface AuthResult {
  success: boolean;
  message?: string;
  token?: string;
  user?: UserProfile | null;
}

export interface UserSessionInfo {
  id: string;
  is_current: boolean;
  created_at: string;
  last_active_at: string;
  device: string;
}
