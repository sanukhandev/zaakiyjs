import { bootstrapApplication, type BootstrapContext } from "@angular/platform-browser";
import { provideServerRendering, withRoutes, RenderMode, type ServerRoute } from "@angular/ssr";
import { RootComponent, clientProviders } from "./app";

/**
 * Parameterized SSR routes must be discovered by the Angular AOT builder.
 * Do not instantiate AngularNodeAppEngine outside its generated manifest context.
 */
const serverRoutes: ServerRoute[] = [
  {
    path: ":size",
    renderMode: RenderMode.Prerender,
    async getPrerenderParams() {
      return [{ size: "100" }, { size: "1000" }, { size: "10000" }];
    }
  }
];

export default function bootstrap(context: BootstrapContext) {
  return bootstrapApplication(
    RootComponent,
    { providers: [...clientProviders, provideServerRendering(withRoutes(serverRoutes))] },
    context
  );
}
