import {Show} from "@zaakiyjs/core";
import type {AuthViewModel} from "../viewmodels/createAuthViewModel";
export function AuthView({vm}:{readonly vm:AuthViewModel}){
  return <main class="stack mx-auto p-8">
    <header><h1>__BRAND_NAME__ account</h1><p>Backend verification required. No demo sign-in is provided.</p></header>
    <nav aria-label="Authentication flows" class="inline">
      <button type="button" onClick={()=>vm.setScreen("sign-in")}>Sign in</button>
      <button type="button" onClick={()=>vm.setScreen("sign-up")}>Sign up</button>
      <button type="button" onClick={()=>vm.setScreen("forgot")}>Forgot password</button>
      <button type="button" onClick={()=>vm.setScreen("reset")}>Reset password</button>
      <button type="button" onClick={()=>vm.setScreen("session-expired")}>Session expired</button>
    </nav>
    <p role="status" aria-live="polite">{vm.message.value}</p>
    <Show when={vm.pending.value}><p role="status">Submitting request…</p></Show>
    <Show when={vm.screen.value==="sign-in"}>
      <section class="surface stack" aria-label="Sign in">
        <h2>Sign in</h2>
        <form onSubmit={event=>{event.preventDefault();void vm.signIn();}} class="stack">
          <div class="field"><label htmlFor="login-email">Email</label><input id="login-email" type="email" required
            autoComplete="email" value={vm.signInFields.email.value.value}
            onInput={event=>vm.signInForm.setValue("email",(event.currentTarget as HTMLInputElement).value)}/></div>
          <div class="field"><label htmlFor="login-password">Password</label><input id="login-password" type="password" required
            autoComplete="current-password" value={vm.signInFields.password.value.value}
            onInput={event=>vm.signInForm.setValue("password",(event.currentTarget as HTMLInputElement).value)}/></div>
          <button type="submit">Sign in securely</button>
        </form>
      </section>
    </Show>
    <Show when={vm.screen.value==="sign-up"}>
      <section class="surface stack"><h2>Create an account</h2>
        <div class="field"><label htmlFor="signup-email">Email</label><input id="signup-email" type="email" required value={vm.email.value}
          onInput={event=>{vm.email.value=(event.currentTarget as HTMLInputElement).value;}}/></div>
        <div class="field"><label htmlFor="signup-password">Password</label><input id="signup-password" type="password" required value={vm.password.value}
          onInput={event=>{vm.password.value=(event.currentTarget as HTMLInputElement).value;}}/></div>
        <div class="field"><label htmlFor="signup-confirm">Confirm password</label><input id="signup-confirm" type="password" required value={vm.confirm.value}
          onInput={event=>{vm.confirm.value=(event.currentTarget as HTMLInputElement).value;}}/></div>
        <button type="button" onClick={()=>{void vm.signUp();}}>Request account</button>
      </section>
    </Show>
    <Show when={vm.screen.value==="forgot"}>
      <section class="surface stack"><h2>Request password recovery</h2>
        <div class="field"><label htmlFor="recover-email">Email</label><input id="recover-email" type="email" required value={vm.email.value}
          onInput={event=>{vm.email.value=(event.currentTarget as HTMLInputElement).value;}}/></div>
        <button type="button" onClick={()=>{void vm.forgot();}}>Send recovery instructions</button>
      </section>
    </Show>
    <Show when={vm.screen.value==="reset"}>
      <section class="surface stack"><h2>Reset password</h2>
        <div class="field"><label htmlFor="reset-token">One-time reset token</label><input id="reset-token" type="text" required value={vm.resetToken.value}
          onInput={event=>{vm.resetToken.value=(event.currentTarget as HTMLInputElement).value;}}/></div>
        <div class="field"><label htmlFor="reset-password">New password</label><input id="reset-password" type="password" required value={vm.password.value}
          onInput={event=>{vm.password.value=(event.currentTarget as HTMLInputElement).value;}}/></div>
        <button type="button" onClick={()=>{void vm.reset();}}>Confirm reset</button>
      </section>
    </Show>
    <Show when={vm.screen.value==="session-expired"}>
      <section class="surface"><h2>Your session has expired</h2><p>Sign in again to continue.</p>
        <button type="button" onClick={()=>vm.setScreen("sign-in")}>Return to sign in</button>
      </section>
    </Show>
    <Show when={vm.screen.value==="mfa"}>
      <section class="surface stack"><h2>Multifactor verification</h2>
        <div class="field"><label htmlFor="mfa-code">Security code</label><input id="mfa-code" type="text" autoComplete="one-time-code" required value={vm.mfaCode.value}
          onInput={event=>{vm.mfaCode.value=(event.currentTarget as HTMLInputElement).value;}}/></div>
        <button type="button" onClick={()=>{void vm.verify();}}>Verify code</button>
      </section>
    </Show>
    <Show when={vm.screen.value==="authenticated"}>
      <section class="surface"><h2>Authenticated by backend</h2><p>Use the server session for protected routes.</p></section>
    </Show>
  </main>;
}
