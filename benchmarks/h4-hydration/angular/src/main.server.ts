import {bootstrapApplication,BootstrapContext} from "@angular/platform-browser";
import {provideServerRendering,withRoutes,RenderMode,ServerRoute} from "@angular/ssr";
import {RootComponent,clientProviders} from "./app";

const serverRoutes:ServerRoute[]=[
  {path:":size",renderMode:RenderMode.Prerender,
    async getPrerenderParams(){return [
      {size:"100"},{size:"1000"},{size:"10000"}
    ];}}
];
export default function bootstrap(context:BootstrapContext){
  return bootstrapApplication(RootComponent,{
    providers:[...clientProviders,provideServerRendering(withRoutes(serverRoutes))]
  },context);
}
