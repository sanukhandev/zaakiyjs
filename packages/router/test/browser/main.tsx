import { bootstrapRouter } from "./App";
import "virtual:zaakiy-styles.css";
import "./base.css";

const outlet = document.getElementById("app");
if (!outlet) throw new Error("Router browser fixture requires #app");

const fixture = bootstrapRouter(outlet);
(window as unknown as { __zaakiyRouter?: typeof fixture }).__zaakiyRouter = fixture;
await fixture.ready;
