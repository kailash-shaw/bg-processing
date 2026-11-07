export interface JwtPayload {
  /** Subject of the token - the investor the token was issued for. */
  sub: string;
  /** Tenant the investor belongs to. Used for tenant isolation. */
  tenant_id: string;
  /** Investor the token was issued for. */
  investor_id: string;
  email?: string;
  iat?: number;
  exp?: number;
}
