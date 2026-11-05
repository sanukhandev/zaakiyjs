import type {AuthRepository} from "../models/auth";
const notConfigured=():never=>{throw new Error("Authentication backend is not configured.");};
/** Deliberately fail closed. Replace through the page adapter with a vetted backend client. */
export function createUnconfiguredAuthRepository():AuthRepository{
  return {
    async signIn(){return notConfigured();},
    async signUp(){return notConfigured();},
    async requestReset(){return notConfigured();},
    async resetPassword(){return notConfigured();},
    async verifyMfa(){return notConfigured();}
  };
}
