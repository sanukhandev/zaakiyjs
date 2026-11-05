import {onCleanup} from "@zaakiyjs/core";
import {createForm} from "@zaakiyjs/forms";
import {signal} from "@zaakiyjs/signals";
import type {Settings,SettingsRepository,VersionedSettings} from "../models/settings";
const initial:Settings={displayName:"",locale:"en",appearance:"system",
  emailNotifications:false,reducedMotion:false};
export function createSettingsViewModel(repository:SettingsRepository){
  const loading=signal(false);
  const error=signal("");
  const notice=signal("");
  const conflict=signal(false);
  const version=signal<string|null>(null);
  let loadController:AbortController|null=null;
  let loadGeneration=0;
  let disposed=false;
  const form=createForm<Settings,VersionedSettings>({
    initialValues:{...initial},
    onSubmit:async(values,{signal})=>{
      const expected=version.peek();
      if(!expected) throw new Error("Cannot save before loading server settings.");
      return repository.save(values as Settings,expected,signal);
    }
  });
  const displayName=form.field("displayName",{required:"Display name is required",validators:[
    value=>value.trim().length>=2?null:"Enter at least 2 characters."
  ]});
  const locale=form.field("locale",{required:true});
  const appearance=form.field("appearance");
  const emailNotifications=form.field("emailNotifications");
  const reducedMotion=form.field("reducedMotion");
  const fields={displayName,locale,appearance,emailNotifications,reducedMotion};
  onCleanup(()=>{disposed=true;loadController?.abort();loadGeneration++;form.dispose();});
  async function load():Promise<void>{
    if(disposed)return;
    loadController?.abort();
    const controller=new AbortController(),id=++loadGeneration;
    loadController=controller;loading.value=true;error.value="";
    try {
      const result=await repository.load(controller.signal);
      if(disposed||controller.signal.aborted||id!==loadGeneration)return;
      if(form.dirty.value){conflict.value=true;notice.value="Server data changed. Review before resetting.";return;}
      form.reset({...result.settings});version.value=result.version;conflict.value=false;
    }catch{
      if(!disposed&&!controller.signal.aborted&&id===loadGeneration)error.value="Settings could not be loaded.";
    }finally{
      if(loadController===controller){loadController=null;if(!disposed)loading.value=false;}
    }
  }
  async function save():Promise<void>{
    if(disposed)return;
    error.value="";notice.value="";
    const expected=version.peek();
    if(!expected){error.value="Load your settings before saving.";return;}
    const result=await form.submit();
    if(disposed)return;
    if(result.status==="success"){
      if(version.peek()!==expected){conflict.value=true;error.value="Server data changed during save.";return;}
      version.value=result.value.version;form.reset({...result.value.settings});
      notice.value="Saved by server.";conflict.value=false;
    }else if(result.status==="invalid"){error.value="Review the invalid settings fields.";}
    else if(result.status==="failed"){conflict.value=true;error.value="Save failed or server version changed. Reload before retrying.";}
  }
  function cancel():void{form.reset();error.value="";notice.value="Unsaved changes discarded.";}
  return {form,fields,loading,error,notice,conflict,version,load,save,cancel};
}
export type SettingsViewModel=ReturnType<typeof createSettingsViewModel>;
