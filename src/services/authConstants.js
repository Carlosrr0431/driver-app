const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xzabzbrolmkezljsyycr.supabase.co';

export const AUTH_STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

const INVALID_REFRESH_TOKEN_RE =
  /Invalid Refresh Token|Already Used|Refresh Token Not Found|refresh_token_not_found/i;

export const isInvalidRefreshTokenError = (error) => {
  const message = error?.message || String(error || '');
  const code = error?.code || '';
  return INVALID_REFRESH_TOKEN_RE.test(message) || INVALID_REFRESH_TOKEN_RE.test(code);
};

export const INVALID_REFRESH_TOKEN_PATTERN = INVALID_REFRESH_TOKEN_RE;
