export interface Credentials {readonly email:string;readonly password:string}
export type AuthResult =
  | {readonly status:"authenticated";readonly verified:true}
  | {readonly status:"mfa-required";readonly challengeId:string};
export interface AuthRepository{
  signIn(input:Credentials,signal:AbortSignal):Promise<AuthResult>;
  signUp(input:Credentials,signal:AbortSignal):Promise<void>;
  requestReset(email:string,signal:AbortSignal):Promise<void>;
  resetPassword(input:{readonly token:string;readonly password:string},signal:AbortSignal):Promise<void>;
  verifyMfa(input:{readonly challengeId:string;readonly code:string},signal:AbortSignal):Promise<{readonly verified:true}>;
}
/** Authentication and authorization are server responsibilities. Never derive claims from local role checks. */
