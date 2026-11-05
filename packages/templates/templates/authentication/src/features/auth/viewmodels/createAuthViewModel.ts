import {onCleanup} from "@zaakiyjs/core";
import {createForm} from "@zaakiyjs/forms";
import {signal} from "@zaakiyjs/signals";
import type {AuthRepository,Credentials} from "../models/auth";
export type AuthScreen="sign-in"|"sign-up"|"forgot"|"reset"|"session-expired"|"mfa"|"authenticated";
export function createAuthViewModel(repository:AuthRepository){
  const screen=signal<AuthScreen>("sign-in");
  const message=signal("");
  const pending=signal(false);
  const email=signal("");
  const password=signal("");
  const confirm=signal("");
  const resetToken=signal("");
  const mfaCode=signal("");
  let challengeId:string|null=null;
  let active:AbortController|null=null;
  let generation=0;
  let disposed=false;
  const signInForm=createForm<Credentials,Awaited<ReturnType<AuthRepository["signIn"]>>>({
    initialValues:{email:"",password:""},
    onSubmit:(values,{signal})=>repository.signIn(values,signal)
  });
  const signInEmail=signInForm.field("email",{required:"Email is required",validators:[
    value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?null:"Enter a valid email."
  ]});
  const signInPassword=signInForm.field("password",{required:"Password is required"});
  const signInFields={email:signInEmail,password:signInPassword};
  onCleanup(()=>{disposed=true;active?.abort();signInForm.dispose();challengeId=null;});
  function setScreen(next:AuthScreen):void{
    if(disposed)return;
    active?.abort();active=null;signInForm.abortSubmit();pending.value=false;generation++;
    signInForm.setValue("password","");password.value="";confirm.value="";mfaCode.value="";
    if(next!=="mfa")challengeId=null;
    message.value="";screen.value=next;
  }
  async function run<T>(action:(signal:AbortSignal)=>Promise<T>):Promise<T|undefined>{
    if(disposed)return;
    active?.abort();
    const controller=new AbortController();active=controller;
    const current=++generation;pending.value=true;message.value="";
    try {
      const result=await action(controller.signal);
      if(disposed||controller.signal.aborted||current!==generation)return;
      return result;
    } catch {
      if(!disposed&&!controller.signal.aborted&&current===generation){
        message.value="Request unsuccessful. Check your details or contact support.";
      }
      return;
    } finally {
      if(active===controller){active=null;if(!disposed)pending.value=false;}
    }
  }
  async function signIn():Promise<void>{
    if(disposed)return;
    message.value="";
    const current=++generation;
    const result=await signInForm.submit();
    if(disposed||current!==generation)return;
    if(result.status==="invalid"){message.value="Correct the highlighted sign-in fields.";return;}
    if(result.status==="failed"){message.value="Sign-in failed. Try again.";return;}
    if(result.status==="success"){
      if(result.value.status==="authenticated" && result.value.verified===true){
        screen.value="authenticated";message.value="Server-verified session established.";
      } else if(result.value.status==="mfa-required"){
        challengeId=result.value.challengeId;screen.value="mfa";
      }
    }
  }
  async function signUp():Promise<void>{
    if(password.value!==confirm.value || password.value.length<8){message.value="Passwords must match and contain at least 8 characters.";return;}
    const result=await run(signal=>repository.signUp({email:email.value,password:password.value},signal).then(()=>true));
    if(result===true){password.value="";confirm.value="";setScreen("sign-in");message.value="Account request received. Sign in after server verification.";}
  }
  async function forgot():Promise<void>{
    const sent=await run(signal=>repository.requestReset(email.value,signal).then(()=>true));
    if(sent===true)message.value="If an account exists, the server will send recovery instructions.";
  }
  async function reset():Promise<void>{
    if(!resetToken.value||password.value.length<8){message.value="Enter your reset token and a valid new password.";return;}
    const completed=await run(signal=>repository.resetPassword({token:resetToken.value,password:password.value},signal).then(()=>true));
    if(completed===true){resetToken.value="";password.value="";setScreen("sign-in");message.value="Reset confirmed by server. Please sign in.";}
  }
  async function verify():Promise<void>{
    if(!challengeId||!mfaCode.value){message.value="Enter your authentication code.";return;}
    const response=await run(signal=>repository.verifyMfa({challengeId:challengeId!,code:mfaCode.value},signal));
    if(response?.verified===true){challengeId=null;mfaCode.value="";screen.value="authenticated";}
  }
  return {screen,message,pending,email,password,confirm,resetToken,mfaCode,signInForm,signInFields,
    setScreen,signIn,signUp,forgot,reset,verify};
}
export type AuthViewModel=ReturnType<typeof createAuthViewModel>;
