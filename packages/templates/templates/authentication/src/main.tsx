import {mount} from "@zaakiyjs/dom";
import {App} from "./App";
import "virtual:zaakiy-styles.css";
import "./base.css";
const root=document.getElementById("app");
if(!root) throw new Error("Missing application mount element.");
mount(() => <App/>,root);
