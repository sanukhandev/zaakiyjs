import {mount} from "@zaakiyjs/dom";
import {App} from "./App";
import "virtual:zaakiy-styles.css";
import "./base.css";

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app mount target");
mount(() => <App />, target);
