import {bootstrapApplication,BootstrapContext} from "@angular/platform-browser";
import {provideServerRendering,withRoutes,RenderMode,ServerRoute} from "@angular/ssr";
import {RootComponent,clientProviders} from "./app";

const serverRoutes:ServerRoute[]=[
  {path:":size",renderMode:RenderMode.Server}
];
export default function bootstrap(context:BootstrapContext){
  return bootstrapApplication(RootComponent,{
    providers:[...clientProviders,provideServerRendering(withRoutes(serverRoutes))]
  },context);
}
