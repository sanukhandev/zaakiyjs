import React, { useState, useLayoutEffect } from "react";

export const makeRows = count => Array.from({ length: count }, (_,i) => ({
  id:"row-"+i, label:"Row "+i
}));

export function ReactBenchmarkApp({ size, onReady }) {
  const [rows, setRows] = useState(() => makeRows(size));
  const [count, setCount] = useState(0);
  const [enabled, setEnabled] = useState(true);
  useLayoutEffect(() => {
    onReady?.({
      update: () => setCount(v=>v+1),
      reverse: () => setRows(v=>[...v].reverse()),
      toggle: () => setEnabled(v=>!v)
    });
  }, []);
  return React.createElement("main", null,
    React.createElement("input", {defaultValue:"server", "data-draft":"yes"}),
    React.createElement("button", {type:"button", onClick:()=>setCount(v=>v+1), "data-counter":"yes"}, "Count: "+count),
    enabled ? React.createElement("p", { "data-condition":"yes" }, "Visible") : null,
    React.createElement("ul", {"data-list":"yes"},
      rows.map(row=>React.createElement("li", {key:row.id, "data-key":row.id}, row.label)))
  );
}
