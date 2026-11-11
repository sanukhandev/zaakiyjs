/* global document, window, performance */
import {memo, useLayoutEffect, useState} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import {jsx, jsxs} from "react/jsx-runtime";
import "../shared.css";

const initialRows = Array.from({length: 1000}, (_, id) => ({id, label: "Row " + id}));
const Row = memo(function Row({row}) {
  return jsx("li", {"data-id": String(row.id), children: jsx("span", {children: row.label})});
});
function App() {
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(true);
  const [rows, setRows] = useState(initialRows);
  useLayoutEffect(() => {
    window.__benchmark = {
      run(operation) {
        flushSync(() => {
          if (operation === "counter") setCount(value => value + 1);
          else if (operation === "rename") setRows(previous => previous.map(row =>
            row.id === 500 ? {...row, label: row.label === "Row 500" ? "Renamed 500" : "Row 500"} : row));
          else if (operation === "reverse") setRows(previous => [...previous].reverse());
          else if (operation === "toggle") setVisible(value => !value);
          else throw new Error("Unknown benchmark operation");
        });
      }
    };
    performance.mark("bench-mounted");
    return () => { delete window.__benchmark; };
  }, []);
  return jsxs("main", {id: "benchmark-root", children: [
    jsx("h1", {children: "Framework production benchmark"}),
    jsx("output", {id: "counter", children: count}),
    jsx("section", {id: "visibility", children: visible
      ? jsx("p", {id: "shown", children: "Visible"})
      : jsx("p", {id: "hidden", children: "Hidden"})}),
    jsx("ul", {id: "rows", children: rows.map(row => jsx(Row, {row}, row.id))})
  ]});
}
const host = document.querySelector("#app");
if (!host) throw new Error("Missing app host");
createRoot(host).render(jsx(App, {}));
