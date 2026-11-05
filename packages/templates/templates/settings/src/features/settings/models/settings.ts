export interface Settings {
  readonly displayName:string;
  readonly locale:string;
  readonly appearance:"system"|"light"|"dark";
  readonly emailNotifications:boolean;
  readonly reducedMotion:boolean;
}
export interface VersionedSettings{readonly settings:Settings;readonly version:string}
export interface SettingsRepository{
  load(signal:AbortSignal):Promise<VersionedSettings>;
  /** Must enforce version/If-Match atomically server-side, throwing on conflict. */
  save(settings:Settings,expectedVersion:string,signal:AbortSignal):Promise<VersionedSettings>;
  /** Password changes require server-side reauthentication, CSRF, anti-enumeration and rate limiting. */
  changePassword(current:string,next:string,signal:AbortSignal):Promise<void>;
}
