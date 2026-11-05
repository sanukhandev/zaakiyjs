import {createAuthPage} from "./features/auth/adapters/createAuthPage";
import {createUnconfiguredAuthRepository} from "./features/auth/services/authRepository";
import {AuthView} from "./features/auth/views/AuthView";
export function App(){
  const vm=createAuthPage(createUnconfiguredAuthRepository());
  return <AuthView vm={vm}/>;
}
